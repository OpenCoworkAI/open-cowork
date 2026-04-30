/**
 * Tests for MCPManager connection timeout and status tracking.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock electron
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/open-cowork-test',
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

// Mock logger to suppress output during tests
vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logCtx: vi.fn(),
  logCtxError: vi.fn(),
  logTiming: vi.fn(),
}));

// Mock shell-resolver
vi.mock('../../main/utils/shell-resolver', () => ({
  getDefaultShell: () => '/bin/bash',
}));

import { MCPManager } from '../../main/mcp/mcp-manager';
import type { MCPServerConfig } from '../../main/mcp/mcp-manager';

type TestMCPClient = {
  listTools?: () => Promise<{
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  }>;
  callTool?: (input: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
};

type TestManagerInternals = {
  clients: Map<string, TestMCPClient>;
  tools: Map<string, unknown>;
  serverConfigs: Map<string, MCPServerConfig>;
};

function asTestManager(manager: MCPManager): TestManagerInternals {
  return manager as unknown as TestManagerInternals;
}

describe('MCPManager', () => {
  let manager: MCPManager;

  beforeEach(() => {
    manager = new MCPManager();
  });

  describe('getServerStatus()', () => {
    it('returns disabled status for disabled servers', async () => {
      const configs: MCPServerConfig[] = [
        {
          id: 'test-1',
          name: 'Test Server',
          type: 'stdio',
          command: 'echo',
          args: ['hello'],
          enabled: false,
        },
      ];

      await manager.initializeServers(configs);
      const statuses = manager.getServerStatus();

      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toMatchObject({
        id: 'test-1',
        name: 'Test Server',
        connected: false,
        status: 'disabled',
        toolCount: 0,
      });
    });

    it('returns failed status when connection fails', async () => {
      const configs: MCPServerConfig[] = [
        {
          id: 'test-fail',
          name: 'Failing Server',
          type: 'sse',
          url: 'http://127.0.0.1:1/nonexistent',
          enabled: true,
        },
      ];

      // initializeServers catches errors internally, so this should not throw
      await manager.initializeServers(configs);
      const statuses = manager.getServerStatus();

      expect(statuses).toHaveLength(1);
      expect(statuses[0].id).toBe('test-fail');
      expect(statuses[0].status).toBe('failed');
      expect(statuses[0].connected).toBe(false);
    });

    it('includes status field in all returned statuses', async () => {
      const configs: MCPServerConfig[] = [
        {
          id: 'disabled-server',
          name: 'Disabled',
          type: 'stdio',
          command: 'echo',
          enabled: false,
        },
        {
          id: 'enabled-server',
          name: 'Enabled',
          type: 'sse',
          url: 'http://127.0.0.1:1/bad',
          enabled: true,
        },
      ];

      await manager.initializeServers(configs);
      const statuses = manager.getServerStatus();

      expect(statuses).toHaveLength(2);
      for (const s of statuses) {
        expect(s).toHaveProperty('status');
        expect(['connecting', 'connected', 'failed', 'disabled']).toContain(s.status);
      }
    });

    it('returns empty array when no servers configured', () => {
      const statuses = manager.getServerStatus();
      expect(statuses).toEqual([]);
    });
  });

  describe('connection timeout', () => {
    it('fails with timeout error when transport never responds', async () => {
      // Create a server config that will try to connect to a non-existent SSE endpoint
      // The SSE transport will fail quickly (connection refused), but this validates
      // the error is properly caught and status is set to 'failed'
      const config: MCPServerConfig = {
        id: 'timeout-test',
        name: 'Timeout Test',
        type: 'sse',
        url: 'http://127.0.0.1:1/timeout-test',
        enabled: true,
      };

      await manager.initializeServers([config]);
      const statuses = manager.getServerStatus();

      const serverStatus = statuses.find((s) => s.id === 'timeout-test');
      expect(serverStatus).toBeDefined();
      expect(serverStatus!.status).toBe('failed');
      expect(serverStatus!.connected).toBe(false);
    });

    it('waits five minutes before timing out listTools for slow MCP servers', async () => {
      vi.useFakeTimers();
      const testManager = asTestManager(manager);
      const mockClient: TestMCPClient = {
        listTools: vi.fn(
          () =>
            new Promise<{
              tools: Array<{
                name: string;
                inputSchema: { type: string; properties: Record<string, never> };
              }>;
            }>(() => {})
        ),
      };
      testManager.clients = new Map([['slow-server', mockClient]]);
      testManager.serverConfigs = new Map([
        [
          'slow-server',
          {
            id: 'slow-server',
            name: 'Slow Server',
            type: 'stdio',
            command: 'slow-server',
            enabled: true,
          },
        ],
      ]);

      let settled = false;
      const refreshPromise = manager.refreshTools().then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(299999);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await refreshPromise;

      expect(settled).toBe(true);
      expect(mockClient.listTools).toHaveBeenCalledTimes(1);
      expect(manager.getTools()).toEqual([]);
      vi.useRealTimers();
    });

    it('retries slow tool calls with a five-minute timeout per attempt', async () => {
      vi.useFakeTimers();
      const testManager = asTestManager(manager);
      const mockClient: TestMCPClient = {
        callTool: vi.fn(() => new Promise<unknown>(() => {})),
      };
      testManager.clients = new Map([['server-1', mockClient]]);
      testManager.tools = new Map([
        [
          'mcp__Slow_Server__inspect',
          {
            name: 'mcp__Slow_Server__inspect',
            description: '',
            inputSchema: { type: 'object', properties: {} },
            serverId: 'server-1',
            serverName: 'Slow Server',
          },
        ],
      ]);

      const callPromise = manager.callTool('mcp__Slow_Server__inspect', { pid: 1234 });

      await vi.advanceTimersByTimeAsync(299999);
      let settled = false;
      callPromise.catch(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(605001);
      await expect(callPromise).rejects.toThrow('Tool call timeout after 300000ms');
      expect(mockClient.callTool).toHaveBeenCalledTimes(3);
      vi.useRealTimers();
    });
  });

  describe('disconnectServer()', () => {
    it('removes connection status when disconnecting', async () => {
      const configs: MCPServerConfig[] = [
        {
          id: 'disc-test',
          name: 'Disconnect Test',
          type: 'sse',
          url: 'http://127.0.0.1:1/bad',
          enabled: true,
        },
      ];

      await manager.initializeServers(configs);

      // Server should be in failed state
      let statuses = manager.getServerStatus();
      expect(statuses[0].status).toBe('failed');

      // After disconnect, status entry is removed; enabled server with no tracked status
      // falls back to 'connecting' (transient state)
      await manager.disconnectServer('disc-test');
      statuses = manager.getServerStatus();
      expect(statuses[0].status).toBe('connecting');
    });
  });
});
