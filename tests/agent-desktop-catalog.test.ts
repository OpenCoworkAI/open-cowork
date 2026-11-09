import { describe, expect, it } from 'vitest';

import {
  buildOperationCatalog,
  classifyAggregate,
  classifyRisk,
  extractBatchedOperations,
  groupOperationsByAggregate,
  operationFromUpstreamTool,
  parseDelivery,
  parseDisposition,
  parseEnvelope,
  resolveEffectiveRisk,
} from '../src/main/desktop/agent-desktop-catalog';

describe('agent-desktop catalog', () => {
  describe('operationFromUpstreamTool', () => {
    it('extrai a operação removendo o prefixo desktop_', () => {
      expect(operationFromUpstreamTool('desktop_snapshot')).toBe('snapshot');
      expect(operationFromUpstreamTool('desktop_clipboard_get')).toBe('clipboard_get');
    });

    it('ignora tools que não são do upstream', () => {
      expect(operationFromUpstreamTool('click')).toBeNull();
      expect(operationFromUpstreamTool('desktop_')).toBeNull();
    });
  });

  describe('classifyAggregate', () => {
    it('classifica as operações conhecidas', () => {
      expect(classifyAggregate('snapshot')).toBe('observe');
      expect(classifyAggregate('find')).toBe('observe');
      expect(classifyAggregate('click')).toBe('act');
      expect(classifyAggregate('wait')).toBe('wait');
      expect(classifyAggregate('launch')).toBe('app');
      expect(classifyAggregate('list_windows')).toBe('window');
      expect(classifyAggregate('clipboard_set')).toBe('clipboard');
      expect(classifyAggregate('list_notifications')).toBe('notifications');
      expect(classifyAggregate('status')).toBe('status');
    });

    it('operação desconhecida cai em act (fail-safe: nunca em observação)', () => {
      expect(classifyAggregate('brand_new_command')).toBe('act');
    });
  });

  describe('classifyRisk', () => {
    it('operações de leitura são observation', () => {
      expect(classifyRisk('snapshot')).toBe('observation');
      expect(classifyRisk('list_apps')).toBe('observation');
      expect(classifyRisk('status')).toBe('observation');
    });

    it('operações semânticas são semantic_action', () => {
      expect(classifyRisk('click')).toBe('semantic_action');
      expect(classifyRisk('type')).toBe('semantic_action');
      expect(classifyRisk('set_value')).toBe('semantic_action');
    });

    it('operações de input físico são physical_input', () => {
      expect(classifyRisk('mouse_click')).toBe('physical_input');
      expect(classifyRisk('mouse_move')).toBe('physical_input');
      expect(classifyRisk('hover')).toBe('physical_input');
      expect(classifyRisk('drag')).toBe('physical_input');
      expect(classifyRisk('cursor_overlay')).toBe('physical_input');
    });
  });

  describe('buildOperationCatalog', () => {
    it('deriva o catálogo de tools/list e ignora tools não upstream', () => {
      const catalog = buildOperationCatalog([
        'desktop_snapshot',
        'desktop_click',
        'some_other_tool',
        'desktop_snapshot',
      ]);

      expect(catalog).toHaveLength(2);
      expect(catalog.map((op) => op.operation)).toEqual(['snapshot', 'click']);
    });

    it('ordena por agregado canônico e depois por operação', () => {
      const catalog = buildOperationCatalog([
        'desktop_status',
        'desktop_click',
        'desktop_snapshot',
        'desktop_wait',
      ]);

      expect(catalog.map((op) => op.aggregate)).toEqual(['observe', 'act', 'wait', 'status']);
    });

    it('agrupa por agregado', () => {
      const grouped = groupOperationsByAggregate(
        buildOperationCatalog(['desktop_snapshot', 'desktop_click', 'desktop_wait'])
      );

      expect(grouped.observe.map((op) => op.operation)).toEqual(['snapshot']);
      expect(grouped.act.map((op) => op.operation)).toEqual(['click']);
      expect(grouped.wait.map((op) => op.operation)).toEqual(['wait']);
      expect(grouped.clipboard).toEqual([]);
    });
  });

  describe('resolveEffectiveRisk', () => {
    const batchOperation = {
      operation: 'batch',
      upstreamTool: 'desktop_batch',
      aggregate: 'act' as const,
      risk: 'semantic_action' as const,
    };

    it('batch só com operações semânticas mantém o risco estático', () => {
      const risk = resolveEffectiveRisk(batchOperation, {
        operations: [{ operation: 'click' }, { operation: 'type' }],
      });
      expect(risk).toBe('semantic_action');
    });

    it('batch com input físico é escalado para physical_input', () => {
      const risk = resolveEffectiveRisk(batchOperation, {
        operations: [{ operation: 'click' }, { operation: 'mouse_click' }],
      });
      expect(risk).toBe('physical_input');
    });

    it('operação não-batch mantém o risco estático', () => {
      const click = {
        operation: 'click',
        upstreamTool: 'desktop_click',
        aggregate: 'act' as const,
        risk: 'semantic_action' as const,
      };
      expect(resolveEffectiveRisk(click, { anything: true })).toBe('semantic_action');
    });
  });

  describe('extractBatchedOperations', () => {
    it('aceita strings, objetos e o prefixo desktop_', () => {
      const names = extractBatchedOperations({
        operations: ['click', { operation: 'type' }, { tool: 'desktop_mouse_click' }, { name: 'wait' }],
      });
      expect(names).toEqual(['click', 'type', 'mouse_click', 'wait']);
    });

    it('devolve lista vazia para entrada inválida', () => {
      expect(extractBatchedOperations({})).toEqual([]);
      expect(extractBatchedOperations({ operations: 'click' })).toEqual([]);
    });
  });

  describe('parseDelivery', () => {
    it('mapeia os quatro estados conhecidos', () => {
      expect(parseDelivery('not_delivered')).toBe('not_delivered');
      expect(parseDelivery('delivered_unverified')).toBe('delivered_unverified');
      expect(parseDelivery('delivered_verified')).toBe('delivered_verified');
      expect(parseDelivery('delivery_uncertain')).toBe('delivery_uncertain');
    });

    it('valores desconhecidos viram delivery_uncertain (fail-safe)', () => {
      expect(parseDelivery('unknown')).toBe('delivery_uncertain');
      expect(parseDelivery(undefined)).toBe('delivery_uncertain');
      expect(parseDelivery('brand_new')).toBe('delivery_uncertain');
    });
  });

  describe('parseDisposition', () => {
    it('retry só é permitido em not_delivered', () => {
      expect(parseDisposition({ delivery: 'not_delivered', retry: true })).toEqual({
        delivery: 'not_delivered',
        retry: true,
      });
      expect(parseDisposition({ delivery: 'delivery_uncertain', retry: true })).toEqual({
        delivery: 'delivery_uncertain',
        retry: false,
      });
      expect(parseDisposition({ delivery: 'delivered_verified', retry: true })).toEqual({
        delivery: 'delivered_verified',
        retry: false,
      });
    });

    it('not_delivered com retry=false não é repetível', () => {
      expect(parseDisposition({ delivery: 'not_delivered', retry: false }).retry).toBe(false);
    });

    it('ausência de disposition é fail-safe', () => {
      expect(parseDisposition(undefined)).toEqual({
        delivery: 'delivery_uncertain',
        retry: false,
      });
    });
  });

  describe('parseEnvelope', () => {
    it('lê o envelope de structuredContent', () => {
      const envelope = parseEnvelope({
        structuredContent: { version: '2.6', ok: true, data: { a: 1 } },
        content: [{ type: 'text', text: 'ignored' }],
      });
      expect(envelope?.ok).toBe(true);
      expect(envelope?.data).toEqual({ a: 1 });
    });

    it('lê o envelope do bloco de texto', () => {
      const envelope = parseEnvelope({
        content: [{ type: 'text', text: JSON.stringify({ version: '2.6', ok: false }) }],
      });
      expect(envelope?.ok).toBe(false);
    });

    it('devolve null para payload inválido', () => {
      expect(parseEnvelope({ content: [{ type: 'text', text: 'not json' }] })).toBeNull();
      expect(parseEnvelope(null)).toBeNull();
      expect(parseEnvelope({})).toBeNull();
    });
  });
});
