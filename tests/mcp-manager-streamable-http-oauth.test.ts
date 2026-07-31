import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  createdStreamableTransports: [] as Array<{
    close: ReturnType<typeof vi.fn>;
    finishAuth: ReturnType<typeof vi.fn>;
    options: {
      authProvider?: {
        redirectToAuthorization(url: URL): unknown;
        redirectUrl?: string | URL;
        state(): string;
      };
    };
    url: URL;
  }>,
  latestAuthProvider: null as {
    redirectToAuthorization(url: URL): unknown;
    redirectUrl?: string | URL;
    state(): string;
  } | null,
  clientOptions: [] as unknown[],
  mockClientConnect: vi.fn(),
  mockClientListTools: vi.fn(),
  mockOpenExternal: vi.fn(),
}));

const MockUnauthorizedError = vi.hoisted(() => class MockUnauthorizedError extends Error {});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/open-cowork-test',
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
  shell: {
    openExternal: mockState.mockOpenExternal,
  },
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logCtx: vi.fn(),
  logCtxError: vi.fn(),
  logTiming: vi.fn(),
}));

vi.mock('../src/main/utils/shell-resolver', () => ({
  getDefaultShell: () => '/bin/bash',
}));

vi.mock('@modelcontextprotocol/client', () => ({
  UnauthorizedError: MockUnauthorizedError,
  Client: class MockClient {
    close = vi.fn().mockResolvedValue(undefined);
    connect = mockState.mockClientConnect;
    listTools = mockState.mockClientListTools;

    constructor(_clientInfo: unknown, options: unknown) {
      mockState.clientOptions.push(options);
    }
  },
  SSEClientTransport: class MockSSEClientTransport {},
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {
    close = vi.fn().mockResolvedValue(undefined);
    finishAuth = vi.fn().mockResolvedValue(undefined);
    options: {
      authProvider?: {
        redirectUrl?: string | URL;
        redirectToAuthorization(url: URL): unknown;
        state(): string;
      };
    };
    url: URL;

    constructor(
      url: URL,
      options: {
        authProvider?: {
          redirectUrl?: string | URL;
          redirectToAuthorization(url: URL): unknown;
          state(): string;
        };
      }
    ) {
      this.url = url;
      this.options = options;
      mockState.createdStreamableTransports.push(this);
    }
  },
}));

vi.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: class MockStdioClientTransport {},
}));

import { MCPManager } from '../src/main/mcp/mcp-manager';
import type { MCPServerConfig } from '../src/main/mcp/mcp-manager';

describe('MCPManager streamable HTTP OAuth', () => {
  beforeEach(() => {
    mockState.createdStreamableTransports.length = 0;
    mockState.clientOptions.length = 0;
    mockState.latestAuthProvider = null;

    mockState.mockOpenExternal.mockReset();
    mockState.mockOpenExternal.mockImplementation(async (authorizationUrl: string) => {
      if (!mockState.latestAuthProvider?.redirectUrl) {
        throw new Error('OAuth redirect URL was not prepared');
      }

      const state = new URL(authorizationUrl).searchParams.get('state');
      await fetch(
        `${String(mockState.latestAuthProvider.redirectUrl)}?code=oauth-from-browser&state=${encodeURIComponent(state ?? '')}`
      );
    });

    mockState.mockClientListTools.mockReset();
    mockState.mockClientListTools.mockResolvedValue({ tools: [] });

    let connectAttempt = 0;
    mockState.mockClientConnect.mockReset();
    mockState.mockClientConnect.mockImplementation(async (transport) => {
      connectAttempt += 1;

      if (connectAttempt === 1) {
        mockState.latestAuthProvider = transport.options.authProvider ?? null;
        const authorizationUrl = new URL('https://auth.example.com/authorize');
        const state = transport.options.authProvider?.state();
        if (state) {
          authorizationUrl.searchParams.set('state', state);
        }
        await transport.options.authProvider?.redirectToAuthorization(authorizationUrl);
        throw new MockUnauthorizedError('Authorization required');
      }
    });
  });

  it('opens the browser, completes OAuth, and reconnects the streamable HTTP client', async () => {
    const manager = new MCPManager();
    const config: MCPServerConfig = {
      enabled: true,
      id: 'oauth-server',
      name: 'OAuth MCP',
      type: 'streamable-http',
      url: 'https://mcp.example.com/v1/mcp',
    };

    await manager.initializeServers([config]);

    const openedAuthorizationUrl = new URL(mockState.mockOpenExternal.mock.calls[0][0]);
    expect(openedAuthorizationUrl.origin + openedAuthorizationUrl.pathname).toBe(
      'https://auth.example.com/authorize'
    );
    expect(openedAuthorizationUrl.searchParams.get('state')).toBeTruthy();
    expect(mockState.mockClientConnect).toHaveBeenCalledTimes(2);
    expect(mockState.createdStreamableTransports).toHaveLength(2);
    const callbackParams = mockState.createdStreamableTransports[0].finishAuth.mock.calls[0][0];
    expect(Object.fromEntries(callbackParams)).toMatchObject({ code: 'oauth-from-browser' });
    expect(mockState.createdStreamableTransports[0].close).toHaveBeenCalledTimes(1);
    expect(mockState.createdStreamableTransports[1].close).not.toHaveBeenCalled();
    expect(mockState.clientOptions[0]).toMatchObject({
      versionNegotiation: { mode: 'auto' },
    });

    expect(manager.getServerStatus()).toEqual([
      expect.objectContaining({
        connected: true,
        id: 'oauth-server',
        status: 'connected',
      }),
    ]);
  });
});
