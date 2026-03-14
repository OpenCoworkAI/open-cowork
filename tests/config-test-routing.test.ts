import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiTestResult } from '../src/renderer/types';
import type { AppConfig } from '../src/main/config/config-store';

const mocks = vi.hoisted(() => ({
  probeWithClaudeSdk: vi.fn(),
  testOllamaConnection: vi.fn(),
  testApiConnection: vi.fn(),
}));

vi.mock('../src/main/claude/claude-sdk-one-shot', () => ({
  probeWithClaudeSdk: mocks.probeWithClaudeSdk,
}));

vi.mock('../src/main/config/ollama-api', () => ({
  testOllamaConnection: mocks.testOllamaConnection,
}));

vi.mock('../src/main/config/api-tester', () => ({
  testApiConnection: mocks.testApiConnection,
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
    mocks.testOllamaConnection.mockReset();
    mocks.testApiConnection.mockReset();
  });

  it('routes config.test to Claude SDK probe', async () => {
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
    expect(mocks.testOllamaConnection).not.toHaveBeenCalled();
  });

  it('routes ollama config.test to the dedicated ollama probe', async () => {
    const expected: ApiTestResult = { ok: true, latencyMs: 9 };
    mocks.testOllamaConnection.mockResolvedValue(expected);

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
    expect(mocks.testOllamaConnection).toHaveBeenCalledTimes(1);
    expect(mocks.probeWithClaudeSdk).not.toHaveBeenCalled();
  });

  it('routes gemini config.test through Claude SDK probe', async () => {
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

  it('routes live config tests through direct api tester for non-ollama providers', async () => {
    const expected: ApiTestResult = { ok: true, latencyMs: 22 };
    mocks.testApiConnection.mockResolvedValue(expected);

    const result = await runConfigApiTest(
      {
        provider: 'custom',
        customProtocol: 'anthropic',
        apiKey: 'sk-test',
        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
        model: 'glm-5',
        useLiveRequest: true,
      },
      createConfig()
    );

    expect(result).toEqual(expected);
    expect(mocks.testApiConnection).toHaveBeenCalledTimes(1);
    expect(mocks.probeWithClaudeSdk).not.toHaveBeenCalled();
    expect(mocks.testOllamaConnection).not.toHaveBeenCalled();
  });

  it('falls back to probe for gemini live tests until direct live support exists', async () => {
    const expected: ApiTestResult = { ok: true, latencyMs: 14 };
    mocks.probeWithClaudeSdk.mockResolvedValue(expected);

    const result = await runConfigApiTest(
      {
        provider: 'gemini',
        customProtocol: 'gemini',
        apiKey: 'AIza-test',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini/gemini-2.5-flash',
        useLiveRequest: true,
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
    expect(mocks.testApiConnection).not.toHaveBeenCalled();
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
