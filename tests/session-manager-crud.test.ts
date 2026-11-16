import { describe, expect, it, vi } from 'vitest';
import type { DatabaseInstance } from '../src/main/db/database';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-session-manager-crud-config-store.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...(options?.defaults || {}) };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = { ...this.store, ...key };
    }
  }
  return { default: MockStore };
});

vi.mock('../src/main/agent/agent-runner', () => ({
  CoworkAgentRunner: class {
    run = vi.fn();
    cancel = vi.fn();
    handleQuestionResponse = vi.fn();
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getEnabledServers: () => [],
  },
}));

import { SessionManager } from '../src/main/session/session-manager';

// Shared minimal DB factory used across tests
function makeDb(overrides: Partial<DatabaseInstance> = {}): DatabaseInstance {
  return {
    sessions: {
      create: vi.fn(),
      get: vi.fn(() => null),
      getAll: vi.fn(() => []),
      update: vi.fn(),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn(),
      getBySessionId: vi.fn(() => []),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
    },
    ...overrides,
  } as unknown as DatabaseInstance;
}

// ------------------------------------------------------------------
// listSessions
// ------------------------------------------------------------------
describe('SessionManager.listSessions', () => {
  it('returns empty array when database is empty', () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    expect(manager.listSessions()).toEqual([]);
    expect(db.sessions.getAll).toHaveBeenCalledTimes(1);
  });

  it('maps database rows to Session objects', () => {
    const row = {
      id: 's1',
      title: 'My Session',
      claude_session_id: null,
      openai_thread_id: null,
      status: 'idle',
      cwd: '/tmp/workspace',
      mounted_paths: JSON.stringify([{ virtual: '/mnt/workspace', real: '/tmp/workspace' }]),
      allowed_tools: JSON.stringify(['read', 'write']),
      memory_enabled: 0,
      model: 'claude-3-5-sonnet',
      created_at: 1000,
      updated_at: 2000,
    };
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => null),
        getAll: vi.fn(() => [row]),
        update: vi.fn(),
        delete: vi.fn(),
      } as unknown,
    });

    const manager = new SessionManager(db, vi.fn());
    const sessions = manager.listSessions();

    expect(sessions).toHaveLength(1);
    const s = sessions[0];
    expect(s.id).toBe('s1');
    expect(s.title).toBe('My Session');
    expect(s.cwd).toBe('/tmp/workspace');
    expect(s.mountedPaths).toEqual([{ virtual: '/mnt/workspace', real: '/tmp/workspace' }]);
    expect(s.allowedTools).toEqual(['read', 'write']);
    expect(s.memoryEnabled).toBe(false);
    expect(s.model).toBe('claude-3-5-sonnet');
    expect(s.createdAt).toBe(1000);
    expect(s.updatedAt).toBe(2000);
  });

  it('falls back to empty arrays when mounted_paths or allowed_tools JSON is malformed', () => {
    const row = {
      id: 's2',
      title: 'Broken JSON',
      claude_session_id: null,
      openai_thread_id: null,
      status: 'idle',
      cwd: null,
      mounted_paths: '{{{broken',
      allowed_tools: '[unclosed',
      memory_enabled: 0,
      model: null,
      created_at: 1,
      updated_at: 1,
    };
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => null),
        getAll: vi.fn(() => [row]),
        update: vi.fn(),
        delete: vi.fn(),
      } as unknown,
    });

    const manager = new SessionManager(db, vi.fn());
    const [s] = manager.listSessions();

    expect(s.mountedPaths).toEqual([]);
    expect(s.allowedTools).toEqual([]);
  });
});

// ------------------------------------------------------------------
// getMessages — content normalization
// ------------------------------------------------------------------
describe('SessionManager.getMessages content normalization', () => {
  it('parses a JSON array content correctly', () => {
    const db = makeDb({
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm1',
            session_id: 's1',
            role: 'user',
            content: JSON.stringify([{ type: 'text', text: 'hello' }]),
            timestamp: 1,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as unknown,
    });

    const manager = new SessionManager(db, vi.fn());
    const messages = manager.getMessages('s1');

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('wraps a single JSON object content in an array', () => {
    const db = makeDb({
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm2',
            session_id: 's1',
            role: 'user',
            content: JSON.stringify({ type: 'text', text: 'single block' }),
            timestamp: 2,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as unknown,
    });

    const manager = new SessionManager(db, vi.fn());
    const [msg] = manager.getMessages('s1');
    expect(msg.content).toEqual([{ type: 'text', text: 'single block' }]);
  });

  it('wraps a plain JSON string as a text content block', () => {
    const db = makeDb({
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm3',
            session_id: 's1',
            role: 'assistant',
            content: JSON.stringify('plain string content'),
            timestamp: 3,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as unknown,
    });

    const manager = new SessionManager(db, vi.fn());
    const [msg] = manager.getMessages('s1');
    expect(msg.content).toEqual([{ type: 'text', text: 'plain string content' }]);
  });

  it('falls back to raw string as text block when JSON parse fails', () => {
    const db = makeDb({
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm4',
            session_id: 's1',
            role: 'assistant',
            content: 'not valid json {{{',
            timestamp: 4,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as unknown,
    });

    const manager = new SessionManager(db, vi.fn());
    const [msg] = manager.getMessages('s1');
    expect(msg.content).toEqual([{ type: 'text', text: 'not valid json {{{' }]);
  });
});

// ------------------------------------------------------------------
// handlePermissionResponse
// ------------------------------------------------------------------
describe('SessionManager.handlePermissionResponse', () => {
  it('resolves the pending permission promise with the given result', async () => {
    const db = makeDb();
    const sendToRenderer = vi.fn();
    const manager = new SessionManager(db, sendToRenderer);

    // Inject a fake pending permission via requestPermission
    const permissionPromise = manager.requestPermission('s1', 'tool-1', 'bash', { command: 'ls' });

    // Synchronously resolve it
    manager.handlePermissionResponse('tool-1', 'allow');

    const result = await permissionPromise;
    expect(result).toBe('allow');
  });

  it('is a no-op when the toolUseId is unknown', () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    // Should not throw
    expect(() => manager.handlePermissionResponse('nonexistent', 'deny')).not.toThrow();
  });
});

// ------------------------------------------------------------------
// handleSudoPasswordResponse
// ------------------------------------------------------------------
describe('SessionManager.handleSudoPasswordResponse', () => {
  it('resolves the pending sudo password promise with the given password', async () => {
    const db = makeDb();
    const sendToRenderer = vi.fn();
    const manager = new SessionManager(db, sendToRenderer);

    const sudoPromise = manager.requestSudoPassword('s1', 'tool-2', 'sudo apt-get update');

    manager.handleSudoPasswordResponse('tool-2', 'secret123');

    const password = await sudoPromise;
    expect(password).toBe('secret123');
  });

  it('is a no-op when the toolUseId is unknown', () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    expect(() => manager.handleSudoPasswordResponse('nonexistent', 'pw')).not.toThrow();
  });
});

// ------------------------------------------------------------------
// deleteSession — cache eviction
// ------------------------------------------------------------------
describe('SessionManager.deleteSession cache eviction', () => {
  it('evicts the message cache when a session is deleted', async () => {
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => null),
        getAll: vi.fn(() => []),
        update: vi.fn(),
        delete: vi.fn(),
      } as unknown,
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm1',
            session_id: 's1',
            role: 'user',
            content: JSON.stringify([{ type: 'text', text: 'hi' }]),
            timestamp: 1,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as unknown,
    });

    const manager = new SessionManager(db, vi.fn());

    // Populate the cache
    manager.getMessages('s1');
    expect(db.messages.getBySessionId).toHaveBeenCalledTimes(1);

    // Delete the session (mocked: no real DB changes)
    await manager.deleteSession('s1');

    // Cache should have been evicted — DB should be hit again on next call
    manager.getMessages('s1');
    expect(db.messages.getBySessionId).toHaveBeenCalledTimes(2);
  });
});

// ------------------------------------------------------------------
// renameSession
// ------------------------------------------------------------------
describe('SessionManager.renameSession', () => {
  function makeSessionDb(existing: { id: string; title: string } | null) {
    return makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => existing),
        getAll: vi.fn(() => []),
        update: vi.fn(),
        delete: vi.fn(),
      } as unknown,
    });
  }

  it('stores the trimmed title and tells the renderer', () => {
    const db = makeSessionDb({ id: 's1', title: 'Old title' });
    const sendToRenderer = vi.fn();
    const manager = new SessionManager(db, sendToRenderer);

    manager.renameSession('s1', '  Quarterly plan  ');

    expect(db.sessions.update).toHaveBeenCalledWith('s1', { title: 'Quarterly plan' });
    expect(sendToRenderer).toHaveBeenCalledWith({
      type: 'session.update',
      payload: { sessionId: 's1', updates: { title: 'Quarterly plan' } },
    });
  });

  it('rejects a blank title', () => {
    const db = makeSessionDb({ id: 's1', title: 'Old title' });
    const manager = new SessionManager(db, vi.fn());

    expect(() => manager.renameSession('s1', '   ')).toThrow('Session title cannot be empty');
    expect(db.sessions.update).not.toHaveBeenCalled();
  });

  it('rejects a title over the length limit or of the wrong type', () => {
    const db = makeSessionDb({ id: 's1', title: 'Old title' });
    const manager = new SessionManager(db, vi.fn());

    expect(() => manager.renameSession('s1', 'x'.repeat(201))).toThrow(
      'Session title cannot exceed 200 characters'
    );
    expect(() => manager.renameSession('s1', 42 as unknown as string)).toThrow(
      'Session title cannot be empty'
    );
    manager.renameSession('s1', 'x'.repeat(200));
    expect(db.sessions.update).toHaveBeenCalledTimes(1);
  });

  it('rejects a deleted session', () => {
    const db = makeSessionDb(null);
    const sendToRenderer = vi.fn();
    const manager = new SessionManager(db, sendToRenderer);

    expect(() => manager.renameSession('gone', 'New title')).toThrow('Session not found: gone');
    expect(db.sessions.update).not.toHaveBeenCalled();
    expect(sendToRenderer).not.toHaveBeenCalled();
  });
});
