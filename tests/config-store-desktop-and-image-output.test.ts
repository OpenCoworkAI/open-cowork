/**
 * Persistência das preferências de desktop e de entrega de imagem do GUI
 * Operate (achado S1 da auditoria de runtime).
 *
 * O defeito coberto aqui: `normalizeConfig()` montava o `AppConfig` com uma
 * whitelist explícita que **não** incluía `desktopAccessMode`,
 * `desktopPhysicalInputEnabled` nem `guiOperateImageOutputEnabled`. Como
 * `update()` grava o payload via `saveConfig()` → `normalizeConfig()` →
 * `store.set(...)`, essas chaves nunca chegavam a ser persistidas; e
 * `getAll()` (usado pelo IPC `config.get` e pelos consumidores) nunca as
 * devolvia. Resultado: o toggle da UI não fazia nada e o modo desktop caía
 * para `off` — suíte verde com a feature morta.
 *
 * Contrato fixado aqui:
 * 1. round-trip `update()` → `get()` → `getAll()`;
 * 2. salvar outra chave **não** apaga as preferências;
 * 3. valor corrompido no store cai no default (fail-closed);
 * 4. o campo novo tem validador no import da config pública.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  seed: {} as Record<string, unknown>,
  instances: [] as Array<{ store: Record<string, unknown> }>,
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-config-store.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = {
        ...(options?.defaults || {}),
        ...mocks.seed,
      };
      mocks.instances.push(this);
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = {
        ...this.store,
        ...key,
      };
    }

    clear(): void {
      this.store = {};
    }
  }

  return {
    default: MockStore,
  };
});

import { ConfigStore, FIELD_VALIDATORS } from '../src/main/config/config-store';

describe('ConfigStore — preferências de desktop e imagem do GUI Operate', () => {
  beforeEach(() => {
    mocks.seed = {};
    mocks.instances = [];
  });

  it('persiste guiOperateImageOutputEnabled=false no round-trip update → get → getAll', () => {
    const store = new ConfigStore();
    store.update({ guiOperateImageOutputEnabled: false });

    expect(store.get('guiOperateImageOutputEnabled')).toBe(false);
    expect(store.getAll().guiOperateImageOutputEnabled).toBe(false);
  });

  it('persiste desktopAccessMode e desktopPhysicalInputEnabled', () => {
    const store = new ConfigStore();
    store.update({ desktopAccessMode: 'mcp', desktopPhysicalInputEnabled: true });

    expect(store.get('desktopAccessMode')).toBe('mcp');
    expect(store.getAll().desktopAccessMode).toBe('mcp');
    expect(store.get('desktopPhysicalInputEnabled')).toBe(true);
    expect(store.getAll().desktopPhysicalInputEnabled).toBe(true);
  });

  it('não perde as preferências quando outra chave é salva', () => {
    const store = new ConfigStore();
    store.update({ desktopAccessMode: 'mcp+skill', guiOperateImageOutputEnabled: false });

    store.update({ theme: 'dark' });

    expect(store.get('desktopAccessMode')).toBe('mcp+skill');
    expect(store.get('guiOperateImageOutputEnabled')).toBe(false);
    expect(store.getAll().desktopAccessMode).toBe('mcp+skill');
    expect(store.getAll().guiOperateImageOutputEnabled).toBe(false);
  });

  it('rejeita modo de desktop inválido e mantém o default (fail-closed)', () => {
    mocks.seed = { desktopAccessMode: 'modo-invalido' };
    const store = new ConfigStore();

    expect(store.get('desktopAccessMode')).toBe('off');
    expect(store.getAll().desktopAccessMode).toBe('off');
  });

  it('rejeita booleanos corrompidos e mantém o default (fail-closed)', () => {
    mocks.seed = {
      guiOperateImageOutputEnabled: 'false',
      desktopPhysicalInputEnabled: 1,
    };
    const store = new ConfigStore();

    expect(store.get('guiOperateImageOutputEnabled')).toBe(true);
    expect(store.getAll().guiOperateImageOutputEnabled).toBe(true);
    expect(store.get('desktopPhysicalInputEnabled')).toBe(false);
    expect(store.getAll().desktopPhysicalInputEnabled).toBe(false);
  });

  it('rejeita valor corrompido gravado por fora do app (guard de get)', () => {
    const store = new ConfigStore();
    const raw = mocks.instances[mocks.instances.length - 1];
    raw.store.desktopAccessMode = 'modo-invalido';
    raw.store.guiOperateImageOutputEnabled = 'false';
    raw.store.desktopPhysicalInputEnabled = 'sim';

    expect(store.get('desktopAccessMode')).toBe('off');
    expect(store.get('guiOperateImageOutputEnabled')).toBe(true);
    expect(store.get('desktopPhysicalInputEnabled')).toBe(false);
  });

  it('expose o validador do campo no import da config pública', () => {
    expect(FIELD_VALIDATORS.guiOperateImageOutputEnabled).toBeTypeOf('function');
    expect(FIELD_VALIDATORS.guiOperateImageOutputEnabled?.(true)).toBe(true);
    expect(FIELD_VALIDATORS.guiOperateImageOutputEnabled?.(false)).toBe(true);
    expect(FIELD_VALIDATORS.guiOperateImageOutputEnabled?.('false')).toBe(false);
  });
});
