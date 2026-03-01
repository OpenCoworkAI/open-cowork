import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

import { MCPManager } from '../src/main/mcp/mcp-manager';

function createManagerWithTool(toolName: string) {
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
});
