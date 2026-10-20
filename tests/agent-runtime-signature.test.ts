import { describe, expect, it } from 'vitest';
import { buildAgentRuntimeSignature } from '../src/main/config/agent-runtime-signature';
import type { AppConfig, MemoryRuntimeConfig } from '../src/main/config/config-store';

const emptyMemoryRuntime: MemoryRuntimeConfig = {
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
};

const makeConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  provider: 'ollama',
  apiKey: '',
  baseUrl: 'http://localhost:11434/v1',
  customProtocol: 'openai',
  model: 'llama3.3',
  contextWindow: 32000,
  maxTokens: 8000,
  activeProfileKey: 'ollama',
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
  memoryRuntime: emptyMemoryRuntime,
  enableThinking: false,
  isConfigured: true,
  ...overrides,
});

describe('buildAgentRuntimeSignature', () => {
  it('changes when only contextWindow changes', () => {
    const original = buildAgentRuntimeSignature(makeConfig());
    const updated = buildAgentRuntimeSignature(makeConfig({ contextWindow: 64000 }));

    expect(updated).not.toBe(original);
  });

  it('changes when only maxTokens changes', () => {
    const original = buildAgentRuntimeSignature(makeConfig());
    const updated = buildAgentRuntimeSignature(makeConfig({ maxTokens: 16000 }));

    expect(updated).not.toBe(original);
  });

  it('stays the same when unrelated fields change', () => {
    const original = buildAgentRuntimeSignature(makeConfig());
    const updated = buildAgentRuntimeSignature(
      makeConfig({
        theme: 'dark',
        sandboxEnabled: true,
      })
    );

    expect(updated).toBe(original);
  });
});
