import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-config-store-env.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = {
        ...(options?.defaults || {}),
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

describe('ConfigStore applyToEnv', () => {
  const originalEnv = {
    COWORK_WORKDIR: process.env.COWORK_WORKDIR,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
  };

  beforeEach(() => {
    delete process.env.COWORK_WORKDIR;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_BASE_URL;
  });

  afterEach(() => {
    if (originalEnv.COWORK_WORKDIR === undefined) {
      delete process.env.COWORK_WORKDIR;
    } else {
      process.env.COWORK_WORKDIR = originalEnv.COWORK_WORKDIR;
    }
    if (originalEnv.ANTHROPIC_API_KEY === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
    }
    if (originalEnv.ANTHROPIC_BASE_URL === undefined) {
      delete process.env.ANTHROPIC_BASE_URL;
    } else {
      process.env.ANTHROPIC_BASE_URL = originalEnv.ANTHROPIC_BASE_URL;
    }
    if (originalEnv.GEMINI_API_KEY === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY;
    }
    if (originalEnv.GEMINI_BASE_URL === undefined) {
      delete process.env.GEMINI_BASE_URL;
    } else {
      process.env.GEMINI_BASE_URL = originalEnv.GEMINI_BASE_URL;
    }
  });

  it('clears stale COWORK_WORKDIR when config value is removed', () => {
    const store = new ConfigStore();

    store.update({
      defaultWorkdir: '/tmp/cowork-valid-workdir',
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-5',
    });
    store.applyToEnv();
    expect(process.env.COWORK_WORKDIR).toBe('/tmp/cowork-valid-workdir');

    store.update({
      defaultWorkdir: '',
    });
    store.applyToEnv();

    expect(process.env.COWORK_WORKDIR).toBeUndefined();
  });

  it('exports loopback placeholder key for custom anthropic profile when api key is empty', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'custom',
      customProtocol: 'anthropic',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8082',
      model: 'openai/gpt-4.1-mini',
    });
    store.applyToEnv();

    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-local-proxy');
  });

  it('normalizes trailing /v1 for anthropic-compatible base url when applying env', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'custom',
      customProtocol: 'anthropic',
      apiKey: 'sk-test',
      baseUrl: 'https://api.duckcoding.ai/v1',
      model: 'gpt-5.3-codex',
    });
    store.applyToEnv();

    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://api.duckcoding.ai');
  });

  it('exports gemini credentials without leaking anthropic auth env', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'gemini',
      customProtocol: 'gemini',
      apiKey: 'AIza-test',
      baseUrl: 'https://generativelanguage.googleapis.com/',
      model: 'gemini/gemini-2.5-flash',
    });
    store.applyToEnv();

    expect(process.env.GEMINI_API_KEY).toBe('AIza-test');
    expect(process.env.GEMINI_BASE_URL).toBe('https://generativelanguage.googleapis.com');
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });
});
