import { describe, expect, it } from 'vitest';

import {
  normalizeOllamaBaseUrl,
  getUnifiedUnsupportedCustomOpenAIBaseUrl,
  isOfficialOpenAIBaseUrl,
  isOllamaLegacyCustomOpenAIConfig,
  isLoopbackBaseUrl,
  isLikelyOAuthAccessToken,
  normalizeAnthropicBaseUrl,
  resolveOllamaCredentials,
  resolveOpenAICredentials,
  sanitizeOpenAIAccountId,
  shouldAllowEmptyAnthropicApiKey,
  shouldAllowEmptyOpenAIApiKey,
  shouldAllowEmptyOllamaApiKey,
  shouldAllowEmptyGeminiApiKey,
  shouldUseAnthropicAuthToken,
} from '../src/main/config/auth-utils';

describe('auth-utils', () => {
  it('detects oauth-style tokens', () => {
    expect(isLikelyOAuthAccessToken('oauth-access-token')).toBe(true);
    expect(isLikelyOAuthAccessToken('sk-ant-123')).toBe(false);
  });

  it('chooses auth token mode for anthropic oauth tokens', () => {
    expect(
      shouldUseAnthropicAuthToken({
        provider: 'anthropic',
        customProtocol: 'anthropic',
        apiKey: 'oauth-token',
      })
    ).toBe(true);
    expect(
      shouldUseAnthropicAuthToken({
        provider: 'anthropic',
        customProtocol: 'anthropic',
        apiKey: 'sk-ant-abc',
      })
    ).toBe(false);
    expect(
      shouldUseAnthropicAuthToken({
        provider: 'custom',
        customProtocol: 'anthropic',
        apiKey: 'custom-key-without-sk-prefix',
      })
    ).toBe(false);
    expect(
      shouldUseAnthropicAuthToken({
        provider: 'openrouter',
        customProtocol: 'anthropic',
        apiKey: 'sk-or-v1-abc',
      })
    ).toBe(true);
  });

  it('resolves openai credentials when api key is provided', () => {
    const resolved = resolveOpenAICredentials({
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: 'sk-test-123',
      baseUrl: 'https://api.openai.com/v1',
    });

    expect(resolved).toEqual({
      apiKey: 'sk-test-123',
      baseUrl: 'https://api.openai.com/v1',
    });
  });

  it('returns null when openai api key is empty', () => {
    const resolved = resolveOpenAICredentials({
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
    });

    expect(resolved).toBeNull();
  });

  it('injects a placeholder key for custom openai loopback gateway when api key is empty', () => {
    const resolved = resolveOpenAICredentials({
      provider: 'custom',
      customProtocol: 'openai',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8082/v1',
    });

    expect(resolved).toEqual({
      apiKey: 'sk-openai-local-proxy',
      baseUrl: 'http://127.0.0.1:8082/v1',
    });
  });

  it('sanitizes invalid OpenAI account id values', () => {
    expect(sanitizeOpenAIAccountId('user@example.com')).toBeUndefined();
    expect(sanitizeOpenAIAccountId('abc')).toBeUndefined();
    expect(sanitizeOpenAIAccountId('acct_123456')).toBe('acct_123456');
  });

  it('detects loopback gateway urls', () => {
    expect(isLoopbackBaseUrl('http://127.0.0.1:8082')).toBe(true);
    expect(isLoopbackBaseUrl('http://localhost:8082')).toBe(true);
    expect(isLoopbackBaseUrl('http://[::1]:8082')).toBe(true);
    expect(isLoopbackBaseUrl('http://0.0.0.0:8082')).toBe(true);
    expect(isLoopbackBaseUrl('https://api.example.com')).toBe(false);
  });

  it('normalizes anthropic base urls by removing a trailing /v1 segment', () => {
    expect(normalizeAnthropicBaseUrl('https://api.duckcoding.ai/v1')).toBe('https://api.duckcoding.ai');
    expect(normalizeAnthropicBaseUrl('https://proxy.example.com/anthropic/v1/')).toBe('https://proxy.example.com/anthropic');
    expect(normalizeAnthropicBaseUrl('https://proxy.example.com/anthropic')).toBe('https://proxy.example.com/anthropic');
  });

  it('detects official openai base urls', () => {
    expect(isOfficialOpenAIBaseUrl('https://api.openai.com/v1')).toBe(true);
    expect(isOfficialOpenAIBaseUrl('https://chatgpt.com/backend-api/codex')).toBe(true);
    expect(isOfficialOpenAIBaseUrl('https://api.duckcoding.ai/v1')).toBe(false);
    expect(isOfficialOpenAIBaseUrl('https://proxy.example.com/openai')).toBe(false);
  });

  it('flags unsupported custom/openai + official openai base in unified sdk path', () => {
    expect(
      getUnifiedUnsupportedCustomOpenAIBaseUrl({
        provider: 'custom',
        customProtocol: 'openai',
        apiKey: 'sk-test-123',
        baseUrl: 'https://api.openai.com/v1',
      })
    ).toBe('https://api.openai.com/v1');

    expect(
      getUnifiedUnsupportedCustomOpenAIBaseUrl({
        provider: 'custom',
        customProtocol: 'openai',
        apiKey: 'sk-test-123',
        baseUrl: 'https://api.duckcoding.ai/v1',
      })
    ).toBeNull();
  });

  it('allows empty anthropic api key only for custom anthropic loopback gateway', () => {
    expect(
      shouldAllowEmptyAnthropicApiKey({
        provider: 'custom',
        customProtocol: 'anthropic',
        baseUrl: 'http://[::1]:8082',
      })
    ).toBe(true);

    expect(
      shouldAllowEmptyAnthropicApiKey({
        provider: 'custom',
        customProtocol: 'anthropic',
        baseUrl: 'https://proxy.example.com',
      })
    ).toBe(false);

    expect(
      shouldAllowEmptyAnthropicApiKey({
        provider: 'anthropic',
        customProtocol: 'anthropic',
        baseUrl: 'http://127.0.0.1:8082',
      })
    ).toBe(false);
  });

  it('allows empty gemini api key only for custom gemini loopback gateway', () => {
    expect(
      shouldAllowEmptyGeminiApiKey({
        provider: 'custom',
        customProtocol: 'gemini',
        baseUrl: 'http://127.0.0.1:8082',
      })
    ).toBe(true);

    expect(
      shouldAllowEmptyGeminiApiKey({
        provider: 'custom',
        customProtocol: 'gemini',
        baseUrl: 'https://proxy.example.com',
      })
    ).toBe(false);

    expect(
      shouldAllowEmptyGeminiApiKey({
        provider: 'gemini',
        customProtocol: 'gemini',
        baseUrl: 'http://127.0.0.1:8082',
      })
    ).toBe(false);
  });

  it('allows empty openai api key only for custom openai loopback gateway', () => {
    expect(
      shouldAllowEmptyOpenAIApiKey({
        provider: 'custom',
        customProtocol: 'openai',
        baseUrl: 'http://127.0.0.1:8082',
      })
    ).toBe(true);

    expect(
      shouldAllowEmptyOpenAIApiKey({
        provider: 'custom',
        customProtocol: 'openai',
        baseUrl: 'https://proxy.example.com',
      })
    ).toBe(false);

    expect(
      shouldAllowEmptyOpenAIApiKey({
        provider: 'openai',
        customProtocol: 'openai',
        baseUrl: 'http://127.0.0.1:8082',
      })
    ).toBe(false);
  });

  it('allows empty ollama api key for any configured ollama base url', () => {
    expect(
      shouldAllowEmptyOllamaApiKey({
        provider: 'ollama',
        customProtocol: 'openai',
        baseUrl: 'http://localhost:11434/v1',
      })
    ).toBe(true);

    expect(
      shouldAllowEmptyOllamaApiKey({
        provider: 'ollama',
        customProtocol: 'openai',
        baseUrl: 'https://ollama.example.internal/proxy/v1',
      })
    ).toBe(true);

    expect(
      shouldAllowEmptyOllamaApiKey({
        provider: 'custom',
        customProtocol: 'openai',
        baseUrl: 'https://ollama.example.internal/proxy/v1',
      })
    ).toBe(false);
  });

  it('normalizes ollama base urls to an openai-compatible /v1 endpoint', () => {
    expect(normalizeOllamaBaseUrl('http://localhost:11434')).toBe('http://localhost:11434/v1');
    expect(normalizeOllamaBaseUrl('http://localhost:11434/')).toBe('http://localhost:11434/v1');
    expect(normalizeOllamaBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
    expect(normalizeOllamaBaseUrl('http://localhost:11434/api')).toBe('http://localhost:11434/v1');
    expect(normalizeOllamaBaseUrl('https://ollama.com/api')).toBe('https://ollama.com/v1');
    expect(normalizeOllamaBaseUrl('https://ollama.example.internal/proxy/api')).toBe('https://ollama.example.internal/proxy/v1');
    expect(normalizeOllamaBaseUrl('https://ollama.example.internal/proxy/api/v1')).toBe('https://ollama.example.internal/proxy/v1');
    expect(normalizeOllamaBaseUrl('https://ollama.example.internal/proxy')).toBe('https://ollama.example.internal/proxy/v1');
    expect(normalizeOllamaBaseUrl(undefined)).toBeUndefined();
  });

  it('injects an internal placeholder key for ollama when api key is empty', () => {
    const resolved = resolveOllamaCredentials({
      provider: 'ollama',
      customProtocol: 'openai',
      apiKey: '',
      baseUrl: 'http://localhost:11434/api',
    });

    expect(resolved).toEqual({
      apiKey: 'sk-ollama-local-proxy',
      baseUrl: 'http://localhost:11434/v1',
    });
  });

  it('detects legacy custom openai localhost ollama configs conservatively', () => {
    expect(
      isOllamaLegacyCustomOpenAIConfig({
        provider: 'custom',
        customProtocol: 'openai',
        baseUrl: 'http://localhost:11434/v1',
      })
    ).toBe(true);

    expect(
      isOllamaLegacyCustomOpenAIConfig({
        provider: 'custom',
        customProtocol: 'openai',
        baseUrl: 'http://localhost:11434',
      })
    ).toBe(true);

    expect(
      isOllamaLegacyCustomOpenAIConfig({
        provider: 'custom',
        customProtocol: 'openai',
        baseUrl: 'https://ollama.example.internal/v1',
      })
    ).toBe(false);

    expect(
      isOllamaLegacyCustomOpenAIConfig({
        provider: 'custom',
        customProtocol: 'openai',
        baseUrl: 'http://localhost:8080/v1',
      })
    ).toBe(false);
  });
});
