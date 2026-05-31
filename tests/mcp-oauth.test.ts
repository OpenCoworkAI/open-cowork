import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { describe, expect, it, vi } from 'vitest';

import {
  connectWithOAuthRetry,
  createOAuthCallbackListener,
  OpenCoworkMcpOAuthProvider,
} from '../src/main/mcp/mcp-oauth';

describe('createOAuthCallbackListener', () => {
  it('captures authorization codes from the loopback callback', async () => {
    const listener = await createOAuthCallbackListener(1000);
    const codePromise = listener.waitForCode();

    const response = await fetch(`${listener.redirectUrl}?code=test-auth-code`);

    expect(response.status).toBe(200);
    expect(await codePromise).toBe('test-auth-code');

    await listener.close();
  });

  it('rejects when the OAuth callback returns an error', async () => {
    const listener = await createOAuthCallbackListener(1000);
    const codePromise = listener.waitForCode();
    codePromise.catch(() => {});

    const response = await fetch(
      `${listener.redirectUrl}?error=access_denied&error_description=user%20cancelled`
    );

    expect(response.status).toBe(400);
    await expect(codePromise).rejects.toThrow('OAuth authorization failed: user cancelled');

    await listener.close();
  });
});

describe('OpenCoworkMcpOAuthProvider', () => {
  it('updates redirect URIs, keeps tokens, and clears client registration when the port changes', async () => {
    const openExternal = vi.fn();
    const provider = new OpenCoworkMcpOAuthProvider({ openExternal });

    provider.setRedirectUrl('http://127.0.0.1:3000/callback');
    provider.saveClientInformation({ client_id: 'client-1' });
    provider.saveTokens({ access_token: 'token-1', token_type: 'Bearer' });
    provider.saveCodeVerifier('pkce-verifier');
    provider.setRedirectUrl('http://127.0.0.1:4000/callback');

    expect(provider.clientMetadata.redirect_uris).toEqual(['http://127.0.0.1:4000/callback']);
    expect(provider.clientInformation()).toBeUndefined();
    expect(provider.tokens()).toMatchObject({
      access_token: 'token-1',
      token_type: 'Bearer',
    });
    expect(provider.codeVerifier()).toBe('pkce-verifier');

    await provider.redirectToAuthorization(new URL('https://auth.example.com/authorize'));
    expect(openExternal).toHaveBeenCalledWith('https://auth.example.com/authorize');
  });
});

describe('connectWithOAuthRetry', () => {
  it('finishes the auth flow and reconnects with a new transport after UnauthorizedError', async () => {
    const transports = [
      {
        close: vi.fn().mockResolvedValue(undefined),
        finishAuth: vi.fn().mockResolvedValue(undefined),
        id: 'initial',
      },
      {
        close: vi.fn().mockResolvedValue(undefined),
        finishAuth: vi.fn().mockResolvedValue(undefined),
        id: 'authenticated',
      },
    ];
    let createCount = 0;
    let connectCount = 0;

    const provider = new OpenCoworkMcpOAuthProvider({
      openExternal: vi.fn(async () => {
        await fetch(`${String(provider.redirectUrl)}?code=oauth-code`);
      }),
    });

    const connectedTransport = await connectWithOAuthRetry({
      connect: async () => {
        connectCount += 1;
        if (connectCount === 1) {
          await provider.redirectToAuthorization(new URL('https://auth.example.com/authorize'));
          throw new UnauthorizedError('Authorization required');
        }
      },
      createTransport: () => transports[createCount++],
      provider,
    });

    expect(connectedTransport).toBe(transports[1]);
    expect(transports[0].finishAuth).toHaveBeenCalledWith('oauth-code');
    expect(transports[0].close).toHaveBeenCalledTimes(1);
    expect(transports[1].close).not.toHaveBeenCalled();
  });
});
