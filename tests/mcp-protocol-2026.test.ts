import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const modernMeta = {
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': {
    name: 'open-cowork-protocol-test',
    version: '1.0.0',
  },
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
};

let bundlePath: string;
let tempRoot: string;

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-mcp-protocol-'));
  bundlePath = path.join(tempRoot, 'software-dev-server.js');

  await build({
    bundle: true,
    entryPoints: [path.resolve(process.cwd(), 'src/main/mcp/software-dev-server-example.ts')],
    format: 'cjs',
    outfile: bundlePath,
    platform: 'node',
    target: 'node20',
  });
});

afterAll(() => {
  fs.rmSync(tempRoot, { force: true, recursive: true });
});

async function connectAndReadProtocolVersion(
  mode: 'auto' | 'legacy'
): Promise<{ protocolVersion: string | undefined; toolCount: number }> {
  const client = new Client(
    {
      name: `open-cowork-${mode}-test`,
      version: '1.0.0',
    },
    {
      versionNegotiation: { mode },
    }
  );
  const transport = new StdioClientTransport({
    args: [bundlePath],
    command: process.execPath,
    stderr: 'pipe',
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    return {
      protocolVersion: client.getNegotiatedProtocolVersion(),
      toolCount: tools.tools.length,
    };
  } finally {
    await client.close();
  }
}

describe('MCP 2026-07-28 stdio protocol', () => {
  it('negotiates the modern protocol and preserves legacy compatibility', async () => {
    await expect(connectAndReadProtocolVersion('auto')).resolves.toMatchObject({
      protocolVersion: '2026-07-28',
      toolCount: 12,
    });
    await expect(connectAndReadProtocolVersion('legacy')).resolves.toMatchObject({
      protocolVersion: '2025-11-25',
      toolCount: 12,
    });
  });

  it('returns modern discovery and list result envelopes on the wire', async () => {
    const child = spawn(process.execPath, [bundlePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = readline.createInterface({ input: child.stdout });
    const responses: Array<Record<string, unknown>> = [];

    const responsePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('MCP wire probe timed out')), 10_000);

      child.once('error', reject);
      lines.on('line', (line) => {
        const message = JSON.parse(line) as Record<string, unknown>;
        responses.push(message);

        if (message.id === 1) {
          child.stdin.write(
            `${JSON.stringify({
              id: 2,
              jsonrpc: '2.0',
              method: 'tools/list',
              params: { _meta: modernMeta },
            })}\n`
          );
        }

        if (message.id === 2) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    child.stdin.write(
      `${JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'server/discover',
        params: { _meta: modernMeta },
      })}\n`
    );

    try {
      await responsePromise;
    } finally {
      child.kill();
    }

    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({
      id: 1,
      result: {
        cacheScope: 'private',
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
        ttlMs: 0,
      },
    });
    expect(responses[1]).toMatchObject({
      id: 2,
      result: {
        resultType: 'complete',
        tools: expect.any(Array),
      },
    });
  });
});
