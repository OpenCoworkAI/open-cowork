/**
 * Tests for MCPManager connection timeout and status tracking.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
import { logError } from '../../main/utils/logger';

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

describe('refreshTools() timeout', () => {
  let manager: MCPManager;

  beforeEach(() => {
    manager = new MCPManager();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function injectHangingServer(serverId: string, config: MCPServerConfig): void {
    const mockClient = { listTools: (): Promise<never> => new Promise<never>(() => {}) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).clients.set(serverId, mockClient);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).serverConfigs.set(serverId, config);
  }

  it('times out listTools at 60 s by default', async () => {
    vi.useFakeTimers();
    injectHangingServer('slow-1', {
      id: 'slow-1',
      name: 'Slow Server',
      type: 'stdio',
      command: 'cat',
      enabled: true,
    });

    const p = manager.refreshTools();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(vi.mocked(logError)).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await p;

    expect(vi.mocked(logError)).toHaveBeenCalledWith(
      expect.stringContaining('[MCPManager]'),
      expect.stringContaining('listTools timeout after 60000ms')
    );
  });

  it('respects per-server listToolsTimeoutMs override', async () => {
    vi.useFakeTimers();
    injectHangingServer('slow-2', {
      id: 'slow-2',
      name: 'Slow Override',
      type: 'stdio',
      command: 'cat',
      enabled: true,
      listToolsTimeoutMs: 5_000,
    });

    const p = manager.refreshTools();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(vi.mocked(logError)).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await p;

    expect(vi.mocked(logError)).toHaveBeenCalledWith(
      expect.stringContaining('[MCPManager]'),
      expect.stringContaining('listTools timeout after 5000ms')
    );
  });
});

describe('callTool() timeout', () => {
  let manager: MCPManager;

  beforeEach(() => {
    manager = new MCPManager();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function injectHangingTool(
    serverId: string,
    serverName: string,
    config: MCPServerConfig
  ): string {
    const mockClient = { callTool: (): Promise<never> => new Promise<never>(() => {}) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).clients.set(serverId, mockClient);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).serverConfigs.set(serverId, config);
    const toolName = `mcp__${serverName.replace(/\s+/g, '_')}__test`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).tools.set(toolName, {
      name: toolName,
      description: 'test tool',
      inputSchema: { type: 'object', properties: {} },
      serverId,
      serverName,
    });
    return toolName;
  }

  it('uses 120 s default timeout for callTool', () => {
    // Spy on setTimeout so it never fires — we only need to verify the value passed.
    // Driving callTool through all retries with fake timers triggers a Vitest/Node.js
    // edge case where intermediate timeout-promise rejections appear briefly unhandled
    // between the setImmediate callback and the microtask flush.
    const spy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockReturnValue(0 as unknown as ReturnType<typeof setTimeout>);

    const toolName = injectHangingTool('ct-1', 'CT Server', {
      id: 'ct-1',
      name: 'CT Server',
      type: 'stdio',
      command: 'cat',
      enabled: true,
    });

    // callTool runs synchronously up to the first `await Promise.race(...)`.
    // setTimeout is called before that first yield, so no ticks needed.
    void manager.callTool(toolName, {});

    // Search all setTimeout calls for the expected timeout value rather than
    // relying on call index — guards against future additions before this line.
    const observedMs = spy.mock.calls.map(([, ms]) => ms as number);
    expect(observedMs).toContain(120_000);

    spy.mockRestore();
  });

  it('respects per-server callToolTimeoutMs override', () => {
    const spy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockReturnValue(0 as unknown as ReturnType<typeof setTimeout>);

    const toolName = injectHangingTool('ct-2', 'CT Override', {
      id: 'ct-2',
      name: 'CT Override',
      type: 'stdio',
      command: 'cat',
      enabled: true,
      callToolTimeoutMs: 5_000,
    });

    void manager.callTool(toolName, {});

    const observedMs = spy.mock.calls.map(([, ms]) => ms as number);
    expect(observedMs).toContain(5_000);

    spy.mockRestore();
  });
});
