import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSyntheticPiModel,
  buildSyntheticPiModelFromRuntimeConfig,
  resolvePiRouteProtocol,
} from '../src/main/agent/pi-model-resolution';
import { buildAgentRuntimeSignature } from '../src/main/config/agent-runtime-signature';

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
      // Match electron-store/conf: a present key with an explicit undefined value throws.
      const assign = (entryKey: string, entryValue: unknown) => {
        if (entryValue === undefined) {
          throw new TypeError(`Use \`delete()\` to clear values: ${entryKey}`);
        }
        this.store[entryKey] = entryValue;
      };

      if (typeof key === 'string') {
        assign(key, value);
        return;
      }
      for (const [entryKey, entryValue] of Object.entries(key)) {
        assign(entryKey, entryValue);
      }
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

const ollamaProfile = {
  apiKey: '',
  baseUrl: 'http://localhost:11434/v1',
  model: 'llama3.3',
};

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
          ...ollamaProfile,
          contextWindow: 32000,
          maxTokens: 8000,
        },
      },
    });

    const config = store.getAll();
    expect(config.contextWindow).toBe(32000);
    expect(config.maxTokens).toBe(8000);
    expect(config.profiles.ollama?.contextWindow).toBe(32000);
    expect(config.profiles.ollama?.maxTokens).toBe(8000);
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
          ...ollamaProfile,
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
    expect('contextWindow' in config).toBe(false);
    expect('maxTokens' in config).toBe(false);
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
          ...ollamaProfile,
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
    expect('contextWindow' in secondSetView).toBe(false);
    expect('maxTokens' in secondSetView).toBe(false);

    store.switchSet({ id: 'default' });
    expect(store.getAll().contextWindow).toBe(32000);

    store.switchSet({ id: secondSetId });
    const clearedView = store.getAll();
    expect(clearedView.contextWindow).toBeUndefined();
    expect(clearedView.maxTokens).toBeUndefined();
    expect('contextWindow' in clearedView).toBe(false);
    expect('maxTokens' in clearedView).toBe(false);
  });

  it('rejects non-finite contextWindow/maxTokens instead of projecting Infinity', () => {
    expect(FIELD_VALIDATORS.contextWindow(Number.POSITIVE_INFINITY)).toBe(false);
    expect(FIELD_VALIDATORS.maxTokens(Number.NEGATIVE_INFINITY)).toBe(false);
    expect(FIELD_VALIDATORS.contextWindow(Number.NaN)).toBe(false);
    expect(FIELD_VALIDATORS.contextWindow(128000)).toBe(true);

    const store = new ConfigStore();
    store.update({
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.3',
      profiles: {
        ollama: {
          ...ollamaProfile,
          contextWindow: Number.POSITIVE_INFINITY,
          maxTokens: Number.NaN,
        },
      },
    });

    const config = store.getAll();
    expect(config.contextWindow).toBeUndefined();
    expect(config.maxTokens).toBeUndefined();
    expect(config.profiles.ollama?.contextWindow).toBeUndefined();
    expect(config.profiles.ollama?.maxTokens).toBeUndefined();
  });

  it('feeds projected overrides into the production synthetic-model path instead of known-spec defaults', () => {
    const store = new ConfigStore();
    store.update({
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.3',
      profiles: {
        ollama: {
          ...ollamaProfile,
          contextWindow: 32000,
          maxTokens: 8000,
        },
      },
    });

    const runtimeConfig = store.getAll();
    const defaultModel = buildSyntheticPiModel(
      'llama3.3',
      'ollama',
      'openai',
      runtimeConfig.baseUrl
    );
    // llama3.3 is in the known-spec table (131072 / 4096); overrides must win.
    expect(defaultModel.contextWindow).toBe(131072);
    expect(defaultModel.maxTokens).toBe(4096);

    const configuredModel = buildSyntheticPiModelFromRuntimeConfig(runtimeConfig, {
      resolvedModelString: runtimeConfig.model,
      routeProtocol: resolvePiRouteProtocol(runtimeConfig.provider, runtimeConfig.customProtocol),
      effectiveBaseUrl: runtimeConfig.baseUrl,
    });
    expect(configuredModel.contextWindow).toBe(32000);
    expect(configuredModel.maxTokens).toBe(8000);
  });

  it('changes the agent runtime signature when only contextWindow or maxTokens changes', () => {
    const store = new ConfigStore();
    store.update({
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.3',
      profiles: {
        ollama: {
          ...ollamaProfile,
          contextWindow: 32000,
          maxTokens: 8000,
        },
      },
    });

    const original = buildAgentRuntimeSignature(store.getAll());

    store.update({
      profiles: {
        ollama: {
          ...ollamaProfile,
          contextWindow: 64000,
          maxTokens: 8000,
        },
      },
    });
    expect(buildAgentRuntimeSignature(store.getAll())).not.toBe(original);

    store.update({
      profiles: {
        ollama: {
          ...ollamaProfile,
          contextWindow: 64000,
          maxTokens: 16000,
        },
      },
    });
    const afterMaxTokens = buildAgentRuntimeSignature(store.getAll());
    expect(afterMaxTokens).not.toBe(original);

    store.update({
      profiles: {
        ollama: {
          ...ollamaProfile,
          contextWindow: 64000,
          maxTokens: 16000,
        },
      },
    });
    expect(buildAgentRuntimeSignature(store.getAll())).toBe(afterMaxTokens);
  });
});
