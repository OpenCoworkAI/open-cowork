import { beforeEach, describe, expect, it, vi } from 'vitest';

const completeSimpleMock = vi.hoisted(() => vi.fn());

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: completeSimpleMock,
  getModel: vi.fn(() => undefined),
}));

vi.mock('../../main/agent/shared-auth', () => ({
  getSharedAuthStorage: () => ({
    setRuntimeApiKey: vi.fn(),
  }),
  ModelRegistry: vi.fn(),
}));

import type { AppConfig } from '../../main/config/config-store';
import { runPiAiOneShot } from '../../main/agent/sdk-one-shot';

function makeConfig(): AppConfig {
  return {
    provider: 'custom',
    customProtocol: 'openai',
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    model: 'test-model',
    activeProfileKey: 'custom:openai',
    profiles: {},
    activeConfigSetId: 'default',
    configSets: [],
    agentCliPath: '',
    defaultWorkdir: '',
    globalSkillsPath: '',
    enableDevLogs: false,
    theme: 'light',
    sandboxEnabled: false,
    memoryEnabled: true,
    memoryRuntime: {
      llm: {
        inheritFromActive: true,
        apiKey: '',
        baseUrl: '',
        model: '',
        timeoutMs: 180000,
      },
      embedding: {
        inheritFromActive: true,
        apiKey: '',
        baseUrl: '',
        model: 'text-embedding-3-small',
        timeoutMs: 180000,
      },
      useEmbedding: false,
      maxNavSteps: 2,
      ingestionConcurrency: 4,
      storageRoot: '',
      evalEnabled: false,
      evalWorkspaces: [],
      evalMaxRounds: 12,
      evalArtifactsRoot: '',
      promptIterationRounds: 2,
    },
    enableThinking: false,
    isConfigured: true,
  };
}

describe('runPiAiOneShot', () => {
  beforeEach(() => {
    completeSimpleMock.mockReset();
    completeSimpleMock.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'stop',
    });
  });

  it.each(['vllm', 'lmstudio'] as const)(
    'uses endpoint-local placeholder auth for %s probes',
    async (provider) => {
      const baseUrl = provider === 'vllm' ? 'http://localhost:8000/v1' : 'http://localhost:1234/v1';
      await runPiAiOneShot('hello', 'system', {
        ...makeConfig(),
        provider,
        apiKey: '',
        baseUrl,
        model: 'organization/served-model',
      });
      expect(completeSimpleMock.mock.calls[0][0]).toMatchObject({
        provider: 'openai',
        api: 'openai-completions',
        baseUrl,
        id: 'organization/served-model',
      });
      expect(completeSimpleMock.mock.calls[0][2]).toMatchObject({
        apiKey: 'sk-openai-local-proxy',
      });
    }
  );

  it('passes generation options through to completeSimple', async () => {
    await runPiAiOneShot('hello', 'system', makeConfig(), {
      temperature: 0.2,
      maxTokens: 1234,
    });

    expect(completeSimpleMock).toHaveBeenCalledTimes(1);
    expect(completeSimpleMock.mock.calls[0][2]).toMatchObject({
      apiKey: 'test-key',
      temperature: 0.2,
      maxTokens: 1234,
    });
  });
});
