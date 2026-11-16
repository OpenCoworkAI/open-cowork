import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpConfigExtension } from '../src/main/mcp/mcp-config-extension';
import type { AgentRuntimeCustomTool } from '../src/main/extensions/agent-runtime-extension';
import { decidePermission, setPermissionRules } from '../src/main/config/permission-rules-store';

const profile = vi.hoisted(() => ({ directory: '' }));
vi.mock('electron', () => {
  const app = { isPackaged: false, getPath: () => profile.directory, getVersion: () => '3.3.1' };
  const ipcMain = { on: vi.fn() };
  return { app, ipcMain, default: { app, ipcMain } };
});
vi.mock('../src/main/utils/logger', () => ({ log: vi.fn(), logError: vi.fn() }));

async function fixture() {
  const { mcpConfigStore } = await import('../src/main/mcp/mcp-config-store');
  const activate = vi.fn().mockResolvedValue(undefined);
  const invalidate = vi.fn();
  const extension = new McpConfigExtension(mcpConfigStore, activate, invalidate);
  const initial = await extension.beforeSessionRun();
  return { store: mcpConfigStore, activate, invalidate, extension, tools: initial.customTools! };
}

async function callTool(tools: AgentRuntimeCustomTool[], name: string, params: unknown) {
  const execute = tools.find((tool) => tool.name === name)!.execute as unknown as (
    id: string,
    params: unknown
  ) => Promise<{ content: Array<{ text: string }> }>;
  return JSON.parse((await execute('test-call', params)).content[0].text) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  vi.resetModules();
  profile.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-chat-mcp-'));
  fs.writeFileSync(
    path.join(profile.directory, 'mcp-config.json'),
    JSON.stringify({ servers: [], owner: 'keep' })
  );
  setPermissionRules([]);
});
afterEach(() => fs.rmSync(profile.directory, { recursive: true, force: true }));

describe('chat MCP configuration', () => {
  it('persists the user-provided executable and spaced arguments without starting it', async () => {
    const host = await fixture();
    const result = await callTool(host.tools, 'mcp_configure', {
      server: {
        name: 'My notes',
        type: 'stdio',
        command: '/Applications/My MCP Server/server',
        args: ['/Users/me/My Vault'],
      },
    });
    expect(result).toMatchObject({
      appliesOnNextTurn: true,
      saved: { name: 'My notes', enabled: false },
    });
    expect(host.activate).not.toHaveBeenCalled();
    expect(host.store.getServersForSettings()[0]).toMatchObject({
      command: '/Applications/My MCP Server/server',
      args: ['/Users/me/My Vault'],
      enabled: false,
    });
    const document = JSON.parse(
      fs.readFileSync(path.join(profile.directory, 'mcp-config.json'), 'utf8')
    );
    expect(document.owner).toBe('keep');
    expect(document.servers).toHaveLength(1);
    vi.resetModules();
    const reloaded = (await import('../src/main/mcp/mcp-config-store')).mcpConfigStore;
    expect(reloaded.getServersForSettings()[0].args).toEqual(['/Users/me/My Vault']);
    expect(decidePermission('chat', 'mcp_configure', {})).toBe('ask');
  });

  it('activates an explicitly enabled HTTP server before tools are built on the next turn', async () => {
    const host = await fixture();
    await callTool(host.tools, 'mcp_configure', {
      server: {
        id: 'notes',
        name: 'My notes',
        type: 'streamable-http',
        url: 'http://127.0.0.1:27124/mcp',
        enabled: true,
      },
    });
    expect(host.activate).not.toHaveBeenCalled();
    await host.extension.beforeSessionRun();
    expect(host.activate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'notes', enabled: true })
    );
    expect(host.invalidate).toHaveBeenCalledTimes(2);
    await host.extension.beforeSessionRun();
    expect(host.activate).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: 'invalid', type: 'stdio' },
    { name: 'invalid', type: 'stdio', command: 'node', args: '--foo' },
    { name: 'invalid', type: 'stdio', command: 'node', args: [1] },
    { name: 'invalid', type: 'http', url: 'https://example.com/mcp' },
    { name: 'invalid', type: 'sse', url: 'file:///tmp/server' },
    { name: 'invalid', type: 'sse', url: 'not-a-url' },
    { name: 'invalid', type: 'sse', url: 'https://example.com/mcp', enabled: 'true' },
    { name: 'invalid', type: 'stdio', command: 'node', env: { TOKEN: 1 } },
  ])('rejects invalid input without changing the persisted file: %j', async (server) => {
    const host = await fixture();
    const filename = path.join(profile.directory, 'mcp-config.json');
    const before = fs.readFileSync(filename);
    expect(await callTool(host.tools, 'mcp_configure', { server })).toHaveProperty('error');
    expect(fs.readFileSync(filename).equals(before)).toBe(true);
    await host.extension.beforeSessionRun();
    expect(host.activate).not.toHaveBeenCalled();
  });

  it('redacts existing secrets and preserves credentials omitted from an update', async () => {
    const host = await fixture();
    host.store.saveServer({
      id: 'notes',
      name: 'Notes',
      type: 'sse',
      url: 'https://example.com/mcp?key=SECRET_URL',
      headers: { Authorization: 'SECRET_HEADER' },
      env: { TOKEN: 'SECRET_ENV' },
      enabled: false,
    });
    const listed = await callTool(host.tools, 'mcp_list', {});
    expect(JSON.stringify(listed)).not.toContain('SECRET_');
    const updated = await callTool(host.tools, 'mcp_configure', {
      server: {
        id: 'notes',
        name: 'Notes',
        type: 'sse',
        url: 'https://example.com/mcp',
        enabled: true,
      },
    });
    expect(JSON.stringify(updated)).not.toContain('SECRET_');
    expect(host.store.getServer('notes')?.headers).toEqual({ Authorization: 'SECRET_HEADER' });
  });

  it('retries activation failures without claiming the server connected or echoing credentials', async () => {
    const host = await fixture();
    host.activate.mockRejectedValueOnce(new Error('SECRET_CONNECTION_ERROR'));
    await callTool(host.tools, 'mcp_configure', {
      server: {
        id: 'notes',
        name: 'Notes',
        type: 'sse',
        url: 'https://example.com/mcp',
        enabled: true,
      },
    });
    const failed = await host.extension.beforeSessionRun();
    expect(failed.promptPrefix).toContain('could not be activated');
    expect(failed.promptPrefix).not.toContain('SECRET_');
    await host.extension.beforeSessionRun();
    expect(host.activate).toHaveBeenCalledTimes(2);
  });

  it('respects a later Settings deletion instead of reviving a queued connector', async () => {
    const host = await fixture();
    await callTool(host.tools, 'mcp_configure', {
      server: {
        id: 'notes',
        name: 'Notes',
        type: 'stdio',
        command: 'node',
        enabled: true,
      },
    });
    host.store.deleteServer('notes');
    await host.extension.beforeSessionRun();
    expect(host.activate).not.toHaveBeenCalled();
  });
});
