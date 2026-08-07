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

describe('ConfigStore contextWindow/maxTokens projection', () => {
  beforeEach(() => {
    mocks.seed = {};
  });

  it('projects a custom/Ollama profile contextWindow and maxTokens onto the flat config getAll() returns', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.3',
      profiles: {
        ollama: {
          apiKey: '',
          baseUrl: 'http://localhost:11434/v1',
          model: 'llama3.3',
          contextWindow: 32000,
          maxTokens: 8000,
        },
      },
    });

    const config = store.getAll();
    expect(config.contextWindow).toBe(32000);
    expect(config.maxTokens).toBe(8000);
  });

  it('keeps contextWindow/maxTokens projected after switching config sets', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.3',
      profiles: {
        ollama: {
          apiKey: '',
          baseUrl: 'http://localhost:11434/v1',
          model: 'llama3.3',
          contextWindow: 32000,
          maxTokens: 8000,
        },
      },
    });
    expect(store.getAll().contextWindow).toBe(32000);
    expect(store.getAll().maxTokens).toBe(8000);

    const created = store.createSet({ name: 'Second set', mode: 'blank' });
    const secondSetId = created.configSets.find((set) => set.id !== 'default')!.id;

    store.update({
      provider: 'custom',
      customProtocol: 'openai',
      apiKey: 'sk-custom',
      baseUrl: 'https://relay.example.com/v1',
      model: 'my-model',
      profiles: {
        'custom:openai': {
          apiKey: 'sk-custom',
          baseUrl: 'https://relay.example.com/v1',
          model: 'my-model',
          contextWindow: 64000,
          maxTokens: 16000,
        },
      },
    });
    expect(store.getAll().contextWindow).toBe(64000);
    expect(store.getAll().maxTokens).toBe(16000);

    store.switchSet({ id: 'default' });
    const defaultSetView = store.getAll();
    expect(defaultSetView.contextWindow).toBe(32000);
    expect(defaultSetView.maxTokens).toBe(8000);

    store.switchSet({ id: secondSetId });
    const secondSetView = store.getAll();
    expect(secondSetView.contextWindow).toBe(64000);
    expect(secondSetView.maxTokens).toBe(16000);
  });

  it('does not crash on construction when the active profile has no contextWindow/maxTokens override', () => {
    expect(() => new ConfigStore()).not.toThrow();
    const config = new ConfigStore().getAll();
    expect(config.contextWindow).toBeUndefined();
    expect(config.maxTokens).toBeUndefined();
  });

  it('clears contextWindow/maxTokens when switching to a set whose active profile has no override', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.3',
      profiles: {
        ollama: {
          apiKey: '',
          baseUrl: 'http://localhost:11434/v1',
          model: 'llama3.3',
          contextWindow: 32000,
          maxTokens: 8000,
        },
      },
    });
    expect(store.getAll().contextWindow).toBe(32000);

    const created = store.createSet({ name: 'No override set', mode: 'blank' });
    const secondSetId = created.configSets.find((set) => set.id !== 'default')!.id;

    expect(() =>
      store.update({
        provider: 'openrouter',
        apiKey: 'sk-or',
        model: 'anthropic/claude',
      })
    ).not.toThrow();
    const secondSetView = store.getAll();
    expect(secondSetView.contextWindow).toBeUndefined();
    expect(secondSetView.maxTokens).toBeUndefined();

    store.switchSet({ id: 'default' });
    expect(store.getAll().contextWindow).toBe(32000);

    store.switchSet({ id: secondSetId });
    expect(store.getAll().contextWindow).toBeUndefined();
    expect(store.getAll().maxTokens).toBeUndefined();
  });
});
