import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  McpConfigExtension,
  activateMcpConfiguration,
  validateMcpConfiguration,
} from '../src/main/mcp/mcp-config-extension';
import type { MCPServerConfig } from '../src/main/mcp/mcp-manager';
import type { AgentRuntimeCustomTool } from '../src/main/extensions/agent-runtime-extension';
import { decidePermission, setPermissionRules } from '../src/main/config/permission-rules-store';

const profile = vi.hoisted(() => ({ directory: '' }));
vi.mock('electron', () => {
  const app = { isPackaged: false, getPath: () => profile.directory, getVersion: () => '3.3.1' };
  const ipcMain = { on: vi.fn() };
  return { app, ipcMain, default: { app, ipcMain } };
});
vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logCtx: vi.fn(),
  logCtxError: vi.fn(),
  logTiming: vi.fn(),
}));

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
        url: 'https://example.com/mcp?key=SECRET_URL',
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

  it.each(['initialization', 'reconnection'])(
    'retries a deferred %s update even while the old same-ID server is connected',
    async (phase) => {
      const host = await fixture();
      const { MCPManager } = await import('../src/main/mcp/mcp-manager');
      const manager = new MCPManager();
      const original: MCPServerConfig = {
        id: 'notes',
        name: 'Notes',
        type: 'sse',
        url: 'https://old.example/mcp',
        enabled: true,
      };
      const updated: MCPServerConfig = { ...original, url: 'https://new.example/mcp' };
      const internals = manager as unknown as {
        initializingServers: boolean;
        reconnectingServers: Set<string>;
        clients: Map<string, { close: () => Promise<void> }>;
        serverConfigs: Map<string, MCPServerConfig>;
        connectServer(config: MCPServerConfig): Promise<void>;
        refreshTools(): Promise<void>;
      };
      const client = { close: vi.fn(async () => {}) };
      internals.serverConfigs.set(original.id, original);
      internals.clients.set(original.id, client);
      const connect = vi.spyOn(internals, 'connectServer').mockImplementation(async (config) => {
        internals.clients.set(config.id, client);
      });
      vi.spyOn(internals, 'refreshTools').mockResolvedValue(undefined);
      const extension = new McpConfigExtension(host.store, (config) =>
        activateMcpConfiguration(manager, config)
      );
      const tools = (await extension.beforeSessionRun()).customTools!;
      await callTool(tools, 'mcp_configure', { server: updated });
      internals.initializingServers = phase === 'initialization';
      if (phase === 'reconnection') internals.reconnectingServers.add(original.id);
      expect(manager.getServerStatus()[0].connected).toBe(true);
      expect((await extension.beforeSessionRun()).promptPrefix).toContain('could not be activated');
      expect(internals.serverConfigs.get(original.id)?.url).toBe(original.url);
      expect(connect).not.toHaveBeenCalled();
      internals.initializingServers = false;
      internals.reconnectingServers.clear();
      expect((await extension.beforeSessionRun()).promptPrefix).toBeUndefined();
      expect(internals.serverConfigs.get(original.id)?.url).toBe(updated.url);
      expect(connect).toHaveBeenCalledOnce();
      await extension.beforeSessionRun();
      expect(connect).toHaveBeenCalledOnce();
    }
  );

  it.each([
    { type: 'sse', url: 'https://other.example/mcp' },
    { type: 'sse', url: 'https://original.example/new-endpoint' },
    { type: 'streamable-http', url: 'https://original.example/mcp' },
    { type: 'stdio', command: 'other-executable', args: ['--serve'] },
  ])(
    'does not forward stored headers or arbitrary environment values to a changed target: %j',
    (target) => {
      const existing: MCPServerConfig = {
        id: 'notes',
        name: 'Notes',
        type: 'sse',
        url: 'https://original.example/mcp',
        enabled: true,
        headers: { Authorization: 'old-secret', 'X-Custom': 'unknown-secret' },
        env: { SOMETHING: 'opaque-secret', PATH: '/private/bin' },
      };
      const saved = validateMcpConfiguration({ id: 'notes', name: 'Notes', ...target }, existing);
      expect(saved.headers).toBeUndefined();
      expect(saved.env).toBeUndefined();
    }
  );

  it.each([
    { command: 'other-executable' },
    { command: 'npx', args: ['other-server'] },
    { command: 'npx', cwd: '/another-directory' },
  ])('clears omitted credentials when a stdio target changes: %j', (target) => {
    const existing: MCPServerConfig = {
      id: 'notes',
      name: 'Notes',
      type: 'stdio',
      command: 'npx',
      args: ['old-server', '--token=secret'],
      cwd: '/original-directory',
      env: { OPAQUE: 'secret' },
      headers: { Authorization: 'secret' },
      enabled: true,
    };
    const saved = validateMcpConfiguration(
      { id: 'notes', name: 'Notes', type: 'stdio', ...target },
      existing
    );
    expect(saved.env).toBeUndefined();
    expect(saved.headers).toBeUndefined();
    if (target.command !== 'npx') expect(saved.args).toBeUndefined();
  });

  it('preserves omitted credentials for the same stdio target', () => {
    const existing: MCPServerConfig = {
      id: 'notes',
      name: 'Notes',
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { OPAQUE: 'secret' },
      enabled: true,
    };
    expect(
      validateMcpConfiguration(
        { id: 'notes', name: 'Renamed', type: 'stdio', command: 'node' },
        existing
      ).env
    ).toEqual(existing.env);
  });

  it('uses explicitly supplied credentials for a new target without merging old entries', () => {
    const existing: MCPServerConfig = {
      id: 'notes',
      name: 'Notes',
      type: 'sse',
      url: 'https://original.example/mcp',
      enabled: true,
      env: { OLD: 'secret' },
      headers: { Authorization: 'secret', 'X-Old': 'secret' },
    };
    const saved = validateMcpConfiguration(
      {
        id: 'notes',
        name: 'Notes',
        type: 'sse',
        url: 'https://new.example/mcp',
        env: { NEW: 'new-value' },
        headers: { 'X-New': 'new-value' },
      },
      existing
    );
    expect(saved.env).toEqual({ NEW: 'new-value' });
    expect(saved.headers).toEqual({ 'X-New': 'new-value' });
  });
});
