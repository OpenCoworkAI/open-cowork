/**
 * Ponte config → decisão de env do GUI Operate (M6).
 *
 * O teste `gui-operate-image-output-env.test.ts` cobre apenas a função pura
 * `buildGuiOperateRuntimeEnv`. Este fecha a cadeia real que estava quebrada:
 * a preferência precisa ser **persistida** no ConfigStore e **lida de volta**
 * para que o servidor filho do GUI Operate receba
 * `OPEN_COWORK_DISABLE_IMAGE_TOOL_OUTPUT=1`.
 *
 * Sem este teste, a suíte fica verde mesmo com o knob inerte — exatamente o
 * falso sinal relatado na auditoria de runtime (achado S2).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  seed: {} as Record<string, unknown>,
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

import { ConfigStore } from '../src/main/config/config-store';
import {
  buildGuiOperateRuntimeEnv,
  GUI_OPERATE_DISABLE_IMAGE_OUTPUT_ENV,
} from '../src/main/mcp/gui-operate-runtime-env';

describe('ponte config → env do GUI Operate', () => {
  beforeEach(() => {
    mocks.seed = {};
  });

  it('preferência false persistida injeta o flag no env do servidor filho', () => {
    const store = new ConfigStore();
    store.update({ guiOperateImageOutputEnabled: false });

    const preference = store.get('guiOperateImageOutputEnabled');
    const env = buildGuiOperateRuntimeEnv({
      serverName: 'GUI_Operate',
      imageOutputEnabled: preference,
    });

    expect(preference).toBe(false);
    expect(env).toEqual({ [GUI_OPERATE_DISABLE_IMAGE_OUTPUT_ENV]: '1' });
  });

  it('preferência true (padrão) não injeta nada e preserva env manual', () => {
    const store = new ConfigStore();
    const preference = store.get('guiOperateImageOutputEnabled');

    expect(preference).toBe(true);
    expect(
      buildGuiOperateRuntimeEnv({ serverName: 'GUI_Operate', imageOutputEnabled: preference })
    ).toBeNull();
  });

  it('servidores que não são o GUI Operate nunca são tocados', () => {
    const store = new ConfigStore();
    store.update({ guiOperateImageOutputEnabled: false });
    const preference = store.get('guiOperateImageOutputEnabled');

    expect(
      buildGuiOperateRuntimeEnv({ serverName: 'Filesystem', imageOutputEnabled: preference })
    ).toBeNull();
  });

  it('a preferência sobrevive a uma reconfiguração não relacionada', () => {
    const store = new ConfigStore();
    store.update({ guiOperateImageOutputEnabled: false });

    store.update({ enableThinking: true });

    const preference = store.get('guiOperateImageOutputEnabled');
    expect(preference).toBe(false);
    expect(
      buildGuiOperateRuntimeEnv({ serverName: 'GUI_Operate', imageOutputEnabled: preference })
    ).toEqual({ [GUI_OPERATE_DISABLE_IMAGE_OUTPUT_ENV]: '1' });
  });
});
