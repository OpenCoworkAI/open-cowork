import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron-store as a proper class constructor
vi.mock('electron-store', () => {
  class MockStore {
    private data: Record<string, unknown> = {};
    constructor(opts?: any) {
      if (opts?.defaults) {
        this.data = { ...opts.defaults };
      }
    }
    get(key: string) { return this.data[key]; }
    set(key: string, value: unknown) { this.data[key] = value; }
    clear() { this.data = {}; }
    get path() { return '/tmp/test-config.json'; }
  }
  return { default: MockStore };
});

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-userdata',
    getVersion: () => '3.1.0',
  },
}));

vi.mock('fs', () => ({
  existsSync: () => true,
  mkdirSync: () => {},
  createWriteStream: () => ({ write: () => {}, end: () => {} }),
  readdirSync: () => [],
  statSync: () => ({ size: 100, mtime: new Date() }),
  unlinkSync: () => {},
}));

import { configStore, PROVIDER_PRESETS } from '../src/main/config/config-store';

describe('configStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAll', () => {
    it('returns config object with expected keys', () => {
      const config = configStore.getAll();
      expect(config).toHaveProperty('provider');
      expect(config).toHaveProperty('apiKey');
      expect(config).toHaveProperty('model');
    });
  });

  describe('get', () => {
    it('returns specific config value after set', () => {
      configStore.set('apiKey', 'test-value');
      const value = configStore.get('apiKey');
      expect(value).toBe('test-value');
    });
  });

  describe('set', () => {
    it('sets a config value', () => {
      configStore.set('apiKey', 'new-key');
      expect(configStore.get('apiKey')).toBe('new-key');
    });
  });

  describe('update', () => {
    it('updates multiple values', () => {
      configStore.update({ apiKey: 'key1', model: 'model1' });
      expect(configStore.get('apiKey')).toBe('key1');
      expect(configStore.get('model')).toBe('model1');
    });
  });

  describe('isConfigured', () => {
    it('returns true when configured with API key', () => {
      configStore.set('isConfigured', true);
      configStore.set('apiKey', 'test-key');
      expect(configStore.isConfigured()).toBe(true);
    });

    it('returns false when not configured', () => {
      configStore.set('isConfigured', false);
      configStore.set('apiKey', '');
      expect(configStore.isConfigured()).toBe(false);
    });
  });

  describe('applyToEnv', () => {
    it('sets env vars for anthropic provider', () => {
      configStore.update({
        provider: 'anthropic',
        apiKey: 'sk-ant-test',
        baseUrl: 'https://api.anthropic.com',
        customProtocol: 'anthropic',
        model: 'claude-sonnet-4-5',
        isConfigured: true,
      });

      configStore.applyToEnv();
      expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
      expect(process.env.CLAUDE_MODEL).toBe('claude-sonnet-4-5');
    });

    it('sets env vars for openai provider', () => {
      configStore.update({
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        customProtocol: 'openai',
        model: 'gpt-5.2',
        openaiMode: 'responses',
        isConfigured: true,
      });

      configStore.applyToEnv();
      expect(process.env.OPENAI_API_KEY).toBe('sk-test');
      expect(process.env.OPENAI_MODEL).toBe('gpt-5.2');
      expect(process.env.OPENAI_API_MODE).toBe('responses');
    });
  });

  describe('reset', () => {
    it('resets the store', () => {
      configStore.set('apiKey', 'some-key');
      configStore.reset();
      // After reset, values should be defaults (empty/undefined)
      const config = configStore.getAll();
      expect(config).toBeDefined();
    });
  });

  describe('getPath', () => {
    it('returns the store file path', () => {
      expect(configStore.getPath()).toBe('/tmp/test-config.json');
    });
  });
});

describe('PROVIDER_PRESETS', () => {
  it('has all required providers', () => {
    expect(PROVIDER_PRESETS).toHaveProperty('openrouter');
    expect(PROVIDER_PRESETS).toHaveProperty('anthropic');
    expect(PROVIDER_PRESETS).toHaveProperty('openai');
    expect(PROVIDER_PRESETS).toHaveProperty('custom');
  });

  it('each preset has required fields', () => {
    for (const [, preset] of Object.entries(PROVIDER_PRESETS)) {
      expect(preset).toHaveProperty('name');
      expect(preset).toHaveProperty('baseUrl');
      expect(preset).toHaveProperty('models');
      expect(preset).toHaveProperty('keyPlaceholder');
      expect(preset).toHaveProperty('keyHint');
      expect(Array.isArray(preset.models)).toBe(true);
      expect(preset.models.length).toBeGreaterThan(0);
    }
  });

  it('preset names are in English', () => {
    expect(PROVIDER_PRESETS.openrouter.name).toBe('OpenRouter');
    expect(PROVIDER_PRESETS.anthropic.name).toBe('Anthropic');
    expect(PROVIDER_PRESETS.openai.name).toBe('OpenAI');
    expect(PROVIDER_PRESETS.custom.name).toBe('More Models');
  });

  it('key hints are in English', () => {
    for (const [, preset] of Object.entries(PROVIDER_PRESETS)) {
      // Ensure no Chinese characters in keyHint
      expect(preset.keyHint).not.toMatch(/[\u4e00-\u9fff]/);
    }
  });
});
