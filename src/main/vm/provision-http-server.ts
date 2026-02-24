/**
 * Provision HTTP Server - Serves provisioning files to guest VMs
 *
 * Runs a tiny HTTP server on the host, accessible from VirtualBox NAT guests
 * at http://10.0.2.2:<port>/. Serves bootstrap scripts, Node.js bundles,
 * Navi agent bundles, and config files. Accepts status POSTs from the guest.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { log, logError } from '../utils/logger';
import type { GuestProvisionPhase } from './types';

const DEFAULT_PORT = 9580;

export interface ProvisionStatusUpdate {
  phase: GuestProvisionPhase;
  message: string;
  progress?: number;
  timestamp?: number;
}

export class ProvisionHTTPServer {
  private server: http.Server | null = null;
  private port: number;
  private servingDir: string;
  private latestStatus: ProvisionStatusUpdate | null = null;
  private statusCallback: ((status: ProvisionStatusUpdate) => void) | null = null;

  constructor(servingDir: string, port = DEFAULT_PORT) {
    this.servingDir = servingDir;
    this.port = port;
  }

  setStatusCallback(cb: (status: ProvisionStatusUpdate) => void): void {
    this.statusCallback = cb;
  }

  getLatestStatus(): ProvisionStatusUpdate | null {
    return this.latestStatus;
  }

  getPort(): number {
    return this.port;
  }

  async start(): Promise<void> {
    if (this.server) return;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err) => {
        logError('[ProvisionHTTP] Server error:', err.message);
        reject(err);
      });

      this.server.listen(this.port, '0.0.0.0', () => {
        log(`[ProvisionHTTP] Serving ${this.servingDir} on port ${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        log('[ProvisionHTTP] Server stopped');
        this.server = null;
        resolve();
      });
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const method = req.method || 'GET';
    const urlPath = req.url || '/';

    log(`[ProvisionHTTP] ${method} ${urlPath}`);

    // CORS headers for any origin (local network only)
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (method === 'POST' && urlPath === '/status') {
      this.handleStatusPost(req, res);
      return;
    }

    if (method === 'GET') {
      this.handleFileGet(urlPath, res);
      return;
    }

    res.writeHead(405);
    res.end('Method not allowed');
  }

  private handleStatusPost(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const status: ProvisionStatusUpdate = JSON.parse(body);
        status.timestamp = status.timestamp || Date.now();
        this.latestStatus = status;
        log(`[ProvisionHTTP] Status update: ${status.phase} - ${status.message}`);

        if (this.statusCallback) {
          this.statusCallback(status);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        logError('[ProvisionHTTP] Bad status POST:', body);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  private handleFileGet(urlPath: string, res: http.ServerResponse): void {
    // Sanitize path to prevent traversal
    const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = path.join(this.servingDir, safePath);

    // Ensure the resolved path is within the serving directory
    if (!filePath.startsWith(this.servingDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.sh': 'text/plain',
      '.json': 'application/json',
      '.js': 'application/javascript',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      '.tgz': 'application/gzip',
    };

    const contentType = contentTypes[ext] || 'application/octet-stream';
    const stat = fs.statSync(filePath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
    });

    fs.createReadStream(filePath).pipe(res);
  }
}
