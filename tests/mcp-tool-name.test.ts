import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

import { MCPManager } from '../src/main/mcp/mcp-manager';

type TestManagerInternals = {
  clients: Map<string, unknown>;
  tools: Map<string, unknown>;
  serverConfigs: Map<string, unknown>;
  reconnectServer: ReturnType<typeof vi.fn>;
};

function asTestManager(manager: MCPManager): MCPManager & TestManagerInternals {
  return manager as MCPManager & TestManagerInternals;
}

function createManagerWithTool(toolName: string) {
  const manager = new MCPManager();
  const mockClient = {
    callTool: vi.fn().mockResolvedValue({ ok: true }),
  };
  const testManager = asTestManager(manager);

  testManager.clients = new Map([['server-1', mockClient]]);
  testManager.tools = new Map([
    [
      toolName,
      {
        name: toolName,
        description: '',
        inputSchema: { type: 'object', properties: {} },
        serverId: 'server-1',
        serverName: 'Software Development',
      },
    ],
  ]);

  return { manager, mockClient };
}

describe('MCP tool name parsing', () => {
  it('strips server prefix when server name contains underscores', async () => {
    const toolName = 'mcp__Software_Development__create_or_modify_code';
    const { manager, mockClient } = createManagerWithTool(toolName);

    await manager.callTool(toolName, { foo: 'bar' });

    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'create_or_modify_code',
      arguments: { foo: 'bar' },
    });
  });

  it('strips server prefix for simple names', async () => {
    const toolName = 'mcp__Chrome__navigate';
    const { manager, mockClient } = createManagerWithTool(toolName);

    await manager.callTool(toolName, { url: 'https://example.com' });

    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'navigate',
      arguments: { url: 'https://example.com' },
    });
  });

  it('reconnects and retries when tool returns structured Not connected error', async () => {
    const toolName = 'mcp__GUI_Operate__screenshot_for_display';
    const manager = new MCPManager();
    const testManager = asTestManager(manager);
    const mockClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          content: [
            {
              type: 'text',
              text: '{"error":true,"message":"Not connected"}',
            },
          ],
        })
        .mockResolvedValueOnce({ ok: true }),
    };

    testManager.clients = new Map([['server-1', mockClient]]);
    testManager.tools = new Map([
      [
        toolName,
        {
          name: toolName,
          description: '',
          inputSchema: { type: 'object', properties: {} },
          serverId: 'server-1',
          serverName: 'GUI_Operate',
        },
      ],
    ]);
    testManager.reconnectServer = vi.fn().mockResolvedValue(true);

    const result = await manager.callTool(toolName, { display_index: 0 });

    expect(testManager.reconnectServer).toHaveBeenCalledWith('server-1');
    expect(mockClient.callTool).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });

  it('does not reconnect when tool returns plain text content without structured error envelope', async () => {
    const toolName = 'mcp__GUI_Operate__screenshot_for_display';
    const manager = new MCPManager();
    const testManager = asTestManager(manager);
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'Not connected',
          },
        ],
      }),
    };

    testManager.clients = new Map([['server-1', mockClient]]);
    testManager.tools = new Map([
      [
        toolName,
        {
          name: toolName,
          description: '',
          inputSchema: { type: 'object', properties: {} },
          serverId: 'server-1',
          serverName: 'GUI_Operate',
        },
      ],
    ]);
    testManager.reconnectServer = vi.fn().mockResolvedValue(true);

    const result = await manager.callTool(toolName, { display_index: 0 });

    expect(testManager.reconnectServer).not.toHaveBeenCalled();
    expect(mockClient.callTool).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'Not connected',
        },
      ],
    });
  });

  it('sanitizes model-facing MCP tool names while calling the original tool name', async () => {
    const manager = new MCPManager();
    const testManager = asTestManager(manager);
    const mockClient = {
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'browser.context',
            description: 'Inspect browser context',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      }),
      callTool: vi.fn().mockResolvedValue({ ok: true }),
    };

    testManager.clients = new Map([['server-1', mockClient]]);
    testManager.serverConfigs = new Map([
      [
        'server-1',
        {
          id: 'server-1',
          name: 'Browser Context',
          type: 'stdio',
          enabled: true,
        },
      ],
    ]);

    await manager.refreshTools();

    const [tool] = manager.getTools();
    expect(tool.name).toBe('mcp__Browser_Context__browser_context');
    expect(tool.originalName).toBe('browser.context');

    await manager.callTool(tool.name, { url: 'https://example.com' });

    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'browser.context',
      arguments: { url: 'https://example.com' },
    });
  });

  it('deduplicates sanitized MCP tool names that would otherwise collide', async () => {
    const manager = new MCPManager();
    const testManager = asTestManager(manager);
    const mockClient = {
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'browser.context',
            description: '',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'browser:context',
            description: '',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      }),
      callTool: vi.fn().mockResolvedValue({ ok: true }),
    };

    testManager.clients = new Map([['server-1', mockClient]]);
    testManager.serverConfigs = new Map([
      [
        'server-1',
        {
          id: 'server-1',
          name: 'Browser Context',
          type: 'stdio',
          enabled: true,
        },
      ],
    ]);

    await manager.refreshTools();

    const toolNames = manager.getTools().map((tool) => tool.name);
    expect(toolNames).toEqual([
      'mcp__Browser_Context__browser_context',
      'mcp__Browser_Context__browser_context_2',
    ]);
  });
});
