import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const dnsLookup = vi.fn();
  const tcpConnect = vi.fn();
  const tlsConnect = vi.fn();
  const openaiModelsList = vi.fn();
  const fetch = vi.fn();
  const probeWithClaudeSdk = vi.fn();

  return {
    dnsLookup,
    tcpConnect,
    tlsConnect,
    openaiModelsList,
    fetch,
    probeWithClaudeSdk,
  };
});

vi.mock('dns', () => ({
  promises: {
    lookup: mocks.dnsLookup,
  },
}));

vi.mock('net', () => ({
  createConnection: mocks.tcpConnect,
  isIP: (input: string) => {
    if (input === '127.0.0.1') return 4;
    if (input === '::1') return 6;
    return 0;
  },
}));

vi.mock('tls', () => ({
  connect: mocks.tlsConnect,
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    models = { list: mocks.openaiModelsList };
    chat = { completions: { create: vi.fn() } };
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  Anthropic: vi.fn(),
}));

vi.mock('../src/main/config/config-store', () => ({
  PROVIDER_PRESETS: {
    openai: { baseUrl: 'https://api.openai.com/v1' },
    anthropic: { baseUrl: 'https://api.anthropic.com' },
    ollama: { baseUrl: 'http://localhost:11434/v1' },
    openrouter: { baseUrl: 'https://openrouter.ai/api' },
  },
  configStore: {
    getAll: () => ({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1',
      activeProfileKey: 'openai',
      profiles: {},
      activeConfigSetId: 'default',
      configSets: [],
      isConfigured: true,
    }),
  },
}));

vi.mock('../src/main/claude/claude-sdk-one-shot', () => ({
  probeWithClaudeSdk: mocks.probeWithClaudeSdk,
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
}));

import { discoverLocalOllama, runDiagnostics } from '../src/main/config/api-diagnostics';
import { resetOllamaModelIndexCache } from '../src/main/config/ollama-api';

describe('runDiagnostics TLS step', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetOllamaModelIndexCache();
    mocks.dnsLookup.mockReset();
    mocks.tcpConnect.mockReset();
    mocks.tlsConnect.mockReset();
    mocks.openaiModelsList.mockReset();
    mocks.fetch.mockReset();
    mocks.probeWithClaudeSdk.mockReset();
    global.fetch = mocks.fetch;

    mocks.dnsLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 });
    mocks.openaiModelsList.mockResolvedValue({});
    mocks.probeWithClaudeSdk.mockResolvedValue({ ok: true, latencyMs: 10 });

    mocks.tcpConnect.mockImplementation(() => {
      const handlers: Record<string, () => void> = {};
      const socket = {
        once(event: string, handler: () => void) {
          handlers[event] = handler;
          if (event === 'connect') queueMicrotask(handler);
          return socket;
        },
        destroy: vi.fn(),
      };
      return socket;
    });

    mocks.tlsConnect.mockImplementation(
      (_options: Record<string, unknown>, onSecure?: () => void) => {
        const handlers: Record<string, () => void> = {};
        const socket = {
          authorized: true,
          authorizationError: null,
          once(event: string, handler: () => void) {
            handlers[event] = handler;
            return socket;
          },
          destroy: vi.fn(),
        };
        queueMicrotask(() => {
          handlers.secureConnect?.();
          onSecure?.();
        });
        return socket;
      }
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends servername for HTTPS hostnames so SNI-enabled endpoints validate correctly', async () => {
    const result = await runDiagnostics({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
    });

    expect(result.overallOk).toBe(true);
    const [options] = mocks.tlsConnect.mock.calls[0];
    expect(options).toMatchObject({
      host: 'api.openai.com',
      port: 443,
      timeout: 5000,
      servername: 'api.openai.com',
    });
  });

  it('does not send servername for IP-based HTTPS endpoints', async () => {
    const result = await runDiagnostics({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://127.0.0.1:8443/v1',
    });

    expect(result.overallOk).toBe(true);
    const [options] = mocks.tlsConnect.mock.calls[0];
    expect(options).toMatchObject({
      host: '127.0.0.1',
      port: 8443,
      timeout: 5000,
    });
    expect(options.servername).toBeUndefined();
  });

  it('normalizes bracketed IPv6 hosts before DNS/TCP/TLS checks', async () => {
    const result = await runDiagnostics({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://[::1]:8443/v1',
    });

    expect(result.overallOk).toBe(true);
    expect(mocks.dnsLookup).not.toHaveBeenCalled();

    const [tcpOptions] = mocks.tcpConnect.mock.calls[0];
    expect(tcpOptions).toMatchObject({
      host: '::1',
      port: 8443,
      timeout: 5000,
    });

    const [tlsOptions] = mocks.tlsConnect.mock.calls[0];
    expect(tlsOptions).toMatchObject({
      host: '::1',
      port: 8443,
      timeout: 5000,
    });
    expect(tlsOptions.servername).toBeUndefined();
  });

  it('uses standard HTTPS port for remote Ollama endpoints without an explicit port', async () => {
    const result = await runDiagnostics({
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'https://ollama.example.internal/v1',
      model: 'qwen3.5:0.8b',
    });

    expect(result.overallOk).toBe(true);

    const [tcpOptions] = mocks.tcpConnect.mock.calls[0];
    expect(tcpOptions).toMatchObject({
      host: 'ollama.example.internal',
      port: 443,
      timeout: 5000,
    });

    const [tlsOptions] = mocks.tlsConnect.mock.calls[0];
    expect(tlsOptions).toMatchObject({
      host: 'ollama.example.internal',
      port: 443,
      timeout: 5000,
      servername: 'ollama.example.internal',
    });
  });

  it('model step uses probeWithClaudeSdk', async () => {
    mocks.probeWithClaudeSdk.mockResolvedValue({ ok: true, latencyMs: 15 });

    const result = await runDiagnostics({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1',
    });

    expect(result.overallOk).toBe(true);
    expect(mocks.probeWithClaudeSdk).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4.1',
      }),
      expect.any(Object)
    );
  });

  it('model step reports failure from probeWithClaudeSdk', async () => {
    mocks.probeWithClaudeSdk.mockResolvedValue({
      ok: false,
      errorType: 'unauthorized',
      details: '401 Unauthorized',
    });

    const result = await runDiagnostics({
      provider: 'openai',
      apiKey: 'sk-bad',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1',
    });

    expect(result.overallOk).toBe(false);
    expect(result.failedAt).toBe('model');
    const modelStep = result.steps.find((s) => s.name === 'model');
    expect(modelStep?.status).toBe('fail');
    expect(modelStep?.error).toBe('401 Unauthorized');
  });

  it.each([
    ['network_error', 'connection reset by peer', 'model_network_error:gpt-4.1'],
    ['rate_limited', '429 Too Many Requests', 'model_rate_limited:gpt-4.1'],
    ['server_error', '502 Bad Gateway', 'model_request_failed:gpt-4.1'],
    ['unauthorized', '403 Forbidden', 'auth_invalid_key'],
  ] as const)(
    'maps %s probe failures to a specific diagnostic fix instead of model_unavailable',
    async (errorType, details, expectedFix) => {
      mocks.probeWithClaudeSdk.mockResolvedValue({
        ok: false,
        errorType,
        details,
      });

      const result = await runDiagnostics({
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
      });

      expect(result.overallOk).toBe(false);
      expect(result.failedAt).toBe('model');
      const modelStep = result.steps.find((s) => s.name === 'model');
      expect(modelStep?.status).toBe('fail');
      expect(modelStep?.error).toBe(details);
      expect(modelStep?.fix).toBe(expectedFix);
    }
  );

  it('discovers local Ollama using the caller-provided loopback endpoint', async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: 'qwen3.5:0.8b' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const result = await discoverLocalOllama({
      baseUrl: 'http://127.0.0.1:18080/api',
    });

    expect(result).toEqual({
      available: true,
      baseUrl: 'http://127.0.0.1:18080/v1',
      models: ['qwen3.5:0.8b'],
      status: 'models_available',
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:18080/v1/models',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('falls back to the default local endpoint when a remote base url is passed to local discovery', async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: 'qwen3.5:0.8b' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const result = await discoverLocalOllama({
      baseUrl: 'https://ollama.example.internal/v1',
    });

    expect(result).toEqual({
      available: true,
      baseUrl: 'http://localhost:11434/v1',
      models: ['qwen3.5:0.8b'],
      status: 'models_available',
    });
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:11434/v1/models',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('distinguishes a reachable service with no models from a usable local model runtime', async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const result = await discoverLocalOllama({
      baseUrl: 'http://127.0.0.1:18080/v1',
    });

    expect(result).toEqual({
      available: true,
      baseUrl: 'http://127.0.0.1:18080/v1',
      models: [],
      status: 'service_available',
    });
  });

  it('treats listed models as discoverable without performing a live inference probe', async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: 'qwen3.5:0.8b' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const result = await discoverLocalOllama({
      baseUrl: 'http://127.0.0.1:18080/v1',
    });

    expect(result).toEqual({
      available: true,
      baseUrl: 'http://127.0.0.1:18080/v1',
      models: ['qwen3.5:0.8b'],
      status: 'models_available',
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
