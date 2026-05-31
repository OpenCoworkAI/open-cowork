import {
  UnauthorizedError,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const MCP_OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

type OpenExternal = (url: string) => Promise<void> | void;

type OAuthTransport = {
  close(): Promise<void>;
  finishAuth(authorizationCode: string): Promise<void>;
};

interface OAuthCallbackListener {
  close(): Promise<void>;
  redirectUrl: string;
  waitForCode(): Promise<string>;
}

interface OAuthProviderOptions {
  clientMetadataUrl?: string;
  openExternal: OpenExternal;
  redirectUrl?: string | URL;
}

interface ConnectWithOAuthOptions<TTransport extends OAuthTransport> {
  callbackTimeoutMs?: number;
  connect: (transport: TTransport) => Promise<void>;
  createTransport: (provider: OpenCoworkMcpOAuthProvider) => TTransport;
  provider: OpenCoworkMcpOAuthProvider;
}

function buildClientMetadata(redirectUrl: string): OAuthClientMetadata {
  return {
    client_name: 'Open Cowork MCP Connector',
    grant_types: ['authorization_code', 'refresh_token'],
    logo_uri: undefined,
    redirect_uris: [redirectUrl],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    tos_uri: undefined,
  };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function safeCloseTransport(transport: OAuthTransport): Promise<void> {
  try {
    await transport.close();
  } catch {
    // Best effort cleanup only.
  }
}

export class OpenCoworkMcpOAuthProvider implements OAuthClientProvider {
  clientMetadataUrl?: string;

  private _clientInformation?: OAuthClientInformationMixed;
  private _codeVerifier?: string;
  private _discoveryState?: OAuthDiscoveryState;
  private _metadata: OAuthClientMetadata;
  private _redirectUrl?: string | URL;
  private readonly _openExternal: OpenExternal;
  private _tokens?: OAuthTokens;

  constructor({ clientMetadataUrl, openExternal, redirectUrl }: OAuthProviderOptions) {
    this.clientMetadataUrl = clientMetadataUrl;
    this._openExternal = openExternal;
    this._redirectUrl = redirectUrl;
    this._metadata = buildClientMetadata(String(redirectUrl ?? 'http://127.0.0.1/callback'));
  }

  get redirectUrl(): string | URL | undefined {
    return this._redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this._metadata;
  }

  setRedirectUrl(redirectUrl: string | URL): void {
    const nextRedirectUrl = String(redirectUrl);
    const previousRedirectUrl =
      this._redirectUrl === undefined ? undefined : String(this._redirectUrl);

    if (previousRedirectUrl && previousRedirectUrl !== nextRedirectUrl) {
      // Dynamic client registrations are tied to redirect URIs.
      this._clientInformation = undefined;
    }

    this._redirectUrl = redirectUrl;
    this._metadata = buildClientMetadata(nextRedirectUrl);
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this._clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this._clientInformation = clientInformation;
  }

  tokens(): OAuthTokens | undefined {
    return this._tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this._tokens = tokens;
  }

  redirectToAuthorization(authorizationUrl: URL): void | Promise<void> {
    return this._openExternal(authorizationUrl.toString());
  }

  saveCodeVerifier(codeVerifier: string): void {
    this._codeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this._codeVerifier) {
      throw new Error('No OAuth code verifier saved');
    }

    return this._codeVerifier;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this._discoveryState = state;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this._discoveryState;
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all' || scope === 'client') {
      this._clientInformation = undefined;
    }
    if (scope === 'all' || scope === 'tokens') {
      this._tokens = undefined;
    }
    if (scope === 'all' || scope === 'verifier') {
      this._codeVerifier = undefined;
    }
    if (scope === 'all' || scope === 'discovery') {
      this._discoveryState = undefined;
    }
  }
}

export async function createOAuthCallbackListener(
  timeoutMs: number = MCP_OAUTH_CALLBACK_TIMEOUT_MS
): Promise<OAuthCallbackListener> {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  let closedPromise: Promise<void> | null = null;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      response.writeHead(404);
      response.end();
      return;
    }

    const address = server.address();
    const port = address && typeof address === 'object' ? (address as AddressInfo).port : 0;
    const parsedUrl = new URL(request.url ?? '', `http://127.0.0.1:${port}`);
    const authorizationCode = parsedUrl.searchParams.get('code');
    const error = parsedUrl.searchParams.get('error');
    const errorDescription = parsedUrl.searchParams.get('error_description');

    if (settled) {
      response.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('OAuth callback already handled.');
      return;
    }

    if (authorizationCode) {
      settled = true;
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(
        '<html><body><h1>Authorization complete</h1><p>You can return to Open Cowork now.</p><script>setTimeout(() => window.close(), 1200);</script></body></html>'
      );
      resolveCode(authorizationCode);
      void closeServer(server);
      return;
    }

    const failureMessage = error
      ? `OAuth authorization failed: ${errorDescription || error}`
      : 'OAuth authorization failed: missing authorization code';

    settled = true;
    response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<html><body><h1>Authorization failed</h1><p>${failureMessage}</p></body></html>`);
    rejectCode(new Error(failureMessage));
    void closeServer(server);
  });

  const close = async (): Promise<void> => {
    if (closedPromise) {
      return closedPromise;
    }

    closedPromise = (async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await closeServer(server);
    })();

    return closedPromise;
  };

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await close();
    throw new Error('Could not determine OAuth callback server address');
  }

  const redirectUrl = `http://127.0.0.1:${address.port}/callback`;

  timer = setTimeout(() => {
    if (settled) {
      return;
    }
    settled = true;
    rejectCode(
      new Error(
        `Timed out waiting for MCP OAuth authorization after ${Math.floor(timeoutMs / 1000)}s`
      )
    );
    void close();
  }, timeoutMs);

  return {
    close,
    redirectUrl,
    waitForCode: () => codePromise,
  };
}

export async function connectWithOAuthRetry<TTransport extends OAuthTransport>({
  callbackTimeoutMs = MCP_OAUTH_CALLBACK_TIMEOUT_MS,
  connect,
  createTransport,
  provider,
}: ConnectWithOAuthOptions<TTransport>): Promise<TTransport> {
  const listener = await createOAuthCallbackListener(callbackTimeoutMs);
  provider.setRedirectUrl(listener.redirectUrl);

  const initialTransport = createTransport(provider);
  let connectedTransport: TTransport | null = null;

  try {
    try {
      await connect(initialTransport);
      connectedTransport = initialTransport;
      return initialTransport;
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) {
        throw error;
      }
    }

    const authorizationCode = await listener.waitForCode();
    await initialTransport.finishAuth(authorizationCode);

    const authenticatedTransport = createTransport(provider);
    try {
      await connect(authenticatedTransport);
      connectedTransport = authenticatedTransport;
      return authenticatedTransport;
    } finally {
      if (connectedTransport !== authenticatedTransport) {
        await safeCloseTransport(authenticatedTransport);
      }
    }
  } finally {
    if (connectedTransport !== initialTransport) {
      await safeCloseTransport(initialTransport);
    }
    await listener.close();
  }
}
