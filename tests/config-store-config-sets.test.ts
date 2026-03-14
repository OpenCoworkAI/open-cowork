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

describe('ConfigStore config sets', () => {
  beforeEach(() => {
    mocks.seed = {};
  });

  it('migrates legacy fields into default config set transparently', () => {
    mocks.seed = {
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: 'sk-legacy-openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5-mini',
      enableThinking: true,
      isConfigured: true,
    };

    const store = new ConfigStore();
    const config = store.getAll();

    expect(config.activeConfigSetId).toBe('default');
    expect(config.configSets.length).toBe(1);
    expect(config.configSets[0].isSystem).toBe(true);
    expect(config.configSets[0].provider).toBe('openai');
    expect(config.provider).toBe('openai');
    expect(config.apiKey).toBe('sk-legacy-openai');
    expect(config.enableThinking).toBe(true);
  });

  it('creates/switches sets without polluting other sets', () => {
    mocks.seed = {
      provider: 'openrouter',
      customProtocol: 'anthropic',
      apiKey: 'sk-openrouter-origin',
      baseUrl: 'https://openrouter.ai/api',
      model: 'anthropic/claude-sonnet-4-6',
      enableThinking: false,
      isConfigured: true,
    };

    const store = new ConfigStore();

    const created = store.createSet({ name: 'Work OpenAI', mode: 'clone' });
    expect(created.configSets.length).toBe(2);
    const newSet = created.configSets.find((set) => set.id !== 'default');
    expect(newSet?.name).toBe('Work OpenAI');
    expect(created.activeConfigSetId).toBe(newSet?.id);

    store.update({ provider: 'openai', apiKey: 'sk-openai-new', model: 'gpt-5-mini' });
    const openaiSetView = store.getAll();
    expect(openaiSetView.provider).toBe('openai');
    expect(openaiSetView.apiKey).toBe('sk-openai-new');

    store.switchSet({ id: 'default' });
    const defaultSetView = store.getAll();
    expect(defaultSetView.provider).toBe('openrouter');
    expect(defaultSetView.apiKey).toBe('sk-openrouter-origin');
  });

  it('guards default set deletion and falls back to default after delete', () => {
    const store = new ConfigStore();
    const created = store.createSet({ name: 'My Set', mode: 'clone' });
    const customSet = created.configSets.find((set) => !set.isSystem);
    expect(customSet).toBeTruthy();

    expect(() => store.deleteSet({ id: 'default' })).toThrowError();

    const renamed = store.renameSet({ id: customSet!.id, name: 'My Renamed Set' });
    const renamedSet = renamed.configSets.find((set) => set.id === customSet!.id);
    expect(renamedSet?.name).toBe('My Renamed Set');

    store.switchSet({ id: customSet!.id });
    const afterDelete = store.deleteSet({ id: customSet!.id });
    expect(afterDelete.activeConfigSetId).toBe('default');
    expect(afterDelete.configSets.length).toBe(1);
  });

  it('creates blank set with default values for current provider/protocol', () => {
    mocks.seed = {
      provider: 'custom',
      customProtocol: 'openai',
      apiKey: 'sk-existing',
      baseUrl: 'https://example.com/v1',
      model: 'custom-model',
      enableThinking: true,
      isConfigured: true,
    };

    const store = new ConfigStore();
    const created = store.createSet({ name: 'Blank Set', mode: 'blank' });
    const blankSet = created.configSets.find((set) => set.id !== 'default');
    expect(blankSet).toBeTruthy();
    expect(blankSet?.provider).toBe('custom');
    expect(blankSet?.customProtocol).toBe('openai');
    expect(blankSet?.enableThinking).toBe(false);
    expect(blankSet?.profiles['custom:openai']?.apiKey).toBe('');
    expect(blankSet?.profiles['custom:openai']?.baseUrl).toBe('https://api.openai.com/v1');
    expect(blankSet?.profiles['custom:openai']?.model).toBe('gpt-5.4');
    expect(created.activeConfigSetId).toBe(blankSet?.id);
    expect(created.provider).toBe('custom');
    expect(created.customProtocol).toBe('openai');
    expect(created.apiKey).toBe('');
  });

  it('allows renaming default set but still blocks deleting it', () => {
    const store = new ConfigStore();
    const renamed = store.renameSet({ id: 'default', name: 'Main Profile' });
    expect(renamed.configSets[0].name).toBe('Main Profile');
    expect(() => store.deleteSet({ id: 'default' })).toThrowError();
  });

  it('creates blank set from gemini provider with gemini defaults intact', () => {
    mocks.seed = {
      provider: 'gemini',
      customProtocol: 'gemini',
      apiKey: 'AIza-existing',
      baseUrl: 'https://generativelanguage.googleapis.com',
      model: 'gemini/gemini-2.5-pro',
      enableThinking: false,
      isConfigured: true,
    };

    const store = new ConfigStore();
    const created = store.createSet({ name: 'Gemini Blank', mode: 'blank' });
    const blankSet = created.configSets.find((set) => set.id !== 'default');

    expect(blankSet?.provider).toBe('gemini');
    expect(blankSet?.profiles.gemini?.apiKey).toBe('');
    expect(blankSet?.profiles.gemini?.baseUrl).toBe('https://generativelanguage.googleapis.com');
    expect(blankSet?.profiles.gemini?.model).toBe('gemini-2.5-flash');
  });
});
