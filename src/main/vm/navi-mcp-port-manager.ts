/**
 * Navi MCP Port Manager - Allocates host-side TCP ports for NAT forwarding
 * to guest Navi MCP servers. Same pattern as VNCPortManager.
 */

import * as net from 'net';
import { log } from '../utils/logger';

const DEFAULT_PORT_RANGE_START = 9600;
const DEFAULT_PORT_RANGE_END = 9699;

export class NaviMCPPortManager {
  private allocatedPorts: Map<string, number> = new Map(); // vmId -> port
  private portRangeStart: number;
  private portRangeEnd: number;

  constructor(rangeStart = DEFAULT_PORT_RANGE_START, rangeEnd = DEFAULT_PORT_RANGE_END) {
    this.portRangeStart = rangeStart;
    this.portRangeEnd = rangeEnd;
  }

  async allocatePort(vmId: string): Promise<number> {
    const existing = this.allocatedPorts.get(vmId);
    if (existing !== undefined) {
      log('[NaviMCPPortManager] Reusing existing port', existing, 'for VM:', vmId);
      return existing;
    }

    const usedPorts = new Set(this.allocatedPorts.values());
    for (let port = this.portRangeStart; port <= this.portRangeEnd; port++) {
      if (usedPorts.has(port)) continue;
      const available = await this.isPortAvailable(port);
      if (available) {
        this.allocatedPorts.set(vmId, port);
        log('[NaviMCPPortManager] Allocated port', port, 'for VM:', vmId);
        return port;
      }
    }

    throw new Error(`No available Navi MCP ports in range ${this.portRangeStart}-${this.portRangeEnd}`);
  }

  releasePort(vmId: string): void {
    const port = this.allocatedPorts.get(vmId);
    if (port !== undefined) {
      this.allocatedPorts.delete(vmId);
      log('[NaviMCPPortManager] Released port', port, 'for VM:', vmId);
    }
  }

  getPort(vmId: string): number | null {
    return this.allocatedPorts.get(vmId) ?? null;
  }

  releaseAll(): void {
    this.allocatedPorts.clear();
    log('[NaviMCPPortManager] Released all ports');
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });
  }
}
