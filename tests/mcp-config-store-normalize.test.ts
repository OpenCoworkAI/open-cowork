import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const storeState: {
  data: Record<string, unknown>;
  mutations: Array<{ op: 'set' | 'delete'; key: string }>;
} = {
  data: { servers: [] },
  mutations: [],
};

// `var` so the hoisted electron-store mock can record constructor options
// before `storeState` is initialized.
var capturedStoreOptions: { defaults?: unknown; name?: string; projectName?: string } | undefined;

vi.mock('electron-store', () => {
  class MockStore {
    constructor(options?: { defaults?: unknown; name?: string; projectName?: string }) {
      capturedStoreOptions = options;
    }

    get(key: string, defaultValue?: unknown) {
      return Object.prototype.hasOwnProperty.call(storeState.data, key)
        ? storeState.data[key]
        : defaultValue;
    }

    set(key: string, value: unknown) {
      storeState.mutations.push({ op: 'set', key });
      storeState.data[key] = value;
    }

    delete(key: string) {
      storeState.mutations.push({ op: 'delete', key });
      delete storeState.data[key];
    }

    get store() {
      return storeState.data;
    }
  }

  return { default: MockStore };
});

vi.mock('electron', () => ({
  app: { isPackaged: false },
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import { mcpConfigStore } from '../src/main/mcp/mcp-config-store';

const fixturesDir = path.resolve(process.cwd(), 'tests/fixtures');

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8')) as Record<string, unknown>;
}

function documentBytes(): string {
  return JSON.stringify(storeState.data);
}

function readNormalizedNames(): string[] {
  return mcpConfigStore.getServers().map((server) => server.name);
}

describe('MCPConfigStore lossless config IO', () => {
  beforeEach(() => {
    storeState.data = { servers: [] };
    storeState.mutations = [];
  });

  it('does not register store defaults that would rewrite the file on startup', () => {
    expect(capturedStoreOptions).toMatchObject({
      name: 'mcp-config',
      projectName: 'open-cowork',
    });
    expect(
      capturedStoreOptions && Object.prototype.hasOwnProperty.call(capturedStoreOptions, 'defaults')
    ).toBe(false);
  });

  it('startup/read with unknown entries leaves the stored document byte-identical', () => {
    const remote = {
      type: 'http',
      url: 'https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-test-key',
    };
    const legacyList = ['do-not-drop'];
    storeState.data = {
      mcpServers: {
        'tavily-mcp': {
          command: 'npx',
          args: ['-y', 'tavily-mcp@latest'],
          env: { TAVILY_API_KEY: 'tvly-test-key' },
        },
        'tavily-remote': remote,
        'mystery-plugin': 'not-a-server',
        'legacy-list': legacyList,
      },
      clientName: 'claude-desktop',
    };
    const before = documentBytes();

    expect(readNormalizedNames().sort()).toEqual(['tavily-mcp', 'tavily-remote']);
    expect(() => mcpConfigStore.getEnabledServers()).not.toThrow();
    expect(mcpConfigStore.getServer('mcp-tavily-mcp')?.name).toBe('tavily-mcp');
    mcpConfigStore.getServers();

    expect(documentBytes()).toBe(before);
    expect(storeState.mutations).toEqual([]);
    expect(storeState.data.mcpServers).toMatchObject({
      'mystery-plugin': 'not-a-server',
    });
    expect((storeState.data.mcpServers as { 'legacy-list': unknown })['legacy-list']).toBe(
      legacyList
    );
  });

  it('leaves fixture documents byte-identical on read, including skipped null entries', () => {
    for (const name of [
      'mcp-config-agent-tavily.json',
      'mcp-config-claude-mcpServers.json',
      'mcp-config-mixed-agent-installed.json',
    ]) {
      storeState.data = loadFixture(name);
      storeState.mutations = [];
      const before = documentBytes();

      const servers = mcpConfigStore.getServers();
      mcpConfigStore.getEnabledServers();

      expect(servers.length).toBeGreaterThan(0);
      expect(documentBytes()).toBe(before);
      expect(storeState.mutations).toEqual([]);
    }

    storeState.data = loadFixture('mcp-config-mixed-agent-installed.json');
    expect(
      mcpConfigStore
        .getServers()
        .map((server) => server.name)
        .sort()
    ).toEqual(['Chrome', 'tavily-mcp']);
    expect(documentBytes()).toBe(
      JSON.stringify(loadFixture('mcp-config-mixed-agent-installed.json'))
    );
  });

  it('returns a normalized view of an agent-installed map without persisting it', () => {
    storeState.data = loadFixture('mcp-config-agent-tavily.json');
    const before = documentBytes();

    const servers = mcpConfigStore.getServers();
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ name: 'tavily-mcp', type: 'stdio' });
    expect(documentBytes()).toBe(before);
    expect(Array.isArray(storeState.data.servers)).toBe(false);
  });

  it('reads JSON-string servers into memory without rewriting them as an array', () => {
    const tavily = loadFixture('mcp-config-agent-tavily.json');
    const encoded = JSON.stringify(tavily.servers);
    storeState.data = { servers: encoded };

    const servers = mcpConfigStore.getServers();
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('tavily-mcp');
    expect(storeState.data.servers).toBe(encoded);
    expect(storeState.mutations).toEqual([]);
  });

  it('does not overwrite an unreadable servers string on read, save, or delete', () => {
    storeState.data = { servers: 'not-json-config', extra: 1 };
    const before = documentBytes();

    expect(mcpConfigStore.getServers()).toEqual([]);
    expect(documentBytes()).toBe(before);

    expect(() =>
      mcpConfigStore.saveServer({
        id: 'mcp-new',
        name: 'New',
        type: 'stdio',
        command: 'echo',
        enabled: true,
      })
    ).toThrow(/JSON/i);
    expect(() => mcpConfigStore.deleteServer('mcp-new')).toThrow(/JSON/i);
    expect(documentBytes()).toBe(before);
    expect(storeState.mutations).toEqual([]);
  });

  it('adopts mcpServers beside an empty servers array without rewriting either field', () => {
    storeState.data = {
      servers: [],
      ...loadFixture('mcp-config-claude-mcpServers.json'),
    };
    const before = documentBytes();

    expect(readNormalizedNames().sort()).toEqual(['tavily-mcp', 'tavily-remote']);
    expect(documentBytes()).toBe(before);
    expect(storeState.data.servers).toEqual([]);
    expect(storeState.data.mcpServers).toBeDefined();
    expect(storeState.mutations).toEqual([]);
  });

  it('saveServer keeps unknown entries and the Claude mcpServers shape', () => {
    const remote = {
      type: 'http',
      url: 'https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-test-key',
    };
    const tavily = {
      command: 'npx',
      args: ['-y', 'tavily-mcp@latest'],
      env: { TAVILY_API_KEY: 'tvly-test-key' },
    };
    const legacyList = ['do-not-drop'];
    storeState.data = {
      mcpServers: {
        'tavily-mcp': tavily,
        'tavily-remote': remote,
        'mystery-plugin': 'not-a-server',
        'legacy-list': legacyList,
      },
      clientName: 'claude-desktop',
    };

    const viewed = mcpConfigStore.getServers().find((server) => server.name === 'tavily-mcp');
    expect(viewed).toBeDefined();
    mcpConfigStore.saveServer({ ...viewed!, enabled: false });

    const mcpServers = storeState.data.mcpServers as Record<string, unknown>;
    expect(storeState.data.servers).toBeUndefined();
    expect(storeState.data.clientName).toBe('claude-desktop');
    expect(mcpServers['mystery-plugin']).toBe('not-a-server');
    expect(mcpServers['legacy-list']).toBe(legacyList);
    expect(mcpServers['tavily-remote']).toBe(remote);
    expect(mcpServers['tavily-mcp']).toEqual({
      ...tavily,
      enabled: false,
      id: 'mcp-tavily-mcp',
    });
    expect(storeState.mutations).toEqual([{ op: 'set', key: 'mcpServers' }]);
  });

  it('saveServer keeps a keyed servers object and its unrecognized entries', () => {
    const legacyList = ['do-not-drop'];
    const tavily = {
      command: 'npx',
      args: '-y tavily-mcp@latest',
      env: ['TAVILY_API_KEY=tvly-test-key'],
      timeout: 15,
    };
    storeState.data = {
      servers: {
        'tavily-mcp': tavily,
        mystery: null,
        'legacy-list': legacyList,
      },
      note: 'keep-top-level',
    };

    const viewed = mcpConfigStore.getServers().find((server) => server.name === 'tavily-mcp');
    mcpConfigStore.saveServer({ ...viewed!, command: 'node' });

    const servers = storeState.data.servers as Record<string, unknown>;
    expect(Array.isArray(servers)).toBe(false);
    expect(servers.mystery).toBeNull();
    expect(servers['legacy-list']).toBe(legacyList);
    expect(storeState.data.note).toBe('keep-top-level');
    expect(servers['tavily-mcp']).toEqual({
      ...tavily,
      command: 'node',
      id: 'mcp-tavily-mcp',
    });
    expect(storeState.data.mcpServers).toBeUndefined();
  });

  it('saveServer keeps JSON-string servers and unrecognized entries in that string', () => {
    const chrome = {
      id: 'mcp-chrome-1',
      name: 'Chrome',
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
      enabled: true,
      timeout: 30,
    };
    const tavily = {
      name: 'tavily-mcp',
      command: 'npx',
      args: '-y tavily-mcp@latest',
    };
    storeState.data = {
      servers: JSON.stringify([chrome, null, tavily, 7]),
      owner: 'agent',
    };

    const viewed = mcpConfigStore.getServers().find((server) => server.name === 'tavily-mcp');
    mcpConfigStore.saveServer({ ...viewed!, enabled: false });

    expect(typeof storeState.data.servers).toBe('string');
    expect(storeState.data.owner).toBe('agent');
    expect(JSON.parse(storeState.data.servers as string)).toEqual([
      chrome,
      null,
      { ...tavily, enabled: false, id: 'mcp-tavily-mcp' },
      7,
    ]);
    expect(storeState.mutations).toEqual([{ op: 'set', key: 'servers' }]);
  });

  it('appends a new server to a canonical servers array', () => {
    storeState.data = { servers: [] };
    mcpConfigStore.saveServer({
      id: 'mcp-echo-1',
      name: 'Echo',
      type: 'stdio',
      command: 'echo',
      args: ['hi'],
      enabled: true,
    });
    expect(storeState.data.servers).toEqual([
      {
        id: 'mcp-echo-1',
        name: 'Echo',
        type: 'stdio',
        command: 'echo',
        args: ['hi'],
        enabled: true,
      },
    ]);
  });

  it('does not rewrite a document when the saved server matches the normalized view', () => {
    const legacyList = ['do-not-drop'];
    storeState.data = {
      servers: {
        'tavily-mcp': {
          command: 'npx',
          args: '-y tavily-mcp@latest',
          env: ['TAVILY_API_KEY=tvly-test-key'],
        },
        mystery: null,
        'legacy-list': legacyList,
      },
    };
    const before = documentBytes();
    const viewed = mcpConfigStore.getServers()[0];
    mcpConfigStore.saveServer(viewed);
    expect(documentBytes()).toBe(before);
    expect(storeState.mutations).toEqual([]);
  });

  it('deleteServer keeps unknown entries and the original document shape', () => {
    const tavily = {
      command: 'npx',
      args: ['-y', 'tavily-mcp@latest'],
      env: { TAVILY_API_KEY: 'tvly-test-key' },
    };
    const legacyList = ['do-not-drop'];
    storeState.data = {
      mcpServers: {
        'tavily-mcp': tavily,
        'tavily-remote': {
          type: 'http',
          url: 'https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-test-key',
        },
        'mystery-plugin': 'not-a-server',
        'legacy-list': legacyList,
      },
      clientName: 'claude-desktop',
    };

    mcpConfigStore.deleteServer('mcp-tavily-remote');

    const mcpServers = storeState.data.mcpServers as Record<string, unknown>;
    expect(storeState.data.servers).toBeUndefined();
    expect(storeState.data.clientName).toBe('claude-desktop');
    expect(mcpServers['tavily-mcp']).toBe(tavily);
    expect(mcpServers['mystery-plugin']).toBe('not-a-server');
    expect(mcpServers['legacy-list']).toBe(legacyList);
    expect(mcpServers['tavily-remote']).toBeUndefined();
    expect(storeState.mutations).toEqual([{ op: 'set', key: 'mcpServers' }]);
  });

  it('deleteServer keeps unrecognized array entries and a JSON-string servers field', () => {
    const chrome = {
      id: 'mcp-chrome-1',
      name: 'Chrome',
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
      enabled: true,
    };
    const tavily = {
      name: 'tavily-mcp',
      command: 'npx',
      args: '-y tavily-mcp@latest',
    };
    storeState.data = {
      servers: JSON.stringify([chrome, null, tavily, ['keep-me']]),
    };

    mcpConfigStore.deleteServer('mcp-chrome-1');

    expect(typeof storeState.data.servers).toBe('string');
    expect(JSON.parse(storeState.data.servers as string)).toEqual([null, tavily, ['keep-me']]);
  });

  it('deleteServer on a keyed servers object removes only the targeted key', () => {
    const legacyList = ['do-not-drop'];
    storeState.data = {
      servers: {
        'tavily-mcp': {
          command: 'npx',
          args: ['-y', 'tavily-mcp@latest'],
        },
        mystery: null,
        'legacy-list': legacyList,
      },
    };

    mcpConfigStore.deleteServer('mcp-tavily-mcp');

    expect(storeState.data.servers).toEqual({
      mystery: null,
      'legacy-list': legacyList,
    });
    expect(Array.isArray(storeState.data.servers)).toBe(false);
  });

  it('saving one canonical server does not drop a null sibling or rewrite other rows', () => {
    const document = loadFixture('mcp-config-mixed-agent-installed.json');
    storeState.data = document;
    const rows = document.servers as unknown[];
    const tavily = rows[1];
    const hole = rows[2];

    const chrome = mcpConfigStore.getServers().find((server) => server.id === 'mcp-chrome-1');
    mcpConfigStore.saveServer({ ...chrome!, enabled: false });

    const servers = storeState.data.servers as unknown[];
    expect(Array.isArray(servers)).toBe(true);
    expect(servers[1]).toBe(tavily);
    expect(servers[2]).toBe(hole);
    expect(servers[0]).toMatchObject({
      id: 'mcp-chrome-1',
      name: 'Chrome',
      type: 'stdio',
      command: 'npx',
      enabled: false,
    });
  });

  it('adds a server to an mcp_servers map without renaming the field or dropping unknown keys', () => {
    storeState.data = {
      mcp_servers: {
        'tavily-mcp': {
          command: 'npx',
          args: ['-y', 'tavily-mcp@latest'],
        },
        mystery: null,
      },
    };

    mcpConfigStore.saveServer({
      id: 'mcp-echo-1',
      name: 'Echo',
      type: 'stdio',
      command: 'echo',
      args: ['hi'],
      enabled: true,
    });

    expect(storeState.data.mcpServers).toBeUndefined();
    expect(storeState.data.servers).toBeUndefined();
    expect(storeState.data.mcp_servers).toMatchObject({
      mystery: null,
      Echo: {
        id: 'mcp-echo-1',
        name: 'Echo',
        command: 'echo',
      },
    });
  });

  it('setServers replaces recognized entries without flattening mcpServers or dropping unknown ones', () => {
    const mystery = 'not-a-server';
    storeState.data = {
      mcpServers: {
        'tavily-mcp': {
          command: 'npx',
          args: ['-y', 'tavily-mcp@latest'],
        },
        'tavily-remote': {
          type: 'http',
          url: 'https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-test-key',
        },
        mystery,
      },
    };
    const tavily = mcpConfigStore.getServers().find((server) => server.name === 'tavily-mcp');
    storeState.mutations = [];

    mcpConfigStore.setServers([tavily!]);

    const mcpServers = storeState.data.mcpServers as Record<string, unknown>;
    expect(storeState.data.servers).toBeUndefined();
    expect(mcpServers.mystery).toBe(mystery);
    expect(mcpServers['tavily-remote']).toBeUndefined();
    expect(mcpServers['tavily-mcp']).toMatchObject({ command: 'npx' });
    expect(storeState.mutations.every((mutation) => mutation.op !== 'delete')).toBe(true);
  });
});
