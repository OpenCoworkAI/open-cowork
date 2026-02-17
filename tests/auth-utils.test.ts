import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  importLocalAuthToken: vi.fn(),
}));

vi.mock('../src/main/auth/local-auth', () => ({
  importLocalAuthToken: mocks.importLocalAuthToken,
}));

import {
  buildOpenAICodexHeaders,
  isLikelyOAuthAccessToken,
  resolveOpenAICredentials,
  shouldUseAnthropicAuthToken,
} from '../src/main/config/auth-utils';

describe('auth-utils', () => {
  beforeEach(() => {
    mocks.importLocalAuthToken.mockReset();
  });

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

  it('resolves local codex oauth when openai key is empty', () => {
    mocks.importLocalAuthToken.mockReturnValue({
      provider: 'codex',
      token: 'oauth-local-token',
      path: '/tmp/auth.json',
      account: 'user_123456',
    });

    const resolved = resolveOpenAICredentials({
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
    });

    expect(resolved).toEqual({
      apiKey: 'oauth-local-token',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      accountId: 'user_123456',
      useCodexOAuth: true,
      source: 'localCodex',
    });
  });

  it('treats non-sk token on openai provider as codex oauth backend', () => {
    mocks.importLocalAuthToken.mockReturnValue({
      provider: 'codex',
      token: 'oauth-local-token',
      path: '/tmp/auth.json',
      account: 'acct_from_local',
    });

    const resolved = resolveOpenAICredentials({
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: 'oauth-token-from-import',
      baseUrl: 'https://api.openai.com/v1',
    });

    expect(resolved).toEqual({
      apiKey: 'oauth-token-from-import',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      accountId: 'acct_from_local',
      useCodexOAuth: true,
      source: 'apiKey',
    });
  });

  it('builds codex headers with optional account id', () => {
    expect(buildOpenAICodexHeaders()).toEqual({
      'User-Agent': 'CodexBar',
    });
    expect(buildOpenAICodexHeaders('acct_abc')).toEqual({
      'User-Agent': 'CodexBar',
      'ChatGPT-Account-Id': 'acct_abc',
    });
  });
});
