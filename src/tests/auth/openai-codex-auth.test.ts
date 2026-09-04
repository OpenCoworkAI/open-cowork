import { describe, expect, it, vi } from 'vitest';
import type { OAuthLoginCallbacks } from '@mariozechner/pi-ai';
import {
  OpenAICodexAuthError,
  OpenAICodexAuthService,
  runOpenAICodexLoginAction,
  runOpenAICodexLogoutAction,
} from '../../main/auth/openai-codex-auth';

const VALID_AUTHORIZATION_URL = (() => {
  const url = new URL('https://auth.openai.com/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', 'app_EMoamEEZ73f0CkXaXp7hrann');
  url.searchParams.set('redirect_uri', 'http://localhost:1455/auth/callback');
  url.searchParams.set('code_challenge', 'a'.repeat(43));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', 'b'.repeat(32));
  return url.toString();
})();

interface StorageOptions {
  initiallyAuthenticated?: boolean;
  failLoginPersistence?: boolean;
  failLogoutPersistence?: boolean;
}

function createStorage(
  login: (provider: string, callbacks: OAuthLoginCallbacks) => Promise<void>,
  options: StorageOptions = {}
) {
  let authenticated = options.initiallyAuthenticated ?? false;
  let errors: Error[] = [];
  return {
    storage: {
      reload: vi.fn(),
      drainErrors: vi.fn(() => {
        const drained = errors;
        errors = [];
        return drained;
      }),
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
        if (options.failLoginPersistence) {
          errors.push(new Error('disk full'));
        } else {
          authenticated = true;
        }
      }),
      logout: vi.fn(() => {
        if (options.failLogoutPersistence) {
          errors.push(new Error('file locked'));
        } else {
          authenticated = false;
        }
      }),
    },
  };
}

describe('OpenAICodexAuthService', () => {
  it('opens only the OpenAI authorization URL and persists through AuthStorage', async () => {
    const { storage } = createStorage(async (provider, callbacks) => {
      expect(provider).toBe('openai-codex');
      callbacks.onAuth({ url: VALID_AUTHORIZATION_URL });
    });
    const openExternal = vi.fn(async () => undefined);
    const service = new OpenAICodexAuthService(storage, 1_000);

    await expect(service.login(openExternal)).resolves.toEqual({
      authenticated: true,
      authenticating: false,
    });
    expect(openExternal).toHaveBeenCalledWith(VALID_AUTHORIZATION_URL);
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

  it('rejects an unexpected loopback redirect URI', async () => {
    const { storage } = createStorage(async (_provider, callbacks) => {
      const url = new URL(VALID_AUTHORIZATION_URL);
      url.searchParams.set('redirect_uri', 'https://example.test/callback');
      callbacks.onAuth({ url: url.toString() });
      await callbacks.onManualCodeInput?.();
    });
    const service = new OpenAICodexAuthService(storage, 1_000);

    await expect(service.login(vi.fn())).rejects.toMatchObject({
      code: 'invalid_authorization_url',
    });
  });

  it('rejects ambiguous duplicate OAuth parameters', async () => {
    const { storage } = createStorage(async (_provider, callbacks) => {
      callbacks.onAuth({ url: `${VALID_AUTHORIZATION_URL}&redirect_uri=https://example.test` });
      await callbacks.onManualCodeInput?.();
    });
    const service = new OpenAICodexAuthService(storage, 1_000);

    await expect(service.login(vi.fn())).rejects.toMatchObject({
      code: 'invalid_authorization_url',
    });
  });

  it('reports a login persistence failure instead of a false success', async () => {
    const { storage } = createStorage(
      async (_provider, callbacks) => callbacks.onAuth({ url: VALID_AUTHORIZATION_URL }),
      { failLoginPersistence: true }
    );
    const service = new OpenAICodexAuthService(storage, 1_000);

    await expect(service.login(vi.fn(async () => undefined))).rejects.toMatchObject({
      code: 'login_failed',
    });
    expect(service.getStatus().authenticated).toBe(false);
  });

  it('returns ok false from the login action when no credential was persisted', async () => {
    const { storage } = createStorage(
      async (_provider, callbacks) => callbacks.onAuth({ url: VALID_AUTHORIZATION_URL }),
      { failLoginPersistence: true }
    );
    const service = new OpenAICodexAuthService(storage, 1_000);

    await expect(runOpenAICodexLoginAction(service, vi.fn())).resolves.toEqual({
      ok: false,
      status: { authenticated: false, authenticating: false },
      error: 'login_failed',
    });
  });

  it('reports a logout persistence failure and keeps the authenticated status', async () => {
    const { storage } = createStorage(async () => undefined, {
      initiallyAuthenticated: true,
      failLogoutPersistence: true,
    });
    const service = new OpenAICodexAuthService(storage, 1_000);

    await expect(service.logout()).rejects.toMatchObject({ code: 'logout_failed' });
    expect(service.getStatus().authenticated).toBe(true);
  });

  it('returns ok false from the logout action when the credential remains stored', async () => {
    const { storage } = createStorage(async () => undefined, {
      initiallyAuthenticated: true,
      failLogoutPersistence: true,
    });
    const service = new OpenAICodexAuthService(storage, 1_000);

    await expect(runOpenAICodexLogoutAction(service)).resolves.toEqual({
      ok: false,
      status: { authenticated: true, authenticating: false },
      error: 'logout_failed',
    });
  });

  it('cancels an active callback wait and leaves no credential behind', async () => {
    const { storage } = createStorage(async (_provider, callbacks) => {
      callbacks.onAuth({ url: VALID_AUTHORIZATION_URL });
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

  it('accepts a manual authorization code when the loopback callback is unavailable', async () => {
    const { storage } = createStorage(async (_provider, callbacks) => {
      callbacks.onAuth({ url: VALID_AUTHORIZATION_URL });
      await expect(callbacks.onManualCodeInput?.()).resolves.toBe('manual-code#state');
    });
    const service = new OpenAICodexAuthService(storage, 1_000);
    const login = service.login(async () => undefined);

    await vi.waitFor(() => expect(service.getStatus().authenticating).toBe(true));
    expect(service.submitManualCode('  manual-code#state  ')).toMatchObject({
      authenticating: true,
    });
    await expect(login).resolves.toEqual({ authenticated: true, authenticating: false });
  });
});
