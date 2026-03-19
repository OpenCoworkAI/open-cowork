import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiTestResult } from '../src/renderer/types';
import type { AppConfig } from '../src/main/config/config-store';

const mocks = vi.hoisted(() => ({
  probeWithClaudeSdk: vi.fn(),
}));

vi.mock('../src/main/claude/claude-sdk-one-shot', () => ({
  probeWithClaudeSdk: mocks.probeWithClaudeSdk,
}));

import { runConfigApiTest } from '../src/main/config/config-test-routing';

function createConfig(): AppConfig {
  return {
    provider: 'openai',
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    customProtocol: 'openai',
    model: 'gpt-4.1',
    activeProfileKey: 'openai',
    profiles: {},
    activeConfigSetId: 'default',
    configSets: [],
    claudeCodePath: '',
    defaultWorkdir: '',
    globalSkillsPath: '',
    enableDevLogs: true,
    sandboxEnabled: false,
    enableThinking: false,
    isConfigured: true,
  };
}

describe('runConfigApiTest', () => {
  beforeEach(() => {
    mocks.probeWithClaudeSdk.mockReset();
  });

  it('routes all providers through probeWithClaudeSdk', async () => {
    const expected: ApiTestResult = { ok: true, latencyMs: 12 };
    mocks.probeWithClaudeSdk.mockResolvedValue(expected);

    const result = await runConfigApiTest(
      {
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4.1',
      },
      createConfig()
    );

    expect(result).toEqual(expected);
    expect(mocks.probeWithClaudeSdk).toHaveBeenCalledTimes(1);
  });

  it('routes ollama through probeWithClaudeSdk', async () => {
    const expected: ApiTestResult = { ok: true, latencyMs: 9 };
    mocks.probeWithClaudeSdk.mockResolvedValue(expected);

    const result = await runConfigApiTest(
      {
        provider: 'ollama',
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'qwen3.5:0.8b',
      },
      {
        ...createConfig(),
        provider: 'ollama',
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'qwen3.5:0.8b',
        activeProfileKey: 'ollama',
      }
    );

    expect(result).toEqual(expected);
    expect(mocks.probeWithClaudeSdk).toHaveBeenCalledTimes(1);
  });

  it('routes gemini through probeWithClaudeSdk', async () => {
    const expected: ApiTestResult = { ok: true, latencyMs: 18 };
    mocks.probeWithClaudeSdk.mockResolvedValue(expected);

    const result = await runConfigApiTest(
      {
        provider: 'gemini',
        customProtocol: 'gemini',
        apiKey: 'AIza-test',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini/gemini-2.5-flash',
      },
      {
        ...createConfig(),
        provider: 'gemini',
        customProtocol: 'gemini',
        activeProfileKey: 'gemini',
        apiKey: 'AIza-test',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini/gemini-2.5-flash',
      }
    );

    expect(result).toEqual(expected);
    expect(mocks.probeWithClaudeSdk).toHaveBeenCalledTimes(1);
  });

  it('returns failure when Claude Code executable is not found', async () => {
    const probeFailure: ApiTestResult = {
      ok: false,
      errorType: 'unknown',
      details: 'Claude Code executable not found. Please install @anthropic-ai/claude-code',
    };
    mocks.probeWithClaudeSdk.mockResolvedValue(probeFailure);

    const result = await runConfigApiTest(
      {
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4.1',
      },
      createConfig()
    );

    expect(result).toEqual(probeFailure);
    expect(mocks.probeWithClaudeSdk).toHaveBeenCalledTimes(1);
  });

  it('returns failure on protocol-level mismatch', async () => {
    const probeFailure: ApiTestResult = {
      ok: false,
      errorType: 'unknown',
      details: 'probe_response_mismatch:pong',
    };
    mocks.probeWithClaudeSdk.mockResolvedValue(probeFailure);

    const result = await runConfigApiTest(
      {
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4.1',
      },
      createConfig()
    );

    expect(result).toEqual(probeFailure);
    expect(mocks.probeWithClaudeSdk).toHaveBeenCalledTimes(1);
  });

  it('returns unauthorized without retry for explicit key', async () => {
    const probeFailure: ApiTestResult = {
      ok: false,
      errorType: 'unauthorized',
      details: '401 Unauthorized',
    };
    mocks.probeWithClaudeSdk.mockResolvedValue(probeFailure);

    const result = await runConfigApiTest(
      {
        provider: 'openai',
        apiKey: 'sk-explicit',
        model: 'gpt-4.1',
      },
      createConfig()
    );

    expect(result).toEqual(probeFailure);
    expect(mocks.probeWithClaudeSdk).toHaveBeenCalledTimes(1);
  });
});
