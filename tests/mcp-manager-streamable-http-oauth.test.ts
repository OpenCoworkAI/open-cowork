import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  createdStreamableTransports: [] as Array<{
    close: ReturnType<typeof vi.fn>;
    finishAuth: ReturnType<typeof vi.fn>;
    options: {
      authProvider?: { redirectToAuthorization(url: URL): unknown; redirectUrl?: string | URL };
    };
    url: URL;
  }>,
  latestAuthProvider: null as {
    redirectToAuthorization(url: URL): unknown;
    redirectUrl?: string | URL;
  } | null,
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

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  UnauthorizedError: MockUnauthorizedError,
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    close = vi.fn().mockResolvedValue(undefined);
    connect = mockState.mockClientConnect;
    listTools = mockState.mockClientListTools;
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockStdioClientTransport {},
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class MockSSEClientTransport {},
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {
    close = vi.fn().mockResolvedValue(undefined);
    finishAuth = vi.fn().mockResolvedValue(undefined);
    options: {
      authProvider?: { redirectUrl?: string | URL; redirectToAuthorization(url: URL): unknown };
    };
    url: URL;

    constructor(
      url: URL,
      options: {
        authProvider?: { redirectUrl?: string | URL; redirectToAuthorization(url: URL): unknown };
      }
    ) {
      this.url = url;
      this.options = options;
      mockState.createdStreamableTransports.push(this);
    }
  },
}));

import { MCPManager } from '../src/main/mcp/mcp-manager';
import type { MCPServerConfig } from '../src/main/mcp/mcp-manager';

describe('MCPManager streamable HTTP OAuth', () => {
  beforeEach(() => {
    mockState.createdStreamableTransports.length = 0;
    mockState.latestAuthProvider = null;

    mockState.mockOpenExternal.mockReset();
    mockState.mockOpenExternal.mockImplementation(async () => {
      if (!mockState.latestAuthProvider?.redirectUrl) {
        throw new Error('OAuth redirect URL was not prepared');
      }

      await fetch(`${String(mockState.latestAuthProvider.redirectUrl)}?code=oauth-from-browser`);
    });

    mockState.mockClientListTools.mockReset();
    mockState.mockClientListTools.mockResolvedValue({ tools: [] });

    let connectAttempt = 0;
    mockState.mockClientConnect.mockReset();
    mockState.mockClientConnect.mockImplementation(async (transport) => {
      connectAttempt += 1;

      if (connectAttempt === 1) {
        mockState.latestAuthProvider = transport.options.authProvider ?? null;
        await transport.options.authProvider?.redirectToAuthorization(
          new URL('https://auth.example.com/authorize')
        );
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

    expect(mockState.mockOpenExternal).toHaveBeenCalledWith('https://auth.example.com/authorize');
    expect(mockState.mockClientConnect).toHaveBeenCalledTimes(2);
    expect(mockState.createdStreamableTransports).toHaveLength(2);
    expect(mockState.createdStreamableTransports[0].finishAuth).toHaveBeenCalledWith(
      'oauth-from-browser'
    );
    expect(mockState.createdStreamableTransports[0].close).toHaveBeenCalledTimes(1);
    expect(mockState.createdStreamableTransports[1].close).not.toHaveBeenCalled();

    expect(manager.getServerStatus()).toEqual([
      expect.objectContaining({
        connected: true,
        id: 'oauth-server',
        status: 'connected',
      }),
    ]);
  });
});
