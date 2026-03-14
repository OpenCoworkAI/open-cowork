/**
 * Browser Extension API Server
 *
 * Local HTTP server running inside the Electron main process that exposes
 * a REST API for the Open Cowork browser extension. This enables the
 * extension to:
 *
 * 1. Report browser-tracked activities to the desktop progress tracker
 * 2. Query active sessions, trace steps, and workspace info
 * 3. Trigger agent actions from browser context
 * 4. Get sandbox/VM status
 *
 * The server binds to localhost only (127.0.0.1) for security.
 * Default port: 3777
 */

import * as http from 'http';
import { log, logError, logWarn } from '../utils/logger';

export interface BrowserAPIServerOptions {
  port?: number;
  getSessionManager: () => any; // SessionManager
  getWorkingDir: () => string | null;
  getSandboxAdapter: () => any;
  getConfigStore: () => any;
  getSkillsManager?: () => any;
  getMCPManager?: () => any;
}

interface BrowserActivity {
  id: string;
  category: string;
  hostname: string;
  title: string;
  url?: string;
  startTime: number;
  endTime: number;
  duration: number;
  date: string;
  contentSignals?: Record<string, unknown>;
}

// Store browser activities in memory (flushed periodically)
const browserActivities: Map<string, BrowserActivity[]> = new Map();
const browserSummaries: Map<string, unknown> = new Map();

// SSE clients for real-time events
const sseClients: Set<http.ServerResponse> = new Set();

export class BrowserAPIServer {
  private server: http.Server | null = null;
  private port: number;
  private options: BrowserAPIServerOptions;

  constructor(options: BrowserAPIServerOptions) {
    this.port = options.port || 3777;
    this.options = options;
  }

  /**
   * Start the API server.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          logError('[BrowserAPI] Request error:', err);
          this.sendJson(res, 500, { error: 'Internal server error' });
        });
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        log(`[BrowserAPI] Server started on http://127.0.0.1:${this.port}`);
        resolve();
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          logWarn(`[BrowserAPI] Port ${this.port} in use, trying ${this.port + 1}`);
          this.port += 1;
          this.server!.listen(this.port, '127.0.0.1');
        } else {
          logError('[BrowserAPI] Server error:', err);
          reject(err);
        }
      });
    });
  }

  /**
   * Stop the API server.
   */
  async stop(): Promise<void> {
    // Close all SSE connections
    for (const client of sseClients) {
      client.end();
    }
    sseClients.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          log('[BrowserAPI] Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Broadcast an event to all connected SSE clients.
   */
  broadcastEvent(event: unknown): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      client.write(data);
    }
  }

  /**
   * Get the port the server is running on.
   */
  getPort(): number {
    return this.port;
  }

  // ---------------------------------------------------------------------------
  // Request router
  // ---------------------------------------------------------------------------

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS headers for browser extension
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Source, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);
    const path = url.pathname;
    const method = req.method || 'GET';

    // Route matching
    if (path === '/api/health' && method === 'GET') {
      return this.handleHealth(req, res);
    }

    if (path === '/api/sessions' && method === 'GET') {
      return this.handleListSessions(req, res);
    }

    if (path === '/api/sessions' && method === 'POST') {
      return this.handleStartSession(req, res);
    }

    const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionMatch && method === 'GET') {
      return this.handleGetSession(req, res, sessionMatch[1]);
    }

    const messagesMatch = path.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    if (messagesMatch && method === 'GET') {
      return this.handleGetMessages(req, res, messagesMatch[1]);
    }

    const traceMatch = path.match(/^\/api\/sessions\/([^/]+)\/trace$/);
    if (traceMatch && method === 'GET') {
      return this.handleGetTrace(req, res, traceMatch[1]);
    }

    const continueMatch = path.match(/^\/api\/sessions\/([^/]+)\/continue$/);
    if (continueMatch && method === 'POST') {
      return this.handleContinueSession(req, res, continueMatch[1]);
    }

    const stopMatch = path.match(/^\/api\/sessions\/([^/]+)\/stop$/);
    if (stopMatch && method === 'POST') {
      return this.handleStopSession(req, res, stopMatch[1]);
    }

    if (path === '/api/browser/activities' && method === 'POST') {
      return this.handleReportActivities(req, res);
    }

    if (path === '/api/browser/activities' && method === 'GET') {
      return this.handleGetBrowserActivities(req, res);
    }

    if (path === '/api/browser/summary' && method === 'POST') {
      return this.handleReportSummary(req, res);
    }

    if (path === '/api/browser/summary' && method === 'GET') {
      return this.handleGetBrowserSummary(req, res);
    }

    if (path === '/api/workspace' && method === 'GET') {
      return this.handleGetWorkspace(req, res);
    }

    if (path === '/api/sandbox/status' && method === 'GET') {
      return this.handleGetSandboxStatus(req, res);
    }

    if (path === '/api/config' && method === 'GET') {
      return this.handleGetConfig(req, res);
    }

    if (path === '/api/skills' && method === 'GET') {
      return this.handleListSkills(req, res);
    }

    if (path === '/api/mcp/servers' && method === 'GET') {
      return this.handleListMCP(req, res);
    }

    if (path === '/api/events' && method === 'GET') {
      return this.handleSSE(req, res);
    }

    this.sendJson(res, 404, { error: 'Not found' });
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  private async handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const sandbox = this.options.getSandboxAdapter?.();
    this.sendJson(res, 200, {
      ok: true,
      version: '1.0.0',
      app: 'open-cowork',
      sandbox: sandbox?.mode || 'native',
      timestamp: Date.now(),
    });
  }

  private async handleListSessions(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const sm = this.options.getSessionManager();
    if (!sm) return this.sendJson(res, 503, { error: 'Session manager not ready' });
    const sessions = sm.listSessions();
    this.sendJson(res, 200, { sessions });
  }

  private async handleGetSession(_req: http.IncomingMessage, res: http.ServerResponse, sessionId: string): Promise<void> {
    const sm = this.options.getSessionManager();
    if (!sm) return this.sendJson(res, 503, { error: 'Session manager not ready' });
    const sessions = sm.listSessions();
    const session = sessions.find((s: any) => s.id === sessionId);
    if (!session) return this.sendJson(res, 404, { error: 'Session not found' });
    this.sendJson(res, 200, { session });
  }

  private async handleGetMessages(_req: http.IncomingMessage, res: http.ServerResponse, sessionId: string): Promise<void> {
    const sm = this.options.getSessionManager();
    if (!sm) return this.sendJson(res, 503, { error: 'Session manager not ready' });
    const messages = sm.getMessages(sessionId);
    this.sendJson(res, 200, { messages });
  }

  private async handleGetTrace(_req: http.IncomingMessage, res: http.ServerResponse, sessionId: string): Promise<void> {
    const sm = this.options.getSessionManager();
    if (!sm) return this.sendJson(res, 503, { error: 'Session manager not ready' });
    const steps = sm.getTraceSteps(sessionId);
    this.sendJson(res, 200, { steps });
  }

  private async handleStartSession(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const sm = this.options.getSessionManager();
    if (!sm) return this.sendJson(res, 503, { error: 'Session manager not ready' });
    const body = await this.readBody(req);
    const payload = body.payload || body;
    const session = await sm.startSession(
      payload.title || 'Browser Session',
      payload.prompt,
      payload.cwd || this.options.getWorkingDir(),
      payload.allowedTools,
    );
    this.sendJson(res, 201, { session });
  }

  private async handleContinueSession(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string): Promise<void> {
    const sm = this.options.getSessionManager();
    if (!sm) return this.sendJson(res, 503, { error: 'Session manager not ready' });
    const body = await this.readBody(req);
    const prompt = body.payload?.prompt || body.prompt;
    if (!prompt) return this.sendJson(res, 400, { error: 'Missing prompt' });
    await sm.continueSession(sessionId, prompt);
    this.sendJson(res, 200, { ok: true });
  }

  private async handleStopSession(_req: http.IncomingMessage, res: http.ServerResponse, sessionId: string): Promise<void> {
    const sm = this.options.getSessionManager();
    if (!sm) return this.sendJson(res, 503, { error: 'Session manager not ready' });
    sm.stopSession(sessionId);
    this.sendJson(res, 200, { ok: true });
  }

  private async handleReportActivities(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const activities = body.activities as BrowserActivity[];
    if (!Array.isArray(activities)) {
      return this.sendJson(res, 400, { error: 'Invalid activities payload' });
    }

    // Store by date
    for (const activity of activities) {
      const date = activity.date || new Date().toISOString().slice(0, 10);
      const existing = browserActivities.get(date) || [];
      existing.push(activity);
      browserActivities.set(date, existing);
    }

    // Broadcast to SSE clients
    this.broadcastEvent({
      type: 'browser.activities',
      payload: { count: activities.length, source: body.source },
    });

    log(`[BrowserAPI] Received ${activities.length} browser activities`);
    this.sendJson(res, 200, { ok: true, received: activities.length });
  }

  private async handleGetBrowserActivities(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(_req.url || '/', `http://127.0.0.1:${this.port}`);
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const activities = browserActivities.get(date) || [];
    this.sendJson(res, 200, { date, activities, count: activities.length });
  }

  private async handleReportSummary(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const summary = body.summary;
    if (!summary) return this.sendJson(res, 400, { error: 'Missing summary' });
    browserSummaries.set(summary.date || new Date().toISOString().slice(0, 10), summary);

    this.broadcastEvent({
      type: 'browser.summary',
      payload: { date: summary.date },
    });

    this.sendJson(res, 200, { ok: true });
  }

  private async handleGetBrowserSummary(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(_req.url || '/', `http://127.0.0.1:${this.port}`);
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const summary = browserSummaries.get(date) || null;
    this.sendJson(res, 200, { date, summary });
  }

  private async handleGetWorkspace(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.sendJson(res, 200, { path: this.options.getWorkingDir() || '' });
  }

  private async handleGetSandboxStatus(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const sandbox = this.options.getSandboxAdapter?.();
    this.sendJson(res, 200, {
      mode: sandbox?.mode || 'native',
      initialized: sandbox?.initialized || false,
    });
  }

  private async handleGetConfig(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const config = this.options.getConfigStore?.();
    if (!config) return this.sendJson(res, 200, { configured: false });
    // Don't expose the API key
    const all = config.getAll?.() || {};
    const { apiKey, ...safeConfig } = all;
    this.sendJson(res, 200, {
      configured: config.isConfigured?.() || false,
      provider: safeConfig.provider,
      model: safeConfig.model,
      hasApiKey: !!apiKey,
    });
  }

  private async handleListSkills(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const sm = this.options.getSkillsManager?.();
    if (!sm) return this.sendJson(res, 200, { skills: [] });
    try {
      const skills = sm.getSkills?.() || [];
      this.sendJson(res, 200, { skills });
    } catch {
      this.sendJson(res, 200, { skills: [] });
    }
  }

  private async handleListMCP(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const mcpManager = this.options.getMCPManager?.();
    if (!mcpManager) return this.sendJson(res, 200, { servers: [] });
    try {
      const servers = mcpManager.getConnectedServers?.() || [];
      this.sendJson(res, 200, { servers });
    } catch {
      this.sendJson(res, 200, { servers: [] });
    }
  }

  private handleSSE(_req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial heartbeat
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

    sseClients.add(res);

    _req.on('close', () => {
      sseClients.delete(res);
    });
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private readBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const MAX_BODY = 5 * 1024 * 1024; // 5MB limit

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          reject(new Error('Request body too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve({});
        }
      });

      req.on('error', reject);
    });
  }
}
