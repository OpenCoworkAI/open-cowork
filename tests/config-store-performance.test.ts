import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  seed: {} as Record<string, unknown>,
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-config-store-performance.json';

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

describe('ConfigStore lightweight reads', () => {
  beforeEach(() => {
    mocks.seed = {};
  });

  it('reads direct scalar keys without invoking full normalization pipeline', () => {
    const store = new ConfigStore();
    const normalizeSpy = vi.spyOn(store as unknown as { normalizeConfig: () => unknown }, 'normalizeConfig');

    const provider = store.get('provider');
    const model = store.get('model');

    expect(provider).toBe('openrouter');
    expect(typeof model).toBe('string');
    expect(normalizeSpy).not.toHaveBeenCalled();
  });

  it('preserves behavior for profile reads through getAll()', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: 'sk-openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
    });

    const config = store.getAll();
    expect(config.provider).toBe('openai');
    expect(config.apiKey).toBe('sk-openai');
    expect(config.profiles.openai?.model).toBe('gpt-5.4');
  });
});
