import { describe, expect, it } from 'vitest';

import {
  DESKTOP_ACCESS_MODES,
  DESKTOP_ACCESS_MODE_NATIVE_RESERVED,
  getSelectableDesktopAccessModes,
  isDesktopAccessModeNativeImplemented,
  isDesktopAccessModeNativeSelectable,
} from '../src/main/desktop/desktop-access-modes';

/**
 * M5 — o modo `native` continua **reservado** à camada FFI (Fase 5).
 *
 * Este teste trava o contrato da reserva. Sem ele, a regra viveria só em
 * comentários — e alguém pode "implementar" o modo `native` achando que ele
 * funciona, ou aceitar que a UI "oferece" um modo sem implementação.
 */
describe('M5 — modo `native` reservado à FFI (Fase 5)', () => {
  describe('registro canônico', () => {
    it('`native` faz parte do contrato de modos', () => {
      expect(DESKTOP_ACCESS_MODES).toContain('native');
      expect(DESKTOP_ACCESS_MODES).toEqual(['off', 'mcp', 'mcp+skill', 'native']);
    });

    it('declara a reserva: Fase 5, alvo FFI, não implementado', () => {
      expect(DESKTOP_ACCESS_MODE_NATIVE_RESERVED.mode).toBe('native');
      expect(DESKTOP_ACCESS_MODE_NATIVE_RESERVED.phase).toBe(5);
      expect(DESKTOP_ACCESS_MODE_NATIVE_RESERVED.target).toBe('FFI');
      expect(DESKTOP_ACCESS_MODE_NATIVE_RESERVED.implemented).toBe(false);
    });

    it('registra o motivo do adiamento da FFI (não se perde a decisão)', () => {
      expect(DESKTOP_ACCESS_MODE_NATIVE_RESERVED.deferralReason).toMatch(/45 ms/);
      expect(DESKTOP_ACCESS_MODE_NATIVE_RESERVED.deferralReason).toMatch(/400 ms/);
    });

    it('registra os pré-requisitos técnicos quando a FFI entrar', () => {
      const prereqs = DESKTOP_ACCESS_MODE_NATIVE_RESERVED.prerequisites.join('\n');

      // O profile `release` usa panic=abort e quebra os traps catch_unwind —
      // sem `--profile release-ffi` a lib nativa não pode ser usada.
      expect(prereqs).toMatch(/release-ffi/);
      expect(prereqs).toMatch(/panic=abort/);
      expect(prereqs).toMatch(/stub-adapter/);
      expect(prereqs).toMatch(/ad_abi_version/);
    });

    it('registra o gate de reavaliação da Fase 5', () => {
      expect(DESKTOP_ACCESS_MODE_NATIVE_RESERVED.reevaluationGate).toMatch(/400 ms/);
      expect(DESKTOP_ACCESS_MODE_NATIVE_RESERVED.reevaluationGate).toMatch(/100 ms/);
    });
  });

  describe('fail-closed enquanto a FFI não existe', () => {
    it('`native` não está implementado', () => {
      expect(isDesktopAccessModeNativeImplemented()).toBe(false);
      expect(isDesktopAccessModeNativeSelectable()).toBe(false);
    });

    it('`native` não está entre os modos selecionáveis pela UI', () => {
      const selectable = getSelectableDesktopAccessModes();

      expect(selectable).not.toContain('native');
      expect(selectable).toEqual(['off', 'mcp', 'mcp+skill']);
    });

    it('a UI oferece exatamente os modos implementados', () => {
      // O mesmo conjunto que o registro declara implementáveis.
      const implemented = DESKTOP_ACCESS_MODES.filter(
        (mode) => mode !== DESKTOP_ACCESS_MODE_NATIVE_RESERVED.mode
      );

      expect(getSelectableDesktopAccessModes()).toEqual(implemented);
    });
  });

  describe('consistência com o config-store', () => {
    it('o validador do config-store aceita `native` (valor gravado não quebra)', async () => {
      const { isDesktopAccessModeValue } = await import(
        '../src/main/desktop/desktop-access-modes'
      );

      expect(isDesktopAccessModeValue('native')).toBe(true);
      expect(isDesktopAccessModeValue('off')).toBe(true);
      expect(isDesktopAccessModeValue('mcp')).toBe(true);
      expect(isDesktopAccessModeValue('mcp+skill')).toBe(true);
      expect(isDesktopAccessModeValue('ffi')).toBe(false);
      expect(isDesktopAccessModeValue(undefined)).toBe(false);
    });
  });
});
