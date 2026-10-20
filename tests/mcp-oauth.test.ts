import { UnauthorizedError } from '@modelcontextprotocol/client';
import { describe, expect, it, vi } from 'vitest';

import {
  connectWithOAuthRetry,
  createOAuthCallbackListener,
  OpenCoworkMcpOAuthProvider,
} from '../src/main/mcp/mcp-oauth';

describe('createOAuthCallbackListener', () => {
  it('captures authorization codes from the loopback callback', async () => {
    const listener = await createOAuthCallbackListener(1000);
    const callbackPromise = listener.waitForCallback();

    const response = await fetch(
      `${listener.redirectUrl}?code=test-auth-code&state=test-state&iss=https%3A%2F%2Fauth.example.com`
    );

    expect(response.status).toBe(200);
    expect(Object.fromEntries(await callbackPromise)).toEqual({
      code: 'test-auth-code',
      iss: 'https://auth.example.com',
      state: 'test-state',
    });

    await listener.close();
  });

  it('returns callback parameters without reflecting untrusted OAuth errors', async () => {
    const listener = await createOAuthCallbackListener(1000);
    const callbackPromise = listener.waitForCallback();

    const response = await fetch(
      `${listener.redirectUrl}?error=access_denied&error_description=%3Cscript%3Ebad()%3C%2Fscript%3E&state=test-state`
    );

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('<script>bad()</script>');
    expect(Object.fromEntries(await callbackPromise)).toMatchObject({
      error: 'access_denied',
      state: 'test-state',
    });

    await listener.close();
  });
});

describe('OpenCoworkMcpOAuthProvider', () => {
  it('updates redirect URIs, keeps tokens, and clears client registration when the port changes', async () => {
    const openExternal = vi.fn();
    const provider = new OpenCoworkMcpOAuthProvider({ openExternal });

    provider.setRedirectUrl('http://127.0.0.1:3000/callback');
    provider.saveClientInformation({
      client_id: 'client-1',
      issuer: 'https://auth.example.com',
    });
    provider.saveTokens({
      access_token: 'token-1',
      issuer: 'https://auth.example.com',
      token_type: 'Bearer',
    });
    provider.saveCodeVerifier('pkce-verifier');
    provider.setRedirectUrl('http://127.0.0.1:4000/callback');

    expect(provider.clientMetadata.redirect_uris).toEqual(['http://127.0.0.1:4000/callback']);
    expect(provider.clientMetadata.application_type).toBe('native');
    expect(provider.clientInformation()).toBeUndefined();
    expect(provider.tokens()).toMatchObject({
      access_token: 'token-1',
      issuer: 'https://auth.example.com',
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
      openExternal: vi.fn(async (authorizationUrl: string) => {
        const state = new URL(authorizationUrl).searchParams.get('state');
        await fetch(
          `${String(provider.redirectUrl)}?code=oauth-code&state=${encodeURIComponent(
            state ?? ''
          )}&iss=https%3A%2F%2Fauth.example.com`
        );
      }),
    });

    const connectedTransport = await connectWithOAuthRetry({
      connect: async () => {
        connectCount += 1;
        if (connectCount === 1) {
          const authorizationUrl = new URL('https://auth.example.com/authorize');
          authorizationUrl.searchParams.set('state', provider.state());
          await provider.redirectToAuthorization(authorizationUrl);
          throw new UnauthorizedError('Authorization required');
        }
      },
      createTransport: () => transports[createCount++],
      provider,
    });

    expect(connectedTransport).toBe(transports[1]);
    const callbackParams = transports[0].finishAuth.mock.calls[0][0] as URLSearchParams;
    expect(Object.fromEntries(callbackParams)).toMatchObject({
      code: 'oauth-code',
      iss: 'https://auth.example.com',
    });
    expect(transports[0].close).toHaveBeenCalledTimes(1);
    expect(transports[1].close).not.toHaveBeenCalled();
  });

  it('rejects a callback whose state does not match the authorization request', async () => {
    const transport = {
      close: vi.fn().mockResolvedValue(undefined),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    };
    const provider = new OpenCoworkMcpOAuthProvider({
      openExternal: vi.fn(async () => {
        await fetch(`${String(provider.redirectUrl)}?code=oauth-code&state=wrong-state`);
      }),
    });

    await expect(
      connectWithOAuthRetry({
        connect: async () => {
          const authorizationUrl = new URL('https://auth.example.com/authorize');
          authorizationUrl.searchParams.set('state', provider.state());
          await provider.redirectToAuthorization(authorizationUrl);
          throw new UnauthorizedError('Authorization required');
        },
        createTransport: () => transport,
        provider,
      })
    ).rejects.toThrow('invalid state parameter');

    expect(transport.finishAuth).not.toHaveBeenCalled();
  });
});
