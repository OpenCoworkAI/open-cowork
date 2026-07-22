import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/main/config/config-store';

const mocks = vi.hoisted(() => ({
  completeSimple: vi.fn(),
  setRuntimeApiKey: vi.fn(),
  resolvePiRegistryModel: vi.fn(),
  buildSyntheticPiModel: vi.fn(),
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-claude-sdk-one-shot-config.json';

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

vi.mock('@earendil-works/pi-ai/compat', () => ({
  completeSimple: mocks.completeSimple,
}));

vi.mock('../src/main/agent/shared-auth', () => ({
  getSharedAuthStorage: () => ({
    setRuntimeApiKey: mocks.setRuntimeApiKey,
  }),
}));

vi.mock('../src/main/agent/pi-model-resolution', () => ({
  resolvePiRouteProtocol: (
    provider?: string,
    customProtocol?: string,
    baseUrl?: string,
    model?: string
  ) => {
    const modelId = model?.includes('/') ? model.split('/').slice(1).join('/') : model;
    if (
      baseUrl?.includes('api.deepseek.com') &&
      (!modelId || modelId.toLowerCase().startsWith('deepseek') || provider === 'custom')
    ) {
      return 'openai';
    }
    if (provider === 'custom') {
      if (customProtocol === 'openai' || customProtocol === 'gemini') {
        return customProtocol;
      }
      return 'anthropic';
    }
    if (provider === 'ollama' || provider === 'openai' || provider === 'openrouter') {
      return 'openai';
    }
    if (provider === 'gemini') {
      return 'gemini';
    }
    return provider || 'anthropic';
  },
  resolvePiModelString: ({
    model,
    customProtocol,
    provider,
  }: {
    model?: string;
    customProtocol?: string;
    provider?: string;
  }) => {
    const value = model?.trim() || 'claude-sonnet-4-6';
    if (value.includes('/')) {
      return value;
    }
    return `${customProtocol || provider || 'anthropic'}/${value}`;
  },
  resolvePiRegistryModel: mocks.resolvePiRegistryModel,
  buildSyntheticPiModel: mocks.buildSyntheticPiModel,
  applyPiModelRuntimeOverrides: (model: unknown) => model,
  resolveSyntheticPiModelFallback: ({
    rawModel,
    resolvedModelString,
    rawProvider,
    routeProtocol,
    baseUrl,
  }: {
    rawModel?: string;
    resolvedModelString: string;
    rawProvider?: string;
    routeProtocol: string;
    baseUrl?: string;
  }) => {
    const raw = rawModel?.trim() || '';
    const resolved = resolvedModelString.trim();
    const parts = resolved.split('/');
    const strippedModelId = parts.length >= 2 ? parts.slice(1).join('/') : resolved;
    const preserve =
      rawProvider === 'openrouter' && routeProtocol === 'openai' && raw.includes('/');
    if (baseUrl?.includes('api.deepseek.com')) {
      return {
        provider: 'deepseek',
        modelId: strippedModelId,
        baseUrl,
      };
    }
    return {
      provider:
        rawProvider === 'openrouter' ? 'openrouter' : parts[0] || rawProvider || routeProtocol,
      modelId: preserve ? resolved : strippedModelId,
      baseUrl,
    };
  },
  inferPiApi: (protocol: string) => {
    if (protocol === 'anthropic') return 'anthropic-messages';
    if (protocol === 'gemini' || protocol === 'google') return 'google-generative-ai';
    return 'openai-completions';
  },
}));

import { probeWithSdk } from '../src/main/agent/sdk-one-shot';

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    provider: 'openai',
    apiKey: 'sk-saved',
    baseUrl: 'https://api.openai.com/v1',
    customProtocol: 'openai',
    model: 'gpt-5.4',
    activeProfileKey: 'openai',
    profiles: {},
    activeConfigSetId: 'default',
    configSets: [],
    agentCliPath: '',
    defaultWorkdir: '',
    globalSkillsPath: '',
    enableDevLogs: true,
    sandboxEnabled: false,
    enableThinking: false,
    isConfigured: true,
    ...overrides,
  };
}

describe('probeWithSdk', () => {
  beforeEach(() => {
    mocks.completeSimple.mockReset();
    mocks.setRuntimeApiKey.mockReset();
    mocks.resolvePiRegistryModel.mockReset();
    mocks.buildSyntheticPiModel.mockReset();

    mocks.resolvePiRegistryModel.mockReturnValue({
      id: 'gpt-5.4',
      provider: 'openai',
      api: 'openai-completions',
      baseUrl: 'https://api.openai.com/v1',
    });
    mocks.completeSimple.mockResolvedValue({
      content: [{ type: 'text', text: 'sdk_probe_ok' }],
    });
  });

  it('does not fall back to saved api key when the draft explicitly clears it', async () => {
    const result = await probeWithSdk(
      {
        provider: 'openai',
        apiKey: '',
        model: 'gpt-5.4',
      },
      createConfig()
    );

    expect(result).toEqual({
      ok: false,
      errorType: 'missing_key',
      details: 'API key is required.',
    });
    expect(mocks.completeSimple).not.toHaveBeenCalled();
  });

  it('does not fall back to saved model when the draft explicitly clears it', async () => {
    const result = await probeWithSdk(
      {
        provider: 'openai',
        apiKey: 'sk-current',
        model: '',
      },
      createConfig()
    );

    expect(result).toEqual({
      ok: false,
      errorType: 'unknown',
      details: 'missing_model',
    });
    expect(mocks.completeSimple).not.toHaveBeenCalled();
  });

  it('allows empty key for loopback custom anthropic probe requests', async () => {
    const result = await probeWithSdk(
      {
        provider: 'custom',
        customProtocol: 'anthropic',
        apiKey: '',
        baseUrl: 'http://127.0.0.1:8082',
        model: 'glm-5',
      },
      createConfig({
        provider: 'custom',
        customProtocol: 'anthropic',
        apiKey: '',
        baseUrl: 'http://127.0.0.1:8082',
        model: 'glm-5',
        activeProfileKey: 'custom:anthropic',
      })
    );

    expect(result.ok).toBe(true);
    expect(mocks.completeSimple).toHaveBeenCalledTimes(1);
    expect(mocks.completeSimple.mock.calls[0]?.[2]).toEqual({
      apiKey: 'sk-ant-local-proxy',
    });
  });

  it('treats thinking-only response as successful probe', async () => {
    mocks.completeSimple.mockResolvedValue({
      content: [{ type: 'thinking', thinking: 'Let me think about this probe request...' }],
    });

    const result = await probeWithSdk(
      { provider: 'openai', apiKey: 'sk-test', model: 'kimi-k2.5' },
      createConfig()
    );

    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns empty_probe_response when thinking blocks are empty', async () => {
    mocks.completeSimple.mockResolvedValue({
      content: [{ type: 'thinking', thinking: '' }],
    });

    const result = await probeWithSdk(
      { provider: 'openai', apiKey: 'sk-test', model: 'kimi-k2.5' },
      createConfig()
    );

    expect(result.ok).toBe(false);
    expect(result.details).toBe('empty_probe_response');
  });

  it('succeeds when response has both text ack and thinking blocks', async () => {
    mocks.completeSimple.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: 'The user wants me to reply with sdk_probe_ok.' },
        { type: 'text', text: 'sdk_probe_ok' },
      ],
    });

    const result = await probeWithSdk(
      { provider: 'openai', apiKey: 'sk-test', model: 'kimi-k2.5' },
      createConfig()
    );

    expect(result.ok).toBe(true);
  });

  it('accepts probe ack wrapped in markdown formatting', async () => {
    mocks.completeSimple.mockResolvedValue({
      content: [{ type: 'text', text: '**sdk_probe_ok**' }],
    });

    const result = await probeWithSdk(
      { provider: 'openai', apiKey: 'sk-test', model: 'gpt-5.4' },
      createConfig()
    );

    expect(result.ok).toBe(true);
  });

  it('accepts probe ack with trailing punctuation', async () => {
    mocks.completeSimple.mockResolvedValue({
      content: [{ type: 'text', text: 'sdk_probe_ok.' }],
    });

    const result = await probeWithSdk(
      { provider: 'openai', apiKey: 'sk-test', model: 'gpt-5.4' },
      createConfig()
    );

    expect(result.ok).toBe(true);
  });

  it('accepts probe ack with chatty prefix', async () => {
    mocks.completeSimple.mockResolvedValue({
      content: [{ type: 'text', text: 'Sure! sdk_probe_ok' }],
    });

    const result = await probeWithSdk(
      { provider: 'openai', apiKey: 'sk-test', model: 'gpt-5.4' },
      createConfig()
    );

    expect(result.ok).toBe(true);
  });

  it('maps ECONNREFUSED to ollama_not_running for ollama provider', async () => {
    mocks.completeSimple.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434'));

    const result = await probeWithSdk(
      {
        provider: 'ollama',
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'qwen3.5:0.8b',
      },
      createConfig({
        provider: 'ollama',
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'qwen3.5:0.8b',
        activeProfileKey: 'ollama',
      })
    );

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('ollama_not_running');
    expect(result.details).toMatch(/ECONNREFUSED/i);
  });

  it('maps ECONNREFUSED to network_error for non-ollama provider', async () => {
    mocks.completeSimple.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8080'));

    const result = await probeWithSdk(
      {
        provider: 'custom',
        customProtocol: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'http://127.0.0.1:8080',
        model: 'gpt-4.1-mini',
      },
      createConfig({
        provider: 'custom',
        customProtocol: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'http://127.0.0.1:8080',
        model: 'gpt-4.1-mini',
        activeProfileKey: 'custom:openai',
      })
    );

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('network_error');
  });

  it('normalizes ollama probe base urls before building synthetic models', async () => {
    mocks.resolvePiRegistryModel.mockReturnValue(undefined);
    mocks.buildSyntheticPiModel.mockReturnValue({
      id: 'qwen3.5:0.8b',
      provider: 'ollama',
      api: 'openai-completions',
      baseUrl: 'http://localhost:11434/v1',
    });

    const result = await probeWithSdk(
      {
        provider: 'ollama',
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'qwen3.5:0.8b',
      },
      createConfig({
        provider: 'ollama',
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'qwen3.5:0.8b',
        activeProfileKey: 'ollama',
      })
    );

    expect(result.ok).toBe(true);
    expect(mocks.buildSyntheticPiModel).toHaveBeenCalledWith(
      'qwen3.5:0.8b',
      expect.any(String),
      'openai',
      'http://localhost:11434/v1',
      'openai-completions'
    );
  });

  it('keeps explicit openrouter model namespaces for synthetic fallback models', async () => {
    mocks.resolvePiRegistryModel.mockReturnValue(undefined);
    mocks.buildSyntheticPiModel.mockReturnValue({
      id: 'z-ai/glm-5-turbo',
      provider: 'openrouter',
      api: 'openai-completions',
      baseUrl: 'https://openrouter.ai/api/v1',
    });

    const result = await probeWithSdk(
      {
        provider: 'openrouter',
        apiKey: 'sk-or-test',
        model: 'z-ai/glm-5-turbo',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
      createConfig({
        provider: 'openrouter',
        apiKey: 'sk-or-test',
        baseUrl: 'https://openrouter.ai/api/v1',
        customProtocol: 'anthropic',
        model: 'z-ai/glm-5-turbo',
        activeProfileKey: 'openrouter',
      })
    );

    expect(result.ok).toBe(true);
    expect(mocks.buildSyntheticPiModel).toHaveBeenCalledWith(
      'z-ai/glm-5-turbo',
      'openrouter',
      'openai',
      'https://openrouter.ai/api/v1',
      'openai-completions'
    );
  });

  it('routes DeepSeek official custom probes through openai-compatible synthetic models', async () => {
    mocks.resolvePiRegistryModel.mockReturnValue(undefined);
    mocks.buildSyntheticPiModel.mockReturnValue({
      id: 'deepseek-v4-pro',
      provider: 'deepseek',
      api: 'openai-completions',
      baseUrl: 'https://api.deepseek.com/v1',
    });

    const result = await probeWithSdk(
      {
        provider: 'custom',
        customProtocol: 'anthropic',
        apiKey: 'sk-deepseek-test',
        model: 'anthropic/deepseek-v4-pro',
        baseUrl: 'https://api.deepseek.com/anthropic',
      },
      createConfig({
        provider: 'custom',
        customProtocol: 'anthropic',
        apiKey: 'sk-deepseek-test',
        baseUrl: 'https://api.deepseek.com/anthropic',
        model: 'anthropic/deepseek-v4-pro',
        activeProfileKey: 'custom:anthropic',
      })
    );

    expect(result.ok).toBe(true);
    expect(mocks.buildSyntheticPiModel).toHaveBeenCalledWith(
      'deepseek-v4-pro',
      'deepseek',
      'openai',
      'https://api.deepseek.com/v1',
      'openai-completions'
    );
  });

  // --- Gemini empty_probe_response regression tests (issue #88) ---

  it('surfaces provider error-as-resolve instead of empty_probe_response', async () => {
    mocks.completeSimple.mockResolvedValue({
      content: [],
      stopReason: 'error',
      errorMessage: 'API key not valid. Please pass a valid API key.',
    });

    const result = await probeWithSdk(
      { provider: 'gemini', apiKey: 'AIza-bad-key', model: 'gemini-2.5-flash' },
      createConfig({
        provider: 'gemini',
        customProtocol: 'gemini',
        apiKey: 'AIza-bad-key',
        model: 'gemini-2.5-flash',
      })
    );

    expect(result.ok).toBe(false);
    expect(result.details).not.toBe('empty_probe_response');
    expect(result.errorType).toBe('unauthorized');
    expect(result.details).toContain('API key not valid');
  });

  it('surfaces aborted stopReason instead of empty_probe_response', async () => {
    mocks.completeSimple.mockResolvedValue({
      content: [],
      stopReason: 'aborted',
      errorMessage: 'Request was aborted',
    });

    const result = await probeWithSdk(
      { provider: 'openai', apiKey: 'sk-test', model: 'gpt-5.4' },
      createConfig()
    );

    expect(result.ok).toBe(false);
    expect(result.details).not.toBe('empty_probe_response');
  });

  it('maps Gemini API_KEY_INVALID to unauthorized error type', async () => {
    mocks.completeSimple.mockResolvedValue({
      content: [],
      stopReason: 'error',
      errorMessage: 'API_KEY_INVALID',
    });

    const result = await probeWithSdk(
      { provider: 'gemini', apiKey: 'bad', model: 'gemini-2.5-flash' },
      createConfig({
        provider: 'gemini',
        customProtocol: 'gemini',
        apiKey: 'bad',
        model: 'gemini-2.5-flash',
      })
    );

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('unauthorized');
  });

  it('maps Gemini PERMISSION_DENIED to unauthorized error type', async () => {
    mocks.completeSimple.mockResolvedValue({
      content: [],
      stopReason: 'error',
      errorMessage: 'PERMISSION_DENIED: The caller does not have permission',
    });

    const result = await probeWithSdk(
      { provider: 'gemini', apiKey: 'bad', model: 'gemini-2.5-flash' },
      createConfig({
        provider: 'gemini',
        customProtocol: 'gemini',
        apiKey: 'bad',
        model: 'gemini-2.5-flash',
      })
    );

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('unauthorized');
  });

  it('falls back to generic unknown error for unrecognized provider error', async () => {
    mocks.completeSimple.mockResolvedValue({
      content: [],
      stopReason: 'error',
      errorMessage: 'An unknown error occurred',
    });

    const result = await probeWithSdk(
      { provider: 'gemini', apiKey: 'key', model: 'gemini-2.5-flash' },
      createConfig({
        provider: 'gemini',
        customProtocol: 'gemini',
        apiKey: 'key',
        model: 'gemini-2.5-flash',
      })
    );

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('unknown');
    expect(result.details).toBe('An unknown error occurred');
  });

  it('accepts probe ack with math answer prefix from question-style prompt', async () => {
    mocks.completeSimple.mockResolvedValue({
      content: [{ type: 'text', text: '2+2 = 4\n\nsdk_probe_ok' }],
    });

    const result = await probeWithSdk(
      { provider: 'gemini', apiKey: 'key', model: 'gemini-2.5-flash' },
      createConfig({
        provider: 'gemini',
        customProtocol: 'gemini',
        apiKey: 'key',
        model: 'gemini-2.5-flash',
      })
    );

    expect(result.ok).toBe(true);
  });
});
