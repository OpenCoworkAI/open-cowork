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

describe('ConfigStore provider profiles', () => {
  beforeEach(() => {
    mocks.seed = {};
  });

  it('migrates legacy single-profile fields into active profile', () => {
    mocks.seed = {
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: 'sk-legacy-openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.2-mini',
      enableDevLogs: true,
      sandboxEnabled: false,
      enableThinking: false,
      isConfigured: true,
    };

    const store = new ConfigStore();
    const config = store.getAll();

    expect(config.activeProfileKey).toBe('openai');
    expect(config.apiKey).toBe('sk-legacy-openai');
    expect(config.profiles.openai?.apiKey).toBe('sk-legacy-openai');
    expect(config.profiles.openrouter?.apiKey).toBe('');
    expect(config.profiles['custom:anthropic']?.apiKey).toBe('');
  });

  it('switches provider without overwriting other provider profiles', () => {
    mocks.seed = {
      provider: 'openai',
      customProtocol: 'anthropic',
      activeProfileKey: 'openai',
      profiles: {
        openai: {
          apiKey: 'sk-openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.2',

        },
        openrouter: {
          apiKey: 'sk-openrouter',
          baseUrl: 'https://openrouter.ai/api',
          model: 'anthropic/claude-sonnet-4.5',

        },
        anthropic: {
          apiKey: 'sk-ant',
          baseUrl: 'https://api.anthropic.com',
          model: 'claude-sonnet-4-5',

        },
        'custom:anthropic': {
          apiKey: 'sk-custom-ant',
          baseUrl: 'https://custom.example/anthropic',
          model: 'glm-4.7',

        },
        'custom:openai': {
          apiKey: 'sk-custom-openai',
          baseUrl: 'https://custom.example/openai/v1',
          model: 'gpt-5.2',

        },
      },
      enableDevLogs: true,
      sandboxEnabled: false,
      enableThinking: false,
      isConfigured: true,
    };

    const store = new ConfigStore();
    store.update({ provider: 'openrouter' });
    const switched = store.getAll();

    expect(switched.provider).toBe('openrouter');
    expect(switched.apiKey).toBe('sk-openrouter');
    expect(switched.profiles.openai?.apiKey).toBe('sk-openai');

    store.update({ provider: 'openai' });
    const back = store.getAll();
    expect(back.provider).toBe('openai');
    expect(back.apiKey).toBe('sk-openai');
  });

  it('updates active profile credentials only for current profile', () => {
    const store = new ConfigStore();

    store.update({ provider: 'openrouter' });
    store.update({
      apiKey: 'sk-or-new',
      model: 'anthropic/claude-sonnet-4',
      baseUrl: 'https://openrouter.ai/api',
    });

    store.update({ provider: 'openai' });
    const openaiView = store.getAll();
    expect(openaiView.provider).toBe('openai');
    expect(openaiView.apiKey).toBe('');

    store.update({ provider: 'openrouter' });
    const openrouterView = store.getAll();
    expect(openrouterView.provider).toBe('openrouter');
    expect(openrouterView.apiKey).toBe('sk-or-new');
    expect(openrouterView.model).toBe('anthropic/claude-sonnet-4');
  });

  it('keeps gemini and custom gemini profiles isolated from other providers', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'gemini',
      apiKey: 'AIza-official',
      baseUrl: 'https://generativelanguage.googleapis.com',
      model: 'gemini/gemini-2.5-flash',
    });
    store.update({
      provider: 'custom',
      customProtocol: 'gemini',
      apiKey: 'AIza-relay',
      baseUrl: 'https://gemini-proxy.example/v1',
      model: 'gemini/gemini-2.5-pro',
    });

    const customGeminiView = store.getAll();
    expect(customGeminiView.provider).toBe('custom');
    expect(customGeminiView.customProtocol).toBe('gemini');
    expect(customGeminiView.apiKey).toBe('AIza-relay');
    expect(customGeminiView.profiles.gemini?.apiKey).toBe('AIza-official');

    store.update({ provider: 'gemini' });
    const geminiView = store.getAll();
    expect(geminiView.provider).toBe('gemini');
    expect(geminiView.apiKey).toBe('AIza-official');
    expect(geminiView.model).toBe('gemini/gemini-2.5-flash');
  });

  it('treats global configured state as any set usable while active set can still be unusable', () => {
    const store = new ConfigStore();

    store.update({ provider: 'openrouter', apiKey: 'sk-or-global' });
    store.createSet({ name: 'Blank Active', mode: 'blank' });

    expect(store.hasUsableCredentialsForActiveSet()).toBe(false);
    expect(store.hasAnyUsableCredentials()).toBe(true);
    expect(store.isConfigured()).toBe(true);
  });

  it('treats local custom anthropic gateway as usable without api key', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'custom',
      customProtocol: 'anthropic',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8082',
      model: 'openai/gpt-4.1-mini',
    });

    expect(store.hasUsableCredentialsForActiveSet()).toBe(true);
    expect(store.hasAnyUsableCredentials()).toBe(true);
    expect(store.isConfigured()).toBe(true);
  });

  it('treats ipv6 loopback custom anthropic gateway as usable without api key', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'custom',
      customProtocol: 'anthropic',
      apiKey: '',
      baseUrl: 'http://[::1]:8082',
      model: 'openai/gpt-4.1-mini',
    });

    expect(store.hasUsableCredentialsForActiveSet()).toBe(true);
    expect(store.hasAnyUsableCredentials()).toBe(true);
    expect(store.isConfigured()).toBe(true);
  });

  it('treats loopback custom gemini gateway as usable without api key', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'custom',
      customProtocol: 'gemini',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8082',
      model: 'gemini/gemini-2.5-flash',
    });

    expect(store.hasUsableCredentialsForActiveSet()).toBe(true);
    expect(store.hasAnyUsableCredentials()).toBe(true);
    expect(store.isConfigured()).toBe(true);
  });

  it('treats loopback custom openai gateway as usable without api key', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'custom',
      customProtocol: 'openai',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8082/v1',
      model: 'gpt-4.1-mini',
    });

    expect(store.hasUsableCredentialsForActiveSet()).toBe(true);
    expect(store.hasAnyUsableCredentials()).toBe(true);
    expect(store.isConfigured()).toBe(true);
  });

  it('does not treat ollama as configured when model is still empty', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: '',
    });

    expect(store.hasUsableCredentialsForActiveSet()).toBe(false);
    expect(store.hasAnyUsableCredentials()).toBe(false);
    expect(store.isConfigured()).toBe(false);
  });

  it('keeps non-loopback custom anthropic gateway requiring api key', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'custom',
      customProtocol: 'anthropic',
      apiKey: '',
      baseUrl: 'https://proxy.example.com/anthropic',
      model: 'openai/gpt-4.1-mini',
    });

    expect(store.hasUsableCredentialsForActiveSet()).toBe(false);
    expect(store.hasAnyUsableCredentials()).toBe(false);
    expect(store.isConfigured()).toBe(false);
  });
});
