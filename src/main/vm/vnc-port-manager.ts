/**
 * VNC Port Manager - Allocates and tracks VNC/VRDE ports for VMs
 */

import * as net from 'net';
import { log } from '../utils/logger';

const DEFAULT_PORT_RANGE_START = 5900;
const DEFAULT_PORT_RANGE_END = 5999;

export class VNCPortManager {
  private allocatedPorts: Map<string, number> = new Map(); // vmId -> port
  private portRangeStart: number;
  private portRangeEnd: number;

  constructor(rangeStart = DEFAULT_PORT_RANGE_START, rangeEnd = DEFAULT_PORT_RANGE_END) {
    this.portRangeStart = rangeStart;
    this.portRangeEnd = rangeEnd;
  }

  /** Allocate an available port for a VM. Returns the assigned port. */
  async allocatePort(vmId: string): Promise<number> {
    // If already allocated, return existing
    const existing = this.allocatedPorts.get(vmId);
    if (existing !== undefined) {
      log('[VNCPortManager] Reusing existing port', existing, 'for VM:', vmId);
      return existing;
    }

    // Find the first available port in range
    const usedPorts = new Set(this.allocatedPorts.values());
    for (let port = this.portRangeStart; port <= this.portRangeEnd; port++) {
      if (usedPorts.has(port)) continue;
      const available = await this.isPortAvailable(port);
      if (available) {
        this.allocatedPorts.set(vmId, port);
        log('[VNCPortManager] Allocated port', port, 'for VM:', vmId);
        return port;
      }
    }

    throw new Error(`No available VNC ports in range ${this.portRangeStart}-${this.portRangeEnd}`);
  }

  /** Release a port allocated to a VM */
  releasePort(vmId: string): void {
    const port = this.allocatedPorts.get(vmId);
    if (port !== undefined) {
      this.allocatedPorts.delete(vmId);
      log('[VNCPortManager] Released port', port, 'for VM:', vmId);
    }
  }

  /** Get the port allocated to a VM, or null */
  getPort(vmId: string): number | null {
    return this.allocatedPorts.get(vmId) ?? null;
  }

  /** Check if a TCP port is available by attempting to bind */
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

  /** Release all allocated ports */
  releaseAll(): void {
    this.allocatedPorts.clear();
    log('[VNCPortManager] Released all ports');
  }
}
