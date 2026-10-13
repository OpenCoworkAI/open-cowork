/**
 * Companion Server
 * Optional module that lets phone companion apps pair with the desktop and
 * talk to the agent over an authorized WebSocket.
 *
 * Endpoints (all on the gateway HTTP server, delegated from RemoteGateway):
 *
 *   POST /companion/pair/start      (loopback only) create a one-time pairing code
 *                                   and a QR payload for the desktop UI to render
 *   POST /companion/pair            (phone, one-time) pairing code -> device token
 *   GET  /companion/tokens          (loopback only) list paired device tokens
 *   POST /companion/tokens/revoke   (loopback only) revoke a device token
 *   WS   /companion/stream          authorized per-device stream to the agent
 *
 * Security model:
 *
 * - Pairing codes are single-use and short-lived (default 5 min). A new code
 *   invalidates the previous one.
 * - Device tokens are random 256-bit values, per device, revocable, and never
 *   logged. The loopback-only guard protects the management surface even when
 *   the gateway binds 0.0.0.0 for phone access.
 * - Pairing attempts are rate limited per IP (5 per minute), mirroring the
 *   gateway's WS auth rate limit.
 *
 * Streaming model ("subprocess-style" isolation):
 *
 * - Each authenticated phone client gets its own loopback WebSocket proxy to
 *   the gateway `ws://127.0.0.1:<gatewayPort>/ws`, authenticated with the
 *   gateway token. Frames are forwarded as-is, so the phone speaks the same
 *   wire protocol (`docs` and companion app `docs/PROTOCOL.md`) and each phone
 *   client maps to its own gateway session
 *   (key `websocket:dm:<proxyClientId>`).
 * - When no gateway port is configured (standalone/subprocess mode), frames
 *   are answered by a tiny built-in stub agent so the module can run and be
 *   tested without the Electron app.
 *
 * Standalone mode (`start()` + `scripts/companion-standalone.mjs`) runs the
 * module as its own process for development and smoke tests: the phone-facing
 * surface is identical, and the stub agent answers locally.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import * as os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import { log, logWarn, logError } from '../../utils/logger';

export interface CompanionServerOptions {
  /** Gateway port used for loopback proxy connections. Omit for stub-agent mode. */
  gatewayPort?: number;

  /** Gateway auth token (mode 'token') used to authenticate proxy connections. */
  gatewayToken?: string;

  /** Explicit LAN hosts to advertise; defaults to all non-internal IPv4 addresses. */
  hosts?: string[];

  /** Pairing code time-to-live in ms (default 5 minutes). */
  pairCodeTtlMs?: number;

  /** Maximum number of paired device tokens kept at once (default 25). */
  maxTokens?: number;
}

interface CompanionToken {
  token: string;
  label?: string;
  createdAt: number;
  lastSeenAt: number;
}

interface PairingCode {
  code: string;
  createdAt: number;
  expiresAt: number;
}

/** Wire frame of the gateway/companion WebSocket protocol. */
export interface CompanionFrame {
  type: string;
  payload?: unknown;
  requestId?: string;
}

interface StreamClient {
  id: string;
  ws: WebSocket;
  authenticated: boolean;
  proxy?: WebSocket;
  proxyAuthed: boolean;
  proxyQueue: string[];
  proxyBackoffRetries: number;
}

const PAIR_RATE_LIMIT = 5;
const PAIR_RATE_WINDOW_MS = 60_000;
const PAIR_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_PROXY_BACKOFF_RETRIES = 3;
const PROXY_RECONNECT_DELAY_MS = 5_000;

export class CompanionServer {
  private options: CompanionServerOptions;
  private wss?: WebSocketServer;
  private ownHttpServer?: http.Server;
  private standalonePort?: number;
  private tokens: Map<string, CompanionToken> = new Map();
  private pairCode?: PairingCode;
  private pairAttempts: Map<string, { count: number; resetTime: number }> = new Map();
  private clients: Map<string, StreamClient> = new Map();

  private _running: boolean = false;

  constructor(options: CompanionServerOptions = {}) {
    this.options = options;
  }

  get running(): boolean {
    return this._running;
  }

  /** Actual listening port in standalone mode (0-passed callers included). */
  get port(): number | undefined {
    return this.standalonePort;
  }

  get pairedTokenCount(): number {
    return this.tokens.size;
  }

  /**
   * Mount HTTP + WebSocket handling on an existing server (gateway mode).
   * The HTTP part is reached via RemoteGateway's /companion/* delegation;
   * the /companion/stream upgrade listener is installed directly.
   */
  attachServer(server: http.Server): void {
    this.mountStream(server);
    this._running = true;
    log('[Companion] Attached to gateway HTTP server (POST /companion/pair[...], WS /companion/stream)');
  }

  /**
   * Standalone/subprocess mode: run an own HTTP + WS server so the module can
   * be exercised (and smoke-tested) without the Electron app. In this mode the
   * built-in stub agent answers prompts locally.
   */
  async start(port: number, bind: string = '0.0.0.0'): Promise<void> {
    if (this._running) {
      throw new Error('CompanionServer is already running');
    }

    const server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });
    this.ownHttpServer = server;
    this.mountStream(server);

    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', (error) => reject(error));
      server.listen(port, bind);
    });

    // Record the actual port (useful when callers pass 0 for an ephemeral port).
    const address = server.address();
    this.standalonePort = typeof address === 'object' && address ? address.port : port;
    this._running = true;
    log(`[Companion] Standalone server listening on ${bind}:${port} (stub agent mode)`);
  }

  async stop(): Promise<void> {
    if (!this._running && !this.wss && !this.ownHttpServer) {
      return;
    }

    for (const client of this.clients.values()) {
      this.teardownClient(client, 1001, 'Companion server shutting down');
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = undefined;
    }

    if (this.ownHttpServer) {
      await new Promise<void>((resolve) => {
        this.ownHttpServer!.close(() => resolve());
      });
      this.ownHttpServer = undefined;
      this.standalonePort = undefined;
    }

    this._running = false;
    log('[Companion] Stopped');
  }

  /**
   * HTTP request entry point. In gateway mode RemoteGateway delegates all
   * /companion/* requests here; in standalone mode this is the createServer
   * handler.
   */
  handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = parseRequestUrl(req);
    const path = url.pathname;

    if (req.method === 'POST' && path === '/companion/pair/start') {
      this.handlePairStart(req, res);
      return;
    }

    if (req.method === 'POST' && path === '/companion/pair') {
      this.handlePair(req, res);
      return;
    }

    if (req.method === 'GET' && path === '/companion/tokens') {
      this.handleListTokens(req, res);
      return;
    }

    if (req.method === 'POST' && path === '/companion/tokens/revoke') {
      this.handleRevokeToken(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  // ============================================================================
  // Pairing: one-time code creation (desktop, loopback only)
  // ============================================================================

  private handlePairStart(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!isLoopbackRequest(req)) {
      logWarn('[Companion] Rejected non-loopback /companion/pair/start from', req.socket.remoteAddress);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Pairing can only be started on the desktop itself' }));
      return;
    }

    // A new code invalidates the previous one: at most one live QR at a time.
    this.pairCode = undefined;

    const ttl = this.options.pairCodeTtlMs ?? 5 * 60 * 1000;
    this.pairCode = {
      code: this.generatePairingCode(),
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
    };

    const hosts = this.getPublicHosts();
    const qrTargetPort = this.options.gatewayPort ?? this.standalonePort;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        code: this.pairCode.code,
        expiresAt: this.pairCode.expiresAt,
        hosts,
        port: qrTargetPort,
        qr: {
          app: 'opencowork',
          v: 1,
          hosts,
          port: qrTargetPort,
          code: this.pairCode.code,
        },
      })
    );

    log('[Companion] Pairing code generated (port:', String(qrTargetPort ?? '?'), ')');
  }

  // ============================================================================
  // Pairing: code -> device token (phone)
  // ============================================================================

  private handlePair(req: http.IncomingMessage, res: http.ServerResponse): void {
    const ip = req.socket.remoteAddress || 'unknown';

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
      if (body.length > 4096) {
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!this.checkPairRateLimit(ip)) {
        this.respond(res, 429, { error: 'Too many pairing attempts. Try again later.' });
        return;
      }

      let parsed: { code?: string };
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        this.respond(res, 400, { error: 'Invalid JSON body' });
        return;
      }

      const claimed = typeof parsed.code === 'string' ? parsed.code.trim().toUpperCase() : '';
      const active = this.pairCode;

      if (!active) {
        this.respond(res, 410, {
          error: 'No active pairing code. Generate one on the desktop first.',
        });
        return;
      }

      if (Date.now() > active.expiresAt) {
        this.pairCode = undefined;
        this.respond(res, 410, { error: 'Pairing code expired. Generate a new one.' });
        return;
      }

      if (claimed !== active.code) {
        logWarn('[Companion] Rejected pairing attempt with wrong code from', ip);
        this.respond(res, 400, { error: 'Invalid pairing code' });
        return;
      }

      // Single use: consume the code before issuing the token.
      this.pairCode = undefined;

      if (this.tokens.size >= (this.options.maxTokens ?? 25)) {
        // Evict the least recently seen device instead of refusing to pair.
        const oldest = [...this.tokens.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0];
        if (oldest) {
          this.tokens.delete(oldest.token);
        }
      }

      const token = `occ-${crypto.randomBytes(32).toString('hex')}`;
      this.tokens.set(token, {
        token,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      });

      const hosts = this.getPublicHosts();
      const targetPort = this.options.gatewayPort ?? this.standalonePort;

      this.respond(res, 200, {
        ok: true,
        token,
        tokenPrefix: token.slice(0, 8),
        hosts,
        port: targetPort,
        streamPath: '/companion/stream',
      });

      log('[Companion] Device paired, token issued');
      this.emitLocal({ type: 'companion.paired', payload: { tokenPrefix: token.slice(0, 8) } });
    });
  }

  // ============================================================================
  // Device token management (desktop, loopback only)
  // ============================================================================

  private handleListTokens(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!isLoopbackRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Loopback only' }));
      return;
    }

    const list = [...this.tokens.values()].map((entry) => ({
      tokenPrefix: entry.token.slice(0, 8),
      label: entry.label,
      createdAt: entry.createdAt,
      lastSeenAt: entry.lastSeenAt,
    }));
    this.respond(res, 200, { tokens: list });
  }

  private handleRevokeToken(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!isLoopbackRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Loopback only' }));
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
      if (body.length > 4096) {
        req.destroy();
      }
    });

    req.on('end', () => {
      let parsed: { token?: string };
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        this.respond(res, 400, { error: 'Invalid JSON body' });
        return;
      }

      const token = typeof parsed.token === 'string' ? parsed.token : '';
      // Accept the full token or just its prefix (for UI lists).
      let revoked = false;
      if (this.tokens.has(token)) {
        this.tokens.delete(token);
        revoked = true;
      } else if (token.length < 16) {
        for (const [key, entry] of this.tokens) {
          if (entry.token.startsWith(token) && token.length >= 4) {
            this.tokens.delete(key);
            revoked = true;
            break;
          }
        }
      }

      this.respond(res, revoked ? 200 : 404, {
        ok: revoked,
        error: revoked ? undefined : 'Unknown token',
      });
    });
  }

  // ============================================================================
  // /companion/stream — authorized phone connections
  // ============================================================================

  private mountStream(server: http.Server): void {
    this.wss = new WebSocketServer({
      server,
      path: '/companion/stream',
      perMessageDeflate: false,
    });
    this.wss.on('connection', (ws, req) => {
      void this.handleStreamConnection(ws, req);
    });
    this.wss.on('error', (error) => {
      logError('[Companion] WebSocket server error:', error);
    });
  }

  private async handleStreamConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
    const url = parseRequestUrl(req);
    const clientId = `comp-${Date.now()}-${crypto.randomUUID()}`;
    const ip = req.socket.remoteAddress || 'unknown';

    let authenticated = false;
    let label: string | undefined;

    // Fast path: token in the query string (QR identifies the device directly).
    const queryToken = url.searchParams.get('token');
    if (queryToken && this.isValidToken(queryToken)) {
      authenticated = true;
      label = queryToken;
    } else if (queryToken) {
      logWarn('[Companion] Rejected connection with invalid query token from', ip);
      sendFrame(ws, {
        type: 'auth_result',
        payload: { success: false, error: 'Invalid token' },
      });
      ws.close(4401, 'Invalid token');
      return;
    }

    const client: StreamClient = {
      id: clientId,
      ws,
      authenticated,
      proxyAuthed: false,
      proxyQueue: [],
      proxyBackoffRetries: 0,
    };

    ws.on('message', (data: Buffer) => {
      try {
        this.handleClientFrame(client, data);
      } catch (error) {
        logError('[Companion] Error handling client frame:', error);
      }
    });
    ws.on('close', () => {
      this.teardownClient(client, 1000);
      this.clients.delete(clientId);
      log('[Companion] Phone client disconnected:', clientId);
    });
    ws.on('error', (error) => {
      logError('[Companion] Phone client error:', clientId, error);
    });

    this.clients.set(clientId, client);

    sendFrame(ws, { type: 'connected', payload: { clientId } });

    if (!authenticated) {
      // Wait for an `auth` frame; 30 s to authenticate or we drop the socket.
      setTimeout(() => {
        if (!client.authenticated) {
          sendFrameToClient(client, {
            type: 'error',
            payload: { error: 'Authentication timeout' },
          });
          ws.close(4408, 'Authentication timeout');
        }
      }, 30_000).unref?.();
      return;
    }

    await this.setupProxy(client, label);
  }

  private handleClientFrame(client: StreamClient, data: Buffer): void {
    let frame: CompanionFrame;
    try {
      frame = JSON.parse(data.toString('utf8'));
    } catch {
      sendFrameToClient(client, { type: 'error', payload: { error: 'Invalid JSON' } });
      return;
    }

    if (frame.type === 'auth') {
      const { token } = (frame.payload ?? {}) as { token?: string };
      const valid = typeof token === 'string' && this.isValidToken(token);
      client.authenticated = valid;
      sendFrameToClient(client, {
        type: 'auth_result',
        payload: { success: valid, error: valid ? undefined : 'Invalid token' },
        requestId: frame.requestId,
      });
      if (valid) {
        void this.setupProxy(client, token);
      } else {
        logWarn('[Companion] Auth frame with invalid token');
      }
      return;
    }

    if (!client.authenticated) {
      sendFrameToClient(client, {
        type: 'error',
        payload: { error: 'Not authenticated' },
        requestId: frame.requestId,
      });
      return;
    }

    // Touch token last-seen for session bookkeeping.
    this.touchToken();

    if (client.proxy) {
      // Forward the frames the phone already knows (docs/PROTOCOL.md): after
      // companion auth these are message / ping / session.list / session.*.
      enqueueProxyFrame(client, JSON.stringify(frame));
      return;
    }

    // Stub agent mode (standalone/subprocess): answer locally so the module
    // runs and is testable without the Electron app.
    this.handleStubFrame(client, frame);
  }

  private handleStubFrame(client: StreamClient, frame: CompanionFrame): void {
    switch (frame.type) {
      case 'ping':
        sendFrameToClient(client, { type: 'pong', payload: {}, requestId: frame.requestId });
        break;

      case 'message': {
        const { text } = (frame.payload ?? {}) as { text?: string };
        const answer = text?.trim()
          ? `[companion stub agent] ${text}`
          : '[companion stub agent] (empty message)';
        sendFrameToClient(client, {
          type: 'response',
          payload: { text: answer, done: false },
        });
        sendFrameToClient(client, {
          type: 'response',
          payload: { text: '', done: true },
        });
        break;
      }

      case 'session.list':
        sendFrameToClient(client, {
          type: 'sessions',
          payload: { sessions: [] },
          requestId: frame.requestId,
        });
        break;

      default:
        log('[Companion] Ignoring frame type in stub mode:', frame.type);
    }
  }

  // ============================================================================
  // Loopback proxy toward the gateway
  // ============================================================================

  private async setupProxy(client: StreamClient, tokenOfClient?: string): Promise<void> {
    const gatewayPort = this.options.gatewayPort;
    if (!gatewayPort) {
      // Stub mode: no real agent behind, keep answering locally.
      if (tokenOfClient) {
        const entry = this.tokens.get(tokenOfClient);
        if (entry) {
          entry.lastSeenAt = Date.now();
        }
      }
      return;
    }

    if (client.proxy) {
      return; // Already proxied.
    }

    const markAuthed = () => {
      if (!client.proxyAuthed) {
        client.proxyAuthed = true;
        const activeProxy = client.proxy;
        if (activeProxy) {
          for (const queued of client.proxyQueue) {
            activeProxy.send(queued);
          }
        }
        client.proxyQueue = [];
      }
      sendFrameToClient(client, { type: 'auth_result', payload: { success: true } });
    };

    const proxy = new WebSocket(`ws://127.0.0.1:${gatewayPort}/ws`);

    proxy.on('open', () => {
      // Authentication frame toward the actual gateway. In non-token gateway
      // auth modes the gateway accepts any token and just marks us authed.
      proxy.send(JSON.stringify({ type: 'auth', payload: { token: this.options.gatewayToken } }));
      client.proxyBackoffRetries = 0;
    });

    proxy.on('message', (data: Buffer) => {
      let frame: CompanionFrame;
      try {
        frame = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }

      if (frame.type === 'auth_result') {
        const success = Boolean((frame.payload as { success?: boolean } | undefined)?.success);
        if (success) {
          markAuthed();
        } else {
          logError('[Companion] Gateway rejected proxy auth:', frame.payload);
          sendFrameToClient(client, {
            type: 'error',
            payload: { error: 'Gateway rejected companion connection' },
          });
          client.ws.close(4403, 'Gateway auth failed');
        }
        return;
      }

      sendFrameToClient(client, frame);
    });

    proxy.on('close', () => {
      if (!this.clients.has(client.id)) {
        return; // Client already gone.
      }
      client.proxy = undefined;
      client.proxyAuthed = false;
      client.proxyQueue = [];

      const retries = ++client.proxyBackoffRetries;
      if (retries <= MAX_PROXY_BACKOFF_RETRIES) {
        logWarn('[Companion] Proxy connection closed, retry', retries);
        setTimeout(() => {
          void this.setupProxy(client);
        }, PROXY_RECONNECT_DELAY_MS * retries).unref?.();
      } else {
        sendFrameToClient(client, {
          type: 'error',
          payload: { error: 'Lost connection to the agent gateway' },
        });
        client.ws.close(1011, 'Gateway unavailable');
      }
    });

    proxy.on('error', (error) => {
      logError('[Companion] Proxy error:', error);
    });

    client.proxy = proxy;
  }

  private teardownClient(client: StreamClient, code: number, reason?: string): void {
    try {
      if (client.proxy) {
        client.proxy.removeAllListeners();
        client.proxy.close(1000, 'Client left');
      }
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close(code, reason || 'Closing');
      }
    } catch (error) {
      logWarn('[Companion] Error during client teardown:', error);
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private isValidToken(token: string): boolean {
    return this.tokens.has(token) || (this.options.gatewayToken !== undefined && token === this.options.gatewayToken);
  }

  private touchToken(): void {
    for (const entry of this.tokens.values()) {
      entry.lastSeenAt = Date.now();
    }
  }

  private checkPairRateLimit(ip: string): boolean {
    const now = Date.now();
    const attempt = this.pairAttempts.get(ip);
    if (!attempt || now > attempt.resetTime) {
      this.pairAttempts.set(ip, { count: 1, resetTime: now + PAIR_RATE_WINDOW_MS });
      return true;
    }
    attempt.count++;
    return attempt.count <= PAIR_RATE_LIMIT;
  }

  private generatePairingCode(): string {
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += PAIR_CODE_ALPHABET[crypto.randomInt(PAIR_CODE_ALPHABET.length)];
    }
    return code;
  }

  private getPublicHosts(): string[] {
    if (this.options.hosts && this.options.hosts.length > 0) {
      return this.options.hosts;
    }
    const hosts: string[] = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const entry of list || []) {
        if (entry.family === 'IPv4' && !entry.internal) {
          hosts.push(entry.address);
        }
      }
    }
    return hosts;
  }

  private respond(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private emitLocal(event: CompanionFrame): void {
    log('[Companion] Event:', event.type, JSON.stringify(event.payload));
  }
}

// ============================================================================
// Module-level helpers (avoid per-instance closures)
// ============================================================================

function parseRequestUrl(req: http.IncomingMessage): URL {
  return new URL(req.url || '/', 'http://localhost');
}

function isLoopbackRequest(req: http.IncomingMessage): boolean {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function sendFrame(ws: WebSocket, frame: CompanionFrame): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

function sendFrameToClient(
  client: StreamClient,
  frame: CompanionFrame
): void {
  sendFrame(client.ws, frame);
}

/**
 * Queue a frame toward the gateway until the proxy handshake completes.
 */
function enqueueProxyFrame(client: StreamClient, serialized: string): void {    if (client.proxy && client.proxyAuthed) {
      client.proxy.send(serialized);
      return;
    }
  client.proxyQueue.push(serialized);
}
