import { describe, it, expect, afterEach } from 'vitest';
import { buildClaudeEnv, getClaudeEnvOverrides } from '../src/main/claude/claude-env';
import type { AppConfig } from '../src/main/config/config-store';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

afterEach(() => {
  resetEnv();
});

describe('buildClaudeEnv', () => {
  it('overrides shell env with config-derived env vars', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_BASE_URL = 'https://example.com';
    const shellEnv = { ANTHROPIC_API_KEY: 'old-key', PATH: '/bin' };
    const env = buildClaudeEnv(shellEnv);
    expect(env.ANTHROPIC_API_KEY).toBe('test-key');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.com');
    expect(env.PATH).toBe('/bin');
  });

  it('keeps shell env when config vars are absent', () => {
    const shellEnv = { ANTHROPIC_API_KEY: 'old-key', PATH: '/bin' };
    const env = buildClaudeEnv(shellEnv);
    expect(env.ANTHROPIC_API_KEY).toBe('old-key');
    expect(env.PATH).toBe('/bin');
  });
});

describe('getClaudeEnvOverrides', () => {
  const baseConfig: AppConfig = {
    provider: 'anthropic',
    apiKey: 'test-key',
    baseUrl: 'https://api.anthropic.com',
    customProtocol: 'anthropic',
    model: 'claude-sonnet-4-5',
    openaiMode: 'responses',
    claudeCodePath: '',
    defaultWorkdir: '',
    enableDevLogs: true,
    sandboxEnabled: false,
    isConfigured: true,
  };

  it('maps anthropic provider to ANTHROPIC_API_KEY', () => {
    const env = getClaudeEnvOverrides(baseConfig);
    expect(env.ANTHROPIC_API_KEY).toBe('test-key');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it('maps openrouter provider to ANTHROPIC_AUTH_TOKEN', () => {
    const env = getClaudeEnvOverrides({
      ...baseConfig,
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api',
    });
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('test-key');
  });

  it('maps custom openai protocol to OPENAI_API_KEY', () => {
    const env = getClaudeEnvOverrides({
      ...baseConfig,
      provider: 'custom',
      customProtocol: 'openai',
      baseUrl: 'https://example.com/openai',
    });
    expect(env.OPENAI_API_KEY).toBe('test-key');
  });
});
