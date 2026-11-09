import { describe, expect, it, vi } from 'vitest';

import type { AgentDesktopClient, AgentDesktopCallResult } from '../src/main/desktop/agent-desktop-client';
import { buildOperationCatalog } from '../src/main/desktop/agent-desktop-catalog';
import {
  buildAgentDesktopTools,
  formatAgentDesktopResult,
  resolveRequestedOperation,
} from '../src/main/desktop/agent-desktop-tools';

const UPSTREAM_TOOLS = [
  'desktop_snapshot',
  'desktop_find',
  'desktop_click',
  'desktop_type',
  'desktop_mouse_click',
  'desktop_wait',
  'desktop_list_apps',
  'desktop_list_windows',
  'desktop_clipboard_get',
  'desktop_list_notifications',
  'desktop_status',
];

function fakeClient(
  callImpl?: (operation: string, args: Record<string, unknown>) => Promise<AgentDesktopCallResult>
): AgentDesktopClient {
  const operations = buildOperationCatalog(UPSTREAM_TOOLS);
  return {
    getOperations: () => operations,
    isReady: () => true,
    call: vi.fn(
      callImpl ??
        (async (operation: string) => ({
          ok: true,
          delivery: 'delivered_verified' as const,
          data: { operation },
          retried: false,
        }))
    ),
  } as unknown as AgentDesktopClient;
}

function okResult(overrides: Partial<AgentDesktopCallResult> = {}): AgentDesktopCallResult {
  return {
    ok: true,
    delivery: 'delivered_verified',
    data: { ok: true },
    retried: false,
    ...overrides,
  };
}

describe('agent-desktop tools agregadas', () => {
  describe('buildAgentDesktopTools', () => {
    it('expõe uma tool por agregado disponível', () => {
      const tools = buildAgentDesktopTools({ client: fakeClient() });
      const names = tools.map((tool) => tool.name).sort();

      expect(names).toEqual([
        'desktop_act',
        'desktop_app',
        'desktop_clipboard',
        'desktop_notifications',
        'desktop_observe',
        'desktop_status',
        'desktop_wait',
        'desktop_window',
      ]);
    });

    it('omite agregados sem operação disponível', () => {
      const client = fakeClient();
      (client.getOperations as () => unknown) = () => buildOperationCatalog(['desktop_snapshot']);
      const tools = buildAgentDesktopTools({ client });
      expect(tools.map((tool) => tool.name)).toEqual(['desktop_observe']);
    });

    it('enumera as operações reais do upstream no schema', () => {
      const tools = buildAgentDesktopTools({ client: fakeClient() });
      const observe = tools.find((tool) => tool.name === 'desktop_observe');

      const schema = observe?.parameters as {
        properties: { operation: { enum: string[] } };
      };
      expect(schema.properties.operation.enum).toEqual(['find', 'snapshot']);
    });

    it('aciona a operação correta no cliente', async () => {
      const client = fakeClient();
      const tools = buildAgentDesktopTools({ client });
      const observe = tools.find((tool) => tool.name === 'desktop_observe');

      await observe?.execute('call-1', { operation: 'snapshot', args: { depth: 2 } } as never, undefined, undefined, undefined as never);

      expect(client.call).toHaveBeenCalledWith('snapshot', { depth: 2 }, undefined);
    });

    it('recusa operação desconhecida sem chamar o upstream', async () => {
      const client = fakeClient();
      const tools = buildAgentDesktopTools({ client });
      const observe = tools.find((tool) => tool.name === 'desktop_observe');

      await expect(
        observe?.execute('call-1', { operation: 'drop_database' } as never, undefined, undefined, undefined as never)
      ).rejects.toThrow(/Unknown operation/);

      expect(client.call).not.toHaveBeenCalled();
    });

    it('informa o risco no details da execução', async () => {
      const client = fakeClient();
      const tools = buildAgentDesktopTools({ client });
      const act = tools.find((tool) => tool.name === 'desktop_act');

      const result = await act?.execute(
        'call-1',
        { operation: 'mouse_click', args: { x: 10, y: 20 } } as never,
        undefined,
        undefined,
        undefined as never
      );

      const details = result?.details as { risk: string; operation: string };
      expect(details.risk).toBe('physical_input');
      expect(details.operation).toBe('mouse_click');
    });

    it('consulta onBeforeExecute antes de executar', async () => {
      const onBeforeExecute = vi.fn();
      const client = fakeClient();
      const tools = buildAgentDesktopTools({ client, onBeforeExecute });
      const observe = tools.find((tool) => tool.name === 'desktop_observe');

      await observe?.execute('call-1', { operation: 'snapshot' } as never, undefined, undefined, undefined as never);

      expect(onBeforeExecute).toHaveBeenCalledTimes(1);
      expect(onBeforeExecute.mock.calls[0][0]).toMatchObject({
        aggregate: 'observe',
        risk: 'observation',
      });
    });
  });

  describe('resolveRequestedOperation', () => {
    it('aceita o nome com ou sem o prefixo desktop_', () => {
      const operations = buildOperationCatalog(UPSTREAM_TOOLS);
      expect(resolveRequestedOperation(operations, 'snapshot')?.upstreamTool).toBe('desktop_snapshot');
      expect(resolveRequestedOperation(operations, 'desktop_snapshot')?.upstreamTool).toBe(
        'desktop_snapshot'
      );
      expect(resolveRequestedOperation(operations, 'nope')).toBeUndefined();
    });
  });

  describe('formatAgentDesktopResult', () => {
    it('formata sucesso com o payload', () => {
      const text = formatAgentDesktopResult('observe', 'snapshot', okResult({ data: { a: 1 } }));
      expect(text).toContain('OK — observe/snapshot');
      expect(text).toContain('"a": 1');
    });

    it('instrui o modelo a NÃO repetir quando a entrega é incerta', () => {
      const text = formatAgentDesktopResult(
        'act',
        'click',
        okResult({
          ok: false,
          delivery: 'delivery_uncertain',
          code: 'TIMEOUT',
          message: 'timed out',
        })
      );

      expect(text).toContain('delivery: delivery_uncertain');
      expect(text).toContain('Do NOT call it again automatically');
    });

    it('orienta observar quando a entrega não pôde ser verificada', () => {
      const text = formatAgentDesktopResult(
        'act',
        'click',
        okResult({ ok: false, delivery: 'delivered_unverified' })
      );
      expect(text).toContain('Observe to confirm the effect');
    });

    it('autoriza retry quando não houve entrega', () => {
      const text = formatAgentDesktopResult(
        'act',
        'click',
        okResult({ ok: false, delivery: 'not_delivered' })
      );
      expect(text).toContain('It is safe to retry once');
    });

    it('inclui recovery e details do upstream', () => {
      const text = formatAgentDesktopResult(
        'act',
        'click',
        okResult({
          ok: false,
          delivery: 'delivery_uncertain',
          recovery: 'take a new snapshot',
          details: { kind: 'identity_not_unique' },
        })
      );

      expect(text).toContain('recovery: take a new snapshot');
      expect(text).toContain('identity_not_unique');
    });
  });
});
