import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentDesktopClient } from '../src/main/desktop/agent-desktop-client';

const STUB_PATH = path.resolve(__dirname, 'fixtures/agent-desktop-stub.mjs');

interface CallRecord {
  tool: string;
  args: Record<string, unknown>;
}

describe('AgentDesktopClient (contrato com o servidor MCP do agent-desktop)', () => {
  let workDir: string;
  let callLogPath: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'agent-desktop-test-'));
    callLogPath = path.join(workDir, 'calls.jsonl');
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function readCalls(): CallRecord[] {
    try {
      return readFileSync(callLogPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CallRecord);
    } catch {
      return [];
    }
  }

  function createClient(env: Record<string, string> = {}): AgentDesktopClient {
    return new AgentDesktopClient({
      // O stub é executado pelo mesmo node que roda o vitest.
      command: process.execPath,
      args: [STUB_PATH],
      env: {
        PATH: process.env.PATH ?? '',
        STUB_CALL_LOG: callLogPath,
        ...env,
      },
      callTimeoutMs: 10_000,
      connectTimeoutMs: 15_000,
      sessionId: 'session-test',
      agentId: 'agent-test',
    });
  }

  it('conecta, lista as operações e deriva o catálogo do tools/list', async () => {
    const client = createClient();
    try {
      await client.start();

      const operations = client.getOperations();
      expect(operations.length).toBeGreaterThan(40);

      const snapshot = operations.find((op) => op.operation === 'snapshot');
      expect(snapshot?.upstreamTool).toBe('desktop_snapshot');
      expect(snapshot?.aggregate).toBe('observe');

      const mouseClick = operations.find((op) => op.operation === 'mouse_click');
      expect(mouseClick?.risk).toBe('physical_input');
    } finally {
      await client.close();
    }
  });

  it('propaga a identidade da sessão ao start do servidor filho', async () => {
    const client = createClient();
    try {
      await client.start();
      expect(client.isReady()).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('executa uma operação com sucesso e devolve os dados', async () => {
    const client = createClient();
    try {
      await client.start();
      const result = await client.call('snapshot', { depth: 2 });

      expect(result.ok).toBe(true);
      expect(result.delivery).toBe('delivered_verified');
      expect((result.data as { tool: string }).tool).toBe('desktop_snapshot');
      expect(readCalls()).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it('NÃO repete quando a entrega é incerta (achado C4)', async () => {
    const client = createClient({
      STUB_FAIL_TOOL: 'desktop_click',
      STUB_DELIVERY: 'delivery_uncertain',
      STUB_RETRY: 'safe',
    });
    try {
      await client.start();
      const result = await client.call('click', { ref: 'e1' });

      expect(result.ok).toBe(false);
      expect(result.delivery).toBe('delivery_uncertain');
      expect(result.retried).toBe(false);

      // O ponto central: exatamente 1 chamada — a ação pode ter sido executada.
      expect(readCalls()).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it('repete uma única vez quando o upstream garante not_delivered', async () => {
    const client = createClient({
      STUB_FAIL_TOOL: 'desktop_click',
      STUB_DELIVERY: 'not_delivered',
      STUB_RETRY: 'safe',
    });
    try {
      await client.start();
      const result = await client.call('click', { ref: 'e1' });

      expect(result.ok).toBe(false);
      expect(result.delivery).toBe('not_delivered');
      expect(result.retried).toBe(true);
      expect(readCalls()).toHaveLength(2);
    } finally {
      await client.close();
    }
  });

  it('NÃO repete quando o upstream diz not_delivered mas retry=false', async () => {
    const client = createClient({
      STUB_FAIL_TOOL: 'desktop_click',
      STUB_DELIVERY: 'not_delivered',
      STUB_RETRY: 'unsafe',
    });
    try {
      await client.start();
      const result = await client.call('click', { ref: 'e1' });

      expect(result.delivery).toBe('not_delivered');
      expect(result.retried).toBe(false);
      expect(readCalls()).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it('operação desconhecida é recusada antes de chamar o upstream', async () => {
    const client = createClient();
    try {
      await client.start();

      await expect(client.call('not_a_real_operation')).rejects.toThrow(
        /Unknown agent-desktop operation/
      );
      expect(readCalls()).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  it('timeout do transporte vira delivery_uncertain, sem retry e sem exceção', async () => {
    const client = new AgentDesktopClient({
      command: process.execPath,
      args: [STUB_PATH],
      env: {
        PATH: process.env.PATH ?? '',
        STUB_CALL_LOG: callLogPath,
        STUB_HANG_TOOL: 'desktop_snapshot',
      },
      callTimeoutMs: 1_000,
      connectTimeoutMs: 15_000,
      sessionId: 'session-test',
      agentId: 'agent-test',
    });

    try {
      await client.start();
      const result = await client.call('snapshot');

      expect(result.ok).toBe(false);
      expect(result.delivery).toBe('delivery_uncertain');
      expect(result.retried).toBe(false);
      // O timeout pode ter ocorrido DEPOIS da ação — nunca repetir.
      expect(readCalls()).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it('fecha o cliente e recusa chamadas posteriores', async () => {
    const client = createClient();
    await client.start();
    await client.close();

    expect(client.isReady()).toBe(false);
    await expect(client.call('snapshot')).rejects.toThrow(/not connected/i);
  });
});
