import { describe, expect, it, vi } from 'vitest';
import type { OAuthLoginCallbacks } from '@mariozechner/pi-ai';
import { OpenAICodexAuthError, OpenAICodexAuthService } from '../../main/auth/openai-codex-auth';

function createStorage(login: (provider: string, callbacks: OAuthLoginCallbacks) => Promise<void>) {
  let authenticated = false;
  return {
    storage: {
      reload: vi.fn(),
      get: vi.fn(() =>
        authenticated
          ? {
              type: 'oauth' as const,
              access: 'redacted',
              refresh: 'redacted',
              expires: Date.now() + 60_000,
            }
          : undefined
      ),
      hasAuth: vi.fn(() => authenticated),
      login: vi.fn(async (provider: string, callbacks: OAuthLoginCallbacks) => {
        await login(provider, callbacks);
        authenticated = true;
      }),
      logout: vi.fn(() => {
        authenticated = false;
      }),
    },
  };
}

describe('OpenAICodexAuthService', () => {
  it('opens only the OpenAI authorization URL and persists through AuthStorage', async () => {
    const { storage } = createStorage(async (provider, callbacks) => {
      expect(provider).toBe('openai-codex');
      callbacks.onAuth({ url: 'https://auth.openai.com/oauth/authorize?state=test' });
    });
    const openExternal = vi.fn(async () => undefined);
    const service = new OpenAICodexAuthService(storage, 1_000);

    await expect(service.login(openExternal)).resolves.toEqual({
      authenticated: true,
      authenticating: false,
    });
    expect(openExternal).toHaveBeenCalledWith('https://auth.openai.com/oauth/authorize?state=test');
    expect(service.getStatus().authenticated).toBe(true);
  });

  it('rejects an unexpected authorization host', async () => {
    const { storage } = createStorage(async (_provider, callbacks) => {
      callbacks.onAuth({ url: 'https://example.test/oauth/authorize' });
      await callbacks.onManualCodeInput?.();
    });
    const service = new OpenAICodexAuthService(storage, 1_000);

    await expect(service.login(vi.fn())).rejects.toMatchObject({
      code: 'invalid_authorization_url',
    });
  });

  it('cancels an active callback wait and leaves no credential behind', async () => {
    const { storage } = createStorage(async (_provider, callbacks) => {
      callbacks.onAuth({ url: 'https://auth.openai.com/oauth/authorize?state=test' });
      await callbacks.onManualCodeInput?.();
    });
    const service = new OpenAICodexAuthService(storage, 1_000);
    const login = service.login(async () => undefined);

    await vi.waitFor(() => expect(service.getStatus().authenticating).toBe(true));
    await expect(service.cancelLogin()).resolves.toEqual({
      authenticated: false,
      authenticating: false,
    });
    await expect(login).rejects.toBeInstanceOf(OpenAICodexAuthError);
    expect(service.getStatus()).toEqual({ authenticated: false, authenticating: false });
  });
});
