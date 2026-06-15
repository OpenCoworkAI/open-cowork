import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runPiAiOneShotMock = vi.hoisted(() => vi.fn());

vi.mock('../../main/claude/claude-sdk-one-shot', () => ({
  runPiAiOneShot: runPiAiOneShotMock,
}));

import type { AppConfig } from '../../main/config/config-store';
import { MemoryLLMClient } from '../../main/memory/memory-llm-client';

function makeConfig(timeoutMs: number): AppConfig {
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
    claudeCodePath: '',
    defaultWorkdir: '',
    globalSkillsPath: '',
    enableDevLogs: false,
    theme: 'claude',
    appearance: 'light',
    sandboxEnabled: false,
    memoryEnabled: true,
    memoryRuntime: {
      llm: {
        inheritFromActive: true,
        apiKey: '',
        baseUrl: '',
        model: '',
        timeoutMs,
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

describe('MemoryLLMClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runPiAiOneShotMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts one-shot completions with the configured memory LLM timeout', async () => {
    let signal: AbortSignal | undefined;
    runPiAiOneShotMock.mockImplementation((_prompt, _systemPrompt, _config, options) => {
      signal = options?.signal;
      return new Promise(() => undefined);
    });

    const client = new MemoryLLMClient(() => makeConfig(5000));
    const completion = client
      .complete({
        systemPrompt: 'memory system',
        userPrompt: 'memory user',
      })
      .then(
        () => null,
        (error: unknown) => error as Error
      );

    await vi.advanceTimersByTimeAsync(4999);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    const error = await completion;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Memory LLM request timed out after 5000ms');
  });
});
