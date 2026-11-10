import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentDesktopClient } from '../src/main/desktop/agent-desktop-client';
import {
  collectRequestedPhysicalOperations,
  extractBatchedOperations,
  resolveEffectiveRisk,
  type AgentDesktopOperation,
} from '../src/main/desktop/agent-desktop-catalog';

const STUB_PATH = path.resolve(__dirname, 'fixtures/agent-desktop-stub.mjs');

const BATCH_OPERATION: AgentDesktopOperation = {
  operation: 'batch',
  upstreamTool: 'desktop_batch',
  aggregate: 'act',
  risk: 'semantic_action',
};

describe('comportamento conforme o upstream real v1.2.0', () => {
  describe('batch com `commands_json`', () => {
    it('extrai as operações do JSON serializado', () => {
      const commandsJson = JSON.stringify([
        { command: 'desktop_click', args: { ref_id: '@s1:e1' } },
        { command: 'desktop_mouse_click', args: { x: 1, y: 2 } },
      ]);
      expect(extractBatchedOperations({ commands_json: commandsJson })).toEqual([
        'click',
        'mouse_click',
      ]);
    });

    it('escala o risco do lote quando há input físico', () => {
      const commandsJson = JSON.stringify([{ command: 'desktop_mouse_move' }]);
      expect(resolveEffectiveRisk(BATCH_OPERATION, { commands_json: commandsJson })).toBe(
        'physical_input'
      );
    });

    it('não escala quando o lote é só semântico', () => {
      const commandsJson = JSON.stringify([{ command: 'desktop_click' }, { command: 'desktop_type' }]);
      expect(resolveEffectiveRisk(BATCH_OPERATION, { commands_json: commandsJson })).toBe(
        'semantic_action'
      );
    });

    it('coleta as operações físicas pedidas pelo lote (gate de permissão)', () => {
      const commandsJson = JSON.stringify([
        { command: 'desktop_click' },
        { command: 'desktop_drag' },
      ]);
      expect(
        collectRequestedPhysicalOperations({ operation: 'batch', args: { commands_json: commandsJson } })
      ).toEqual(['drag']);
    });

    it('JSON inválido não produz operações (fail-safe)', () => {
      expect(extractBatchedOperations({ commands_json: '{not json' })).toEqual([]);
    });
  });

  describe('envelope real do upstream', () => {
    let workDir: string;

    beforeEach(() => {
      workDir = mkdtempSync(path.join(tmpdir(), 'agent-desktop-envelope-'));
    });

    afterEach(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    function createClient(env: Record<string, string> = {}): AgentDesktopClient {
      return new AgentDesktopClient({
        command: process.execPath,
        args: [STUB_PATH],
        env: { PATH: process.env.PATH ?? '', ...env },
        callTimeoutMs: 10_000,
        connectTimeoutMs: 15_000,
        sessionId: 'session-test',
        agentId: 'agent-test',
      });
    }

    it('recusa em texto simples NÃO é reportado como sucesso', async () => {
      const client = createClient({ STUB_REJECT_TOOL: 'desktop_click' });
      try {
        await client.start();
        const result = await client.call('click', { ref_id: '@s1:e1' });

        expect(result.ok).toBe(false);
        expect(result.delivery).toBe('delivery_uncertain');
        expect(result.code).toBe('UNPARSEABLE_ENVELOPE');
        expect(result.retried).toBe(false);
      } finally {
        await client.close();
      }
    });

    it('sucesso com data.disposition incerta é reportado como incerto', async () => {
      const client = createClient({
        STUB_SUCCESS_DELIVERY: 'delivery_uncertain',
        STUB_SUCCESS_RETRY: 'unsafe',
      });
      try {
        await client.start();
        const result = await client.call('click', { ref_id: '@s1:e1' });

        // O upstream carrega a disposition do sucesso em `data.disposition`.
        // Reportar 'delivered_verified' seria mentir para o modelo.
        expect(result.ok).toBe(true);
        expect(result.delivery).toBe('delivery_uncertain');
      } finally {
        await client.close();
      }
    });

    it('sucesso sem disposition (observação) é reportado como verificado', async () => {
      const client = createClient();
      try {
        await client.start();
        const result = await client.call('snapshot', {});

        expect(result.ok).toBe(true);
        expect(result.delivery).toBe('delivered_verified');
      } finally {
        await client.close();
      }
    });

    it('erro sem disposition não é reportado como verificado', async () => {
      const client = createClient({
        STUB_FAIL_TOOL: 'desktop_click',
        STUB_DELIVERY: 'delivery_uncertain',
        STUB_RETRY: 'safe',
      });
      try {
        await client.start();
        const result = await client.call('click', { ref_id: '@s1:e1' });

        expect(result.ok).toBe(false);
        expect(result.delivery).toBe('delivery_uncertain');
      } finally {
        await client.close();
      }
    });
  });
});
