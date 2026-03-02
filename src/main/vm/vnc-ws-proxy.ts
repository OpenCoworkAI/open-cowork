/**
 * VNC WebSocket Proxy - Bridges WebSocket (for noVNC) to raw TCP (VBox VRDE)
 *
 * noVNC in the renderer connects via WebSocket. VirtualBox VRDE listens on
 * raw TCP using the RFB protocol. This proxy bridges the two.
 */

import { WebSocketServer, WebSocket } from 'ws';
import * as net from 'net';
import { log, logError } from '../utils/logger';

export class VNCWebSocketProxy {
  private wss: WebSocketServer | null = null;
  private wsPort = 0;
  private vncPort: number;
  private activeSockets: Set<{ ws: WebSocket; tcp: net.Socket }> = new Set();

  constructor(vncPort: number) {
    this.vncPort = vncPort;
  }

  /** Start the WebSocket proxy server. Returns the WebSocket port. */
  async start(): Promise<number> {
    if (this.wss) {
      return this.wsPort;
    }

    return new Promise<number>((resolve, reject) => {
      // Let OS assign an available port (port 0)
      this.wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });

      this.wss.on('listening', () => {
        const addr = this.wss!.address();
        if (typeof addr === 'object' && addr) {
          this.wsPort = addr.port;
        }
        log('[VNCProxy] Listening on ws://127.0.0.1:' + this.wsPort, '→ tcp://127.0.0.1:' + this.vncPort);
        resolve(this.wsPort);
      });

      this.wss.on('error', (err) => {
        logError('[VNCProxy] Server error:', err.message);
        reject(err);
      });

      this.wss.on('connection', (ws) => {
        log('[VNCProxy] New WebSocket connection, bridging to VNC port', this.vncPort);
        this.bridgeConnection(ws);
      });
    });
  }

  /** Bridge a single WebSocket connection to a TCP VNC socket */
  private bridgeConnection(ws: WebSocket): void {
    const tcp = net.createConnection({ port: this.vncPort, host: '127.0.0.1' });
    const pair = { ws, tcp };
    this.activeSockets.add(pair);

    const cleanup = () => {
      this.activeSockets.delete(pair);
      try { tcp.destroy(); } catch { /* ignore */ }
      try { if (ws.readyState === WebSocket.OPEN) ws.close(); } catch { /* ignore */ }
    };

    // TCP → WebSocket
    tcp.on('data', (data: Buffer) => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      } catch {
        cleanup();
      }
    });

    tcp.on('error', (err) => {
      logError('[VNCProxy] TCP error:', err.message);
      cleanup();
    });

    tcp.on('close', () => {
      log('[VNCProxy] TCP connection closed');
      cleanup();
    });

    // WebSocket → TCP
    ws.on('message', (data: Buffer) => {
      try {
        if (!tcp.destroyed) {
          tcp.write(data);
        }
      } catch {
        cleanup();
      }
    });

    ws.on('error', (err) => {
      logError('[VNCProxy] WebSocket error:', err.message);
      cleanup();
    });

    ws.on('close', () => {
      log('[VNCProxy] WebSocket connection closed');
      cleanup();
    });
  }

  /** Stop the proxy server and close all connections */
  async stop(): Promise<void> {
    // Close all active bridges
    for (const { ws, tcp } of this.activeSockets) {
      try { tcp.destroy(); } catch { /* ignore */ }
      try { if (ws.readyState === WebSocket.OPEN) ws.close(); } catch { /* ignore */ }
    }
    this.activeSockets.clear();

    // Close the WebSocket server
    if (this.wss) {
      return new Promise<void>((resolve) => {
        this.wss!.close(() => {
          log('[VNCProxy] Server stopped');
          this.wss = null;
          this.wsPort = 0;
          resolve();
        });
      });
    }
  }

  /** Get the WebSocket URL for noVNC to connect to */
  getWebSocketUrl(): string {
    if (!this.wss || this.wsPort === 0) {
      throw new Error('VNC proxy not started');
    }
    return `ws://127.0.0.1:${this.wsPort}`;
  }

  /** Check if the proxy is running */
  isRunning(): boolean {
    return this.wss !== null && this.wsPort > 0;
  }
}
