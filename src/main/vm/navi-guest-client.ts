/**
 * Navi Guest Client - Connects to the Navi MCP server running inside a guest VM
 *
 * Uses TCP via NAT port forwarding: host:<hostPort> → guest:9599
 * Protocol: newline-delimited JSON-RPC
 */

import * as net from 'net';
import { log, logError } from '../utils/logger';

export interface NaviGuestClientOptions {
  vmId: string;
  vmName: string;
  hostPort: number;
}

interface JsonRpcRequest {
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class NaviGuestClient {
  private vmId: string;
  private vmName: string;
  private hostPort: number;
  private socket: net.Socket | null = null;
  private connected = false;
  private nextId = 1;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>();
  private buffer = '';

  constructor(options: NaviGuestClientOptions) {
    this.vmId = options.vmId;
    this.vmName = options.vmName;
    this.hostPort = options.hostPort;
  }

  async connect(timeoutMs = 5000): Promise<boolean> {
    if (this.connected && this.socket) return true;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.cleanup();
        resolve(false);
      }, timeoutMs);

      this.socket = net.createConnection({ port: this.hostPort, host: '127.0.0.1' }, () => {
        clearTimeout(timer);
        this.connected = true;
        log(`[NaviGuestClient] Connected to guest Navi (${this.vmName}) on port ${this.hostPort}`);
        resolve(true);
      });

      this.socket.on('data', (chunk) => {
        this.buffer += chunk.toString();
        this.processBuffer();
      });

      this.socket.on('error', (err) => {
        clearTimeout(timer);
        logError(`[NaviGuestClient] Connection error (${this.vmName}):`, err.message);
        this.cleanup();
        resolve(false);
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.rejectAllPending('Connection closed');
      });
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    this.cleanup();
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.sendRequest('ping', {}, 3000);
      return !!(result as Record<string, unknown>)?.status;
    } catch {
      return false;
    }
  }

  async sendRequest(method: string, params?: unknown, timeoutMs = 10000): Promise<unknown> {
    if (!this.connected || !this.socket) {
      throw new Error('Not connected to guest Navi');
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = { id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.socket!.write(JSON.stringify(request) + '\n');
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response: JsonRpcResponse = JSON.parse(line);
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (err) {
        logError('[NaviGuestClient] Failed to parse response:', line);
      }
    }
  }

  private cleanup(): void {
    this.connected = false;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.rejectAllPending('Client disconnected');
    this.buffer = '';
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error(reason));
      this.pendingRequests.delete(id);
    }
  }
}
