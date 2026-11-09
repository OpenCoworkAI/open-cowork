import { describe, expect, it } from 'vitest';

import {
  collectRequestedPhysicalOperations,
  isObservationOperation,
  isPhysicalInputOperation,
} from '../src/main/desktop/agent-desktop-catalog';

describe('gate de input físico (autorização explícita)', () => {
  describe('isPhysicalInputOperation', () => {
    it('marca as operações que movem o cursor', () => {
      expect(isPhysicalInputOperation('mouse_click')).toBe(true);
      expect(isPhysicalInputOperation('mouse_move')).toBe(true);
      expect(isPhysicalInputOperation('mouse_wheel')).toBe(true);
      expect(isPhysicalInputOperation('hover')).toBe(true);
      expect(isPhysicalInputOperation('drag')).toBe(true);
      expect(isPhysicalInputOperation('cursor_overlay')).toBe(true);
    });

    it('não marca operações semânticas nem de leitura', () => {
      expect(isPhysicalInputOperation('click')).toBe(false);
      expect(isPhysicalInputOperation('type')).toBe(false);
      expect(isPhysicalInputOperation('snapshot')).toBe(false);
    });
  });

  describe('isObservationOperation', () => {
    it('reconhece as operações de leitura', () => {
      expect(isObservationOperation('snapshot')).toBe(true);
      expect(isObservationOperation('list_windows')).toBe(true);
      expect(isObservationOperation('click')).toBe(false);
    });
  });

  describe('collectRequestedPhysicalOperations', () => {
    it('não devolve nada para operações semânticas', () => {
      expect(collectRequestedPhysicalOperations({ operation: 'click' })).toEqual([]);
      expect(collectRequestedPhysicalOperations({ operation: 'snapshot' })).toEqual([]);
    });

    it('devolve a operação física pedida', () => {
      expect(collectRequestedPhysicalOperations({ operation: 'mouse_click' })).toEqual([
        'mouse_click',
      ]);
    });

    it('inspeciona as operações aninhadas de um batch', () => {
      expect(
        collectRequestedPhysicalOperations({
          operation: 'batch',
          args: {
            operations: [{ operation: 'click' }, { operation: 'mouse_move' }],
          },
        })
      ).toEqual(['mouse_move']);
    });

    it('ignora batch sem operação física', () => {
      expect(
        collectRequestedPhysicalOperations({
          operation: 'batch',
          args: { operations: [{ operation: 'click' }, { operation: 'type' }] },
        })
      ).toEqual([]);
    });

    it('devolve lista vazia para input inválido', () => {
      expect(collectRequestedPhysicalOperations({})).toEqual([]);
      expect(collectRequestedPhysicalOperations({ operation: 42 })).toEqual([]);
    });
  });
});
