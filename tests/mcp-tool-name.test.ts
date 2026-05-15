/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

import { MCPManager } from '../src/main/mcp/mcp-manager';

function stripMcpPrefix(toolName: string): string {
  if (toolName.startsWith('mcp__')) {
    const remainder = toolName.slice('mcp__'.length);
    const sep = remainder.indexOf('__');
    if (sep !== -1) return remainder.slice(sep + 2);
  }
  return toolName;
}

function createManagerWithTool(toolName: string, originalToolName = stripMcpPrefix(toolName)) {
  const manager = new MCPManager();
  const mockClient = {
    callTool: vi.fn().mockResolvedValue({ ok: true }),
  } as any;

  (manager as any).clients = new Map([['server-1', mockClient]]);
  (manager as any).tools = new Map([
    [
      toolName,
      {
        name: toolName,
        originalToolName,
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
    } as any;

    (manager as any).clients = new Map([['server-1', mockClient]]);
    (manager as any).tools = new Map([
      [
        toolName,
        {
          name: toolName,
          originalToolName: stripMcpPrefix(toolName),
          description: '',
          inputSchema: { type: 'object', properties: {} },
          serverId: 'server-1',
          serverName: 'GUI_Operate',
        },
      ],
    ]);
    (manager as any).reconnectServer = vi.fn().mockResolvedValue(true);

    const result = await manager.callTool(toolName, { display_index: 0 });

    expect((manager as any).reconnectServer).toHaveBeenCalledWith('server-1');
    expect(mockClient.callTool).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });

  it('sanitizes tool name with dots and colons, preserving original for the call', async () => {
    const prefixedName = 'mcp__Server__my_resource_read';
    const { manager, mockClient } = createManagerWithTool(prefixedName, 'my.resource.read');

    await manager.callTool(prefixedName, {});

    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'my.resource.read',
      arguments: {},
    });
  });

  it('disambiguates colliding sanitized names with a numeric suffix', async () => {
    const manager = new MCPManager();
    const mockClient = { callTool: vi.fn().mockResolvedValue({ ok: true }) } as any;

    (manager as any).clients = new Map([['server-1', mockClient]]);
    (manager as any).tools = new Map([
      [
        'mcp__Server__my_tool',
        {
          name: 'mcp__Server__my_tool',
          originalToolName: 'my.tool',
          description: '',
          inputSchema: { type: 'object', properties: {} },
          serverId: 'server-1',
          serverName: 'Server',
        },
      ],
      [
        'mcp__Server__my_tool_1',
        {
          name: 'mcp__Server__my_tool_1',
          originalToolName: 'my-tool',
          description: '',
          inputSchema: { type: 'object', properties: {} },
          serverId: 'server-1',
          serverName: 'Server',
        },
      ],
    ]);

    await manager.callTool('mcp__Server__my_tool', {});
    expect(mockClient.callTool).toHaveBeenCalledWith({ name: 'my.tool', arguments: {} });

    await manager.callTool('mcp__Server__my_tool_1', {});
    expect(mockClient.callTool).toHaveBeenCalledWith({ name: 'my-tool', arguments: {} });
  });

  it('falls back to _unnamed_ for tool names that sanitize to empty string', async () => {
    const prefixedName = 'mcp__Server___unnamed_';
    const { manager, mockClient } = createManagerWithTool(prefixedName, '..');

    await manager.callTool(prefixedName, {});

    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: '..',
      arguments: {},
    });
  });

  it('does not reconnect when tool returns plain text content without structured error envelope', async () => {
    const toolName = 'mcp__GUI_Operate__screenshot_for_display';
    const manager = new MCPManager();
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'Not connected',
          },
        ],
      }),
    } as any;

    (manager as any).clients = new Map([['server-1', mockClient]]);
    (manager as any).tools = new Map([
      [
        toolName,
        {
          name: toolName,
          originalToolName: stripMcpPrefix(toolName),
          description: '',
          inputSchema: { type: 'object', properties: {} },
          serverId: 'server-1',
          serverName: 'GUI_Operate',
        },
      ],
    ]);
    (manager as any).reconnectServer = vi.fn().mockResolvedValue(true);

    const result = await manager.callTool(toolName, { display_index: 0 });

    expect((manager as any).reconnectServer).not.toHaveBeenCalled();
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
});
