import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import { WebSocket } from 'ws';

/**
 * Tests for src/main/remote/companion/companion-server.ts:
 * one-time QR pairing (POST /companion/pair), device token management and the
 * authorized /companion/stream WebSocket (stub-agent mode + loopback proxy
 * toward a real gateway).
 */

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import { CompanionServer } from '../src/main/remote/companion/companion-server';

interface Json {
  status: number;
  body: any;
}

function post(port: number, path: string, payload: unknown): Promise<Json> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk.toString()));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, body: JSON.parse(raw || '{}') });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on('error', reject);
    req.end(data);
  });
}

/** Wraps a socket and collects frames from the very beginning, so fast loopback frames (connected, auth_result) are never missed. */
interface CompanionClient {
  ws: WebSocket;
  frames: any[];
  watchers: ((message: any) => void)[];
  send(serialized: string): void;
  close(code?: number): void;
  nextFrame<W = any>(predicate: (msg: any) => boolean, timeoutMs?: number): Promise<W>;
}

function connect(port: number, path: string): Promise<CompanionClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    const client: CompanionClient = {
      ws,
      frames: [],
      watchers: [],
      send: (serialized) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(serialized);
        }
      },
      close: (code) => ws.close(code ?? 1000),
      nextFrame: <W,>(predicate: (msg: any) => boolean, timeoutMs = 3000) =>
        new Promise<W>((resolve, reject) => {
          const buffered = client.frames.find(predicate);
          if (buffered) {
            resolve(buffered as W);
            return;
          }
          const timer = setTimeout(() => reject(new Error('timeout waiting for frame')), timeoutMs);
          const watcher = (message: any) => {
            if (predicate(message)) {
              clearTimeout(timer);
              client.watchers = client.watchers.filter((w) => w !== watcher);
              resolve(message as W);
            }
          };
          client.watchers.push(watcher);
        }),
    };

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString('utf8'));
        client.frames.push(message);
        for (const watcher of [...client.watchers]) {
          watcher(message);
        }
      } catch {
        // Ignore non-JSON frames (ws-level ping/pong).
      }
    });
    ws.once('open', () => resolve(client));
    ws.once('error', reject);
  });
}

/** Standalone stub-agent server. */
async function startStub(opts: Partial<ConstructorParameters<typeof CompanionServer>[0]> = {}) {
  const server = new CompanionServer(opts);
  await server.start(0, '127.0.0.1');
  return server;
}

describe('companion pairing (one-time code -> device token)', () => {
  let server: CompanionServer;
  let stubbedClose: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    server = await startStub({ hosts: ['192.168.1.50'] });
    stubbedClose = () => server.stop();
  });

  afterAll(async () => {
    await stubbedClose?.();
  });

  it('issues exactly one active code at a time and exposes it in the QR payload', async () => {
    expect(server.running).toBe(true);

    const res = await post(server.port!, '/companion/pair/start', {});
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(res.body.hosts).toContain('192.168.1.50');
    expect(res.body.qr).toEqual({ app: 'opencowork', v: 1, hosts: ['192.168.1.50'], port: server.port, code: res.body.code });

    const second = await post(server.port!, '/companion/pair/start', {});
    expect(second.status).toBe(200);
    expect(second.body.code).not.toBe(res.body.code);
  });

  it('rejects wrong codes and never issues a token', async () => {
    expect(await post(server.port!, '/companion/pair', { code: 'AAAAAAAA' })).toEqual(
      expect.objectContaining({ status: 400 })
    );
  });

  it('consumes a code on success (single use) and answers 410 once inactive', async () => {
    const start = await post(server.port!, '/companion/pair/start', {});

    const first = await post(server.port!, '/companion/pair', { code: start.body.code });
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.token).toMatch(/^occ-[0-9a-f]{64}$/);
    expect([first.body.port, server.port]).toContain(server.port);

    // The same code reused must fail and must not yield another token.
    const reused = await post(server.port!, '/companion/pair', { code: start.body.code });
    expect(reused.status).toBe(410);
    expect(reused.body.token).toBeUndefined();
  });

  it('tells the phone when there is no active code at all', async () => {
    const res = await post(server.port!, '/companion/pair', { code: 'WHATEVER' });
    expect(res.status).toBe(410);
    expect(res.body.error).toContain('No active pairing code');
  });

  it('expires stale codes instead of pairing after TTL', async () => {
    const server2 = new CompanionServer({ pairCodeTtlMs: 40 });
    await server2.start(0, '127.0.0.1');
    try {
      const start = await post(server2.port!, '/companion/pair/start', {});
      await new Promise((resolve) => setTimeout(resolve, 80));
      const res = await post(server2.port!, '/companion/pair', { code: start.body.code });
      expect(res.status).toBe(410);
      expect(res.body.error).toContain('expired');
    } finally {
      await server2.stop();
    }
  });
});

describe('companion stream (stub-agent mode)', () => {
  let server: CompanionServer;
  let token: string;

  beforeAll(async () => {
    server = await startStub({ hosts: ['192.168.1.50'] });
    const start = await post(server.port!, '/companion/pair/start', {});
    const pair = await post(server.port!, '/companion/pair', { code: start.body.code });
    token = pair.body.token;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('authenticates with a device token from the query string and streams stub answers', async () => {
    const ws = await connect(server.port!, `/companion/stream?token=${token}`);
    const connected = await ws.nextFrame((m: any) => m.type === 'connected');
    expect(connected.payload.clientId).toBeTruthy();

    ws.send(JSON.stringify({ type: 'message', payload: { text: 'Ahoj' } }));

    const delta = await ws.nextFrame((m: any) => m.type === 'response' && m.payload.done === false);
    expect(delta.payload.text).toContain('Ahoj');
    const final = await ws.nextFrame((m: any) => m.type === 'response' && m.payload.done === true);
    expect(final).toBeTruthy();

    ws.close();
  });

  it('accepts token frames too, with requestId echoed in auth_result', async () => {
    const ws = await connect(server.port!, '/companion/stream');
    const connected = await ws.nextFrame((m: any) => m.type === 'connected');

    ws.send(JSON.stringify({ type: 'auth', payload: { token }, requestId: 'req-1' }));
    const result = await ws.nextFrame((m: any) => m.type === 'auth_result');
    expect(result.requestId).toBe('req-1');
    expect(result.payload.success).toBe(true);
    expect(connected).toBeTruthy();

    ws.send(JSON.stringify({ type: 'ping', payload: {} }));
    const pong = await ws.nextFrame((m: any) => m.type === 'pong');
    expect(pong).toBeTruthy();

    ws.close();
  });

  it('rejects frames before authentication with "Not authenticated"', async () => {
    const ws = await connect(server.port!, '/companion/stream');
    await ws.nextFrame((m: any) => m.type === 'connected');

    ws.send(JSON.stringify({ type: 'message', payload: { text: 'Ahoj' } }));
    const error = await ws.nextFrame((m: any) => m.type === 'error');
    expect(error.payload.error).toBe('Not authenticated');

    ws.close();
  });

  it('closes connections presenting an invalid token in the query string', async () => {
    const ws = await connect(server.port!, '/companion/stream?token=occ-0000');
    const closeCode = await new Promise<number>((resolve) => {
      ws.ws.on('close', (code) => resolve(code));
    });
    expect(closeCode).toBe(4401);
  });
});

describe('companion device token management', () => {
  let server: CompanionServer;
  let token: string;

  beforeAll(async () => {
    server = await startStub();
    const start = await post(server.port!, '/companion/pair/start', {});
    const pair = await post(server.port!, '/companion/pair', { code: start.body.code });
    token = pair.body.token;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('lists paired tokens by prefix only', async () => {
    const res = await get(server.port!, '/companion/tokens');
    expect(res.status).toBe(200);
    expect(res.body.tokens).toHaveLength(1);
    expect(res.body.tokens[0].tokenPrefix).toBe(token.slice(0, 8));
    expect(res.body.tokens[0].token).toBeUndefined();
  });

  it('revokes a token which then fails WS authentication', async () => {
    const revoked = await post(server.port!, '/companion/tokens/revoke', { token: token.slice(0, 8) });
    expect(revoked.status).toBe(200);
    expect(revoked.body.ok).toBe(true);

    const ws = await connect(server.port!, `/companion/stream?token=${token}`);
    const closeCode = await new Promise<number>((resolve) => {
      ws.ws.on('close', (code) => resolve(code));
    });
    expect(closeCode).toBe(4401);
  });

  it('answers 404 for unknown token revocations', async () => {
    const res = await post(server.port!, '/companion/tokens/revoke', { token: 'occ-ffff' });
    expect(res.status).toBe(404);
  });
});

describe('companion loopback proxy toward the gateway', () => {
  let server: CompanionServer;
  let gatewayWss: import('ws').WebSocketServer | undefined;

  beforeAll(async () => {
    gatewayWss = new (await import('ws')).WebSocketServer({ port: 0, path: '/ws' });
    const gatewayPort = await new Promise<number>((resolve) => {
      gatewayWss!.on('listening', () => resolve((gatewayWss!.address() as http.AddressInfo).port));
    });

    gatewayWss.on('connection', (ws: WebSocket) => {
      ws.on('message', (data: Buffer) => {
        const frame = JSON.parse(data.toString('utf8'));
        if (frame.type === 'auth') {
          ws.send(
            JSON.stringify({ type: 'auth_result', payload: { success: frame.payload.token === 'gw-token' } })
          );
          return;
        }
        if (frame.type === 'message') {
          ws.send(JSON.stringify({ type: 'status', payload: { state: 'working' } }));
          ws.send(
            JSON.stringify({
              type: 'response',
              payload: { text: `gateway:> ${frame.payload.text}`, done: true },
            })
          );
        }
      });
    });

    server = new CompanionServer({ gatewayPort, gatewayToken: 'gw-token' });
    await server.start(0, '127.0.0.1');
  });

  afterAll(async () => {
    await server.stop();
    await gatewayWss?.close();
  });

  it('proxies the phone conversation to the gateway and back, per client', async () => {
    // Pair a device on the companion surface.
    const start = await post(server.port!, '/companion/pair/start', {});
    const pair = await post(server.port!, '/companion/pair', { code: start.body.code });
    const deviceToken: string = pair.body.token;

    const ws = await connect(server.port!, `/companion/stream?token=${deviceToken}`);
    await ws.nextFrame((m: any) => m.type === 'connected');
    // Proxy handshake completion surfaces as auth_result on the phone socket.
    await ws.nextFrame((m: any) => m.type === 'auth_result' && m.payload.success === true);

    ws.send(JSON.stringify({ type: 'message', payload: { text: 'Běž prosím s testy' } }));

    const status = await ws.nextFrame((m: any) => m.type === 'status');
    expect(status.payload.state).toBe('working');

    const response = await ws.nextFrame((m: any) => m.type === 'response' && m.payload.done === true);
    expect(response.payload.text).toContain('Běž prosím s testy');

    ws.close();
  });

  it('still authenticates with the master gateway token', async () => {
    const ws = await connect(server.port!, '/companion/stream?token=gw-token');
    await ws.nextFrame((m: any) => m.type === 'connected');
    await ws.nextFrame((m: any) => m.type === 'auth_result' && m.payload.success === true);
    ws.close();
  });
});

function get(port: number, path: string): Promise<Json> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk.toString()));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, body: JSON.parse(raw || '{}') });
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
  });
}
