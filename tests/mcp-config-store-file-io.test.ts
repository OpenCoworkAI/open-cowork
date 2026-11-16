import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const profile = vi.hoisted(() => ({ directory: '' }));

// Keep electron-store and Conf real; only replace the Electron host API.
vi.mock('electron', () => {
  const app = {
    isPackaged: false,
    getPath: () => profile.directory,
    getVersion: () => '3.3.1',
  };
  const ipcMain = { on: vi.fn() };
  return { app, ipcMain, default: { app, ipcMain } };
});
vi.mock('../src/main/utils/logger', () => ({ log: vi.fn(), logError: vi.fn() }));

const valid = {
  command: 'echo',
  args: ['hello'],
  env: { SECOND: '2', FIRST: '1' },
  timeout: 15,
};
const unknown = ['preserve-this-entry'];
const collections = [
  { field: 'servers', value: [{ name: 'Echo', ...valid }, unknown, null] },
  { field: 'servers', value: { Echo: valid, mystery: unknown, hole: null } },
  { field: 'mcpServers', value: { Echo: valid, mystery: unknown, hole: null } },
  { field: 'mcp_servers', value: { Echo: valid, mystery: unknown, hole: null } },
  { field: 'servers', value: JSON.stringify({ Echo: valid, mystery: unknown, hole: null }) },
];

function configPath() {
  return path.join(profile.directory, 'mcp-config.json');
}

function writeDocument(document: unknown) {
  writeFileSync(configPath(), `${JSON.stringify(document, null, 4)}\n`);
}

function readDocument(): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath(), 'utf8')) as Record<string, unknown>;
}

function decodeCollection(value: unknown): unknown[] | Record<string, unknown> {
  return (typeof value === 'string' ? JSON.parse(value) : value) as
    | unknown[]
    | Record<string, unknown>;
}

describe('MCP config with real electron-store file IO', () => {
  beforeEach(() => {
    vi.resetModules();
    profile.directory = mkdtempSync(path.join(tmpdir(), 'open-cowork-mcp-io-'));
  });

  afterEach(() => {
    rmSync(profile.directory, { recursive: true, force: true });
  });

  for (const [index, { field, value }] of collections.entries()) {
    it(`keeps file bytes on construction/read and preserves siblings on edit/delete (${field}, ${index})`, async () => {
      writeDocument({ [field]: value, owner: 'agent', extra: { keep: true } });
      const before = readFileSync(configPath());
      const { mcpConfigStore } = await import('../src/main/mcp/mcp-config-store');

      const servers = mcpConfigStore.getServers();
      expect(servers).toHaveLength(1);
      expect(mcpConfigStore.getEnabledServers()).toHaveLength(1);
      expect(mcpConfigStore.getServer(servers[0].id)?.name).toBe('Echo');
      expect(readFileSync(configPath()).equals(before)).toBe(true);

      // Re-created arrays and differently ordered records still represent a no-op.
      mcpConfigStore.saveServer({
        ...servers[0],
        args: [...servers[0].args!],
        env: { FIRST: '1', SECOND: '2' },
      });
      expect(readFileSync(configPath()).equals(before)).toBe(true);

      mcpConfigStore.saveServer({ ...servers[0], enabled: false });
      const edited = readDocument();
      expect(edited.owner).toBe('agent');
      expect(edited.extra).toEqual({ keep: true });
      expect(typeof edited[field]).toBe(typeof value);
      const editedCollection = decodeCollection(edited[field]);
      const entry = Array.isArray(editedCollection) ? editedCollection[0] : editedCollection.Echo;
      expect(entry).toEqual({
        ...valid,
        ...(Array.isArray(value) ? { name: 'Echo' } : {}),
        enabled: false,
        id: servers[0].id,
      });
      expect(mcpConfigStore.getServer(servers[0].id)?.enabled).toBe(false);

      mcpConfigStore.deleteServer(servers[0].id);
      const deleted = readDocument();
      expect(deleted.owner).toBe('agent');
      expect(deleted.extra).toEqual({ keep: true });
      expect(typeof deleted[field]).toBe(typeof value);
      expect(decodeCollection(deleted[field])).toEqual(
        Array.isArray(value) ? [unknown, null] : { mystery: unknown, hole: null }
      );
    });
  }

  it('does not inject defaults or hide Claude entries beside an empty servers list', async () => {
    writeDocument({ servers: [], mcpServers: { Echo: valid, mystery: unknown } });
    const before = readFileSync(configPath());
    const { mcpConfigStore } = await import('../src/main/mcp/mcp-config-store');
    expect(mcpConfigStore.getServers()).toHaveLength(1);
    expect(readFileSync(configPath()).equals(before)).toBe(true);
  });

  it.each([{ servers: 'not-json' }, { servers: 42 }, { mcpServers: 42 }])(
    'refuses edits of an unreadable collection and keeps the original file bytes (%j)',
    async (document) => {
      writeDocument({ ...document, extra: 'keep' });
      const before = readFileSync(configPath());
      const { mcpConfigStore } = await import('../src/main/mcp/mcp-config-store');
      expect(mcpConfigStore.getServers()).toEqual([]);
      expect(() => mcpConfigStore.getServersForSettings()).toThrow(/MCP_CONFIG_NEEDS_REPAIR/);
      expect(() =>
        mcpConfigStore.saveServer({
          id: 'echo',
          name: 'Echo',
          type: 'stdio',
          command: 'echo',
          enabled: false,
        })
      ).toThrow(/JSON/i);
      expect(() => mcpConfigStore.deleteServer('echo')).toThrow(/JSON/i);
      expect(readFileSync(configPath()).equals(before)).toBe(true);
    }
  );

  it.each([{ servers: null }, { mcpServers: null }])(
    'allows adding to a null collection without rewriting it on read (%j)',
    async (document) => {
      writeDocument({ ...document, extra: 'keep' });
      const before = readFileSync(configPath());
      const { mcpConfigStore } = await import('../src/main/mcp/mcp-config-store');
      expect(mcpConfigStore.getServersForSettings()).toEqual([]);
      expect(readFileSync(configPath()).equals(before)).toBe(true);
      mcpConfigStore.saveServer({
        id: 'echo',
        name: 'Echo',
        type: 'stdio',
        command: 'echo',
        enabled: false,
      });
      expect(mcpConfigStore.getServer('echo')?.name).toBe('Echo');
      expect(readDocument().extra).toBe('keep');
      mcpConfigStore.deleteServer('echo');
      expect(readDocument().servers).toEqual([]);
      expect(readDocument().extra).toBe('keep');
    }
  );

  it('adopts a Claude collection beside null servers without changing either field on read', async () => {
    writeDocument({ servers: null, mcpServers: { Echo: valid, mystery: unknown } });
    const before = readFileSync(configPath());
    const { mcpConfigStore } = await import('../src/main/mcp/mcp-config-store');
    expect(mcpConfigStore.getServersForSettings()).toHaveLength(1);
    expect(readFileSync(configPath()).equals(before)).toBe(true);
  });

  it('persists and edits __proto__ as an own map entry instead of mutating the prototype', async () => {
    writeDocument({ mcpServers: { mystery: unknown } });
    const { mcpConfigStore } = await import('../src/main/mcp/mcp-config-store');
    const server = {
      id: 'proto-entry',
      name: '__proto__',
      type: 'stdio' as const,
      command: 'echo',
      enabled: false,
    };
    mcpConfigStore.saveServer(server);
    const collection = readDocument().mcpServers as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(collection, '__proto__')).toBe(true);
    expect(collection['__proto__']).toEqual(server);
    expect(mcpConfigStore.getServer(server.id)?.name).toBe('__proto__');
    mcpConfigStore.saveServer({ ...server, enabled: true });
    expect(mcpConfigStore.getServer(server.id)?.enabled).toBe(true);
    mcpConfigStore.deleteServer(server.id);
    expect(readDocument().mcpServers).toEqual({ mystery: unknown });
  });

  it('updates and deletes a recognized entry whose stored map key is empty', async () => {
    writeDocument({ mcpServers: { '': valid, mystery: unknown } });
    const { mcpConfigStore } = await import('../src/main/mcp/mcp-config-store');
    const server = mcpConfigStore.getServers()[0];
    mcpConfigStore.saveServer({ ...server, enabled: false });
    const collection = readDocument().mcpServers as Record<string, { enabled: boolean }>;
    expect(collection[''].enabled).toBe(false);
    mcpConfigStore.deleteServer(server.id);
    expect(readDocument().mcpServers).toEqual({ mystery: unknown });
  });
});
