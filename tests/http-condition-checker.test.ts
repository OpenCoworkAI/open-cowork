import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  HttpConditionChecker,
  type HttpConditionCheckErrorCode,
} from '../src/main/schedule/http-condition-checker';
import type { HttpWatchConfig, WatchCompareMode } from '../src/shared/schedule/watch-task';

const checker = new HttpConditionChecker();
const MAX_RESPONSE_BYTES = 1_048_576;

type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

function checkConfig(url: string, compareMode: WatchCompareMode): HttpWatchConfig {
  return {
    checkType: 'http',
    compareMode,
    checkConfig: { url, method: 'GET', timeoutMs: 1_000 },
  };
}

async function withServer<T>(
  handler: RequestHandler,
  runWithServer: (baseUrl: string) => Promise<T>
): Promise<T> {
  const server = createServer(handler);
  server.listen(0);
  await once(server, 'listening');

  try {
    return await runWithServer(serverUrl(server));
  } finally {
    await closeServer(server);
  }
}

function serverUrl(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected ephemeral HTTP server to expose a TCP port.');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function expectCheckError(
  operation: Promise<string>,
  code: HttpConditionCheckErrorCode
): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    name: 'HttpConditionCheckError',
    code,
  });
}

describe('HttpConditionChecker', () => {
  it('returns a SHA-256 hash of raw GET response bytes', async () => {
    await withServer(
      (_request, response) => response.end('hello'),
      async (baseUrl) => {
        await expect(checker.check(checkConfig(baseUrl, 'bodyHash'))).resolves.toBe(
          '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
        );
      }
    );
  });

  it('returns the same hash for unchanged consecutive response bytes', async () => {
    await withServer(
      (_request, response) => response.end('hello'),
      async (baseUrl) => {
        const firstHash = await checker.check(checkConfig(baseUrl, 'bodyHash'));
        const secondHash = await checker.check(checkConfig(baseUrl, 'bodyHash'));
        expect(secondHash).toBe(firstHash);
      }
    );
  });

  it('returns a HEAD response status without hashing its body', async () => {
    let observedMethod = '';
    await withServer(
      (request, response) => {
        observedMethod = request.method ?? '';
        response.writeHead(204);
        response.end();
      },
      async (baseUrl) => {
        const headConfig: HttpWatchConfig = {
          ...checkConfig(baseUrl, 'status'),
          checkConfig: { url: baseUrl, method: 'HEAD', timeoutMs: 1_000 },
        };
        await expect(checker.check(headConfig)).resolves.toBe('204');
      }
    );
    expect(observedMethod).toBe('HEAD');
  });

  it('returns a 500 status as an observation', async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(500);
        response.end('server failure');
      },
      async (baseUrl) => expect(checker.check(checkConfig(baseUrl, 'status'))).resolves.toBe('500')
    );
  });

  it('follows a relative redirect', async () => {
    await withServer(
      (request, response) => {
        if (request.url === '/nested/start') {
          response.writeHead(302, { location: '../final' });
          response.end();
          return;
        }
        response.writeHead(201);
        response.end();
      },
      async (baseUrl) =>
        expect(checker.check(checkConfig(`${baseUrl}/nested/start`, 'status'))).resolves.toBe('201')
    );
  });

  it('follows exactly three redirects', async () => {
    const redirects = new Map([
      ['/one', '/two'],
      ['/two', '/three'],
      ['/three', '/final'],
    ]);
    await withServer(
      (request, response) => {
        const location = redirects.get(request.url ?? '');
        if (location !== undefined) {
          response.writeHead(302, { location });
          response.end();
          return;
        }
        response.writeHead(204);
        response.end();
      },
      async (baseUrl) =>
        expect(checker.check(checkConfig(`${baseUrl}/one`, 'status'))).resolves.toBe('204')
    );
  });

  it('rejects a fourth redirect', async () => {
    const redirects = new Map([
      ['/one', '/two'],
      ['/two', '/three'],
      ['/three', '/four'],
      ['/four', '/five'],
    ]);
    await withServer(
      (request, response) => {
        response.writeHead(302, { location: redirects.get(request.url ?? '') });
        response.end();
      },
      async (baseUrl) =>
        expectCheckError(
          checker.check(checkConfig(`${baseUrl}/one`, 'status')),
          'redirect_limit_exceeded'
        )
    );
  });

  it('rejects a redirect to a non-HTTP protocol', async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(302, { location: 'file:///tmp/condition' });
        response.end();
      },
      async (baseUrl) =>
        expectCheckError(
          checker.check(checkConfig(baseUrl, 'status')),
          'redirect_protocol_unsupported'
        )
    );
  });

  it('rejects an invalid redirect location', async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(302, { location: 'http://[::1' });
        response.end();
      },
      async (baseUrl) =>
        expectCheckError(checker.check(checkConfig(baseUrl, 'status')), 'redirect_location_invalid')
    );
  });

  it('rejects a redirect with no Location header', async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(302);
        response.end();
      },
      async (baseUrl) =>
        expectCheckError(checker.check(checkConfig(baseUrl, 'status')), 'redirect_location_missing')
    );
  });

  it('uses one bounded timeout for the complete check', async () => {
    await withServer(
      (_request, response) => response.write('partial response body'),
      async (baseUrl) =>
        expectCheckError(checker.check(checkConfig(baseUrl, 'bodyHash')), 'timeout')
    );
  });

  it('accepts a response body of exactly one MiB', async () => {
    const body = Buffer.alloc(MAX_RESPONSE_BYTES, 0x61);
    const expectedHash = createHash('sha256').update(body).digest('hex');
    await withServer(
      (_request, response) => response.end(body),
      async (baseUrl) =>
        expect(checker.check(checkConfig(baseUrl, 'bodyHash'))).resolves.toBe(expectedHash)
    );
  });

  it('rejects a response body larger than one MiB', async () => {
    await withServer(
      (_request, response) => response.end(Buffer.alloc(MAX_RESPONSE_BYTES + 1)),
      async (baseUrl) =>
        expectCheckError(checker.check(checkConfig(baseUrl, 'bodyHash')), 'response_body_too_large')
    );
  });

  it('allows private and localhost URLs across a redirect', async () => {
    let port = '';
    await withServer(
      (request, response) => {
        if (request.url === '/private') {
          response.writeHead(302, { location: `http://localhost:${port}/localhost` });
          response.end();
          return;
        }
        response.end('allowed');
      },
      async (baseUrl) => {
        port = new URL(baseUrl).port;
        await expect(checker.check(checkConfig(`${baseUrl}/private`, 'status'))).resolves.toBe(
          '200'
        );
      }
    );
  });
});
