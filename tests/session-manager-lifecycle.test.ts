import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron modules
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-userdata',
    getVersion: () => '3.1.0',
  },
}));

vi.mock('better-sqlite3', () => ({
  default: function() {
    return {
      prepare: () => ({ run: () => {}, get: () => undefined, all: () => [] }),
      exec: () => {},
      pragma: () => {},
      close: () => {},
    };
  },
}));

// electron-store mock must be a proper constructor
vi.mock('electron-store', () => {
  class MockStore {
    private data: Record<string, unknown> = {};
    constructor(opts?: any) {
      if (opts?.defaults) {
        this.data = { ...opts.defaults };
      }
    }
    get(key: string) { return this.data[key] ?? ''; }
    set(key: string, value: unknown) { this.data[key] = value; }
    clear() { this.data = {}; }
    get path() { return '/tmp/config.json'; }
  }
  return { default: MockStore };
});

vi.mock('fs', () => ({
  existsSync: () => true,
  mkdirSync: () => {},
  readFileSync: () => '',
  writeFileSync: () => {},
  copyFileSync: () => {},
  statSync: () => ({ size: 100 }),
  readdirSync: () => [],
  createWriteStream: () => ({ write: () => {}, end: () => {} }),
  unlinkSync: () => {},
}));

// Mock OpenAI and Anthropic
vi.mock('openai', () => ({
  default: function() { return {}; },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  Anthropic: function() { return {}; },
}));

// Mock session-manager dependencies
vi.mock('../src/main/sandbox/path-resolver', () => ({
  PathResolver: function() {
    return { resolve: () => {} };
  },
}));

vi.mock('../src/main/sandbox/sandbox-adapter', () => ({
  getSandboxAdapter: () => ({ mode: 'native', initialized: true }),
  initializeSandbox: () => Promise.resolve(undefined),
  reinitializeSandbox: () => Promise.resolve(undefined),
}));

vi.mock('../src/main/sandbox/sandbox-sync', () => ({
  SandboxSync: {
    clearSession: () => {},
    hasSession: () => false,
    getSandboxPath: () => null,
    syncAndCleanup: () => Promise.resolve(undefined),
    cleanupAllSessions: () => Promise.resolve(undefined),
  },
}));

vi.mock('../src/main/sandbox/lima-sync', () => ({
  LimaSync: {
    clearSession: () => {},
    getSandboxPath: () => null,
    cleanupAllSessions: () => Promise.resolve(undefined),
  },
}));

vi.mock('../src/main/mcp/mcp-manager', () => ({
  MCPManager: function() {
    return {
      initializeServers: () => Promise.resolve(undefined),
      getTools: () => [],
      getServerStatus: () => [],
    };
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getEnabledServers: () => [],
    getServers: () => [],
  },
}));

vi.mock('../src/main/claude/agent-runner', () => ({
  ClaudeAgentRunner: function() {
    return {
      run: () => Promise.resolve(undefined),
      cancel: () => {},
      handleQuestionResponse: () => {},
      clearSdkSession: () => {},
    };
  },
}));

vi.mock('../src/main/openai/responses-runner', () => ({
  OpenAIResponsesRunner: function() {
    return {
      run: () => Promise.resolve(undefined),
      cancel: () => {},
      handleQuestionResponse: () => {},
    };
  },
}));

vi.mock('../src/main/session/session-title-flow', () => ({
  maybeGenerateSessionTitle: () => Promise.resolve(undefined),
}));

import { SessionManager } from '../src/main/session/session-manager';
import type { DatabaseInstance } from '../src/main/db/database';

function createMockDb(): DatabaseInstance {
  return {
    raw: {} as any,
    sessions: {
      create: vi.fn(),
      update: vi.fn(),
      get: vi.fn().mockReturnValue({
        id: 'session-1',
        title: 'Test Session',
        claude_session_id: null,
        status: 'idle',
        cwd: '/tmp/workspace',
        mounted_paths: '[]',
        allowed_tools: '[]',
        memory_enabled: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
      }),
      getAll: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn(),
      getBySessionId: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn().mockReturnValue([]),
      deleteBySessionId: vi.fn(),
    },
    prepare: () => ({ run: () => {}, get: () => undefined, all: () => [] }),
    exec: () => {},
    pragma: () => {},
    close: () => {},
  };
}

describe('SessionManager', () => {
  let db: DatabaseInstance;
  let sendToRenderer: ReturnType<typeof vi.fn>;
  let manager: SessionManager;

  beforeEach(() => {
    db = createMockDb();
    sendToRenderer = vi.fn();
    manager = new SessionManager(db, sendToRenderer);
  });

  describe('startSession', () => {
    it('creates a new session and saves to database', async () => {
      const session = await manager.startSession('Test Session', 'Hello', '/tmp/workspace');
      expect(session.id).toBeDefined();
      expect(session.title).toBe('Test Session');
      expect(session.cwd).toBe('/tmp/workspace');
      expect(session.status).toBe('idle');
      expect(db.sessions.create).toHaveBeenCalled();
    });

    it('uses default tools when not specified', async () => {
      const session = await manager.startSession('Test', 'Hi');
      expect(session.allowedTools).toContain('read');
      expect(session.allowedTools).toContain('write');
      expect(session.allowedTools).toContain('edit');
    });

    it('uses custom tools when specified', async () => {
      const session = await manager.startSession('Test', 'Hi', undefined, ['read', 'write']);
      expect(session.allowedTools).toEqual(['read', 'write']);
    });
  });

  describe('continueSession', () => {
    it('throws error for non-existent session', async () => {
      (db.sessions.get as any).mockReturnValue(undefined);
      await expect(manager.continueSession('non-existent', 'Hello')).rejects.toThrow('Session not found');
    });
  });

  describe('stopSession', () => {
    it('stops a session without error', () => {
      expect(() => manager.stopSession('session-1')).not.toThrow();
    });
  });

  describe('deleteSession', () => {
    it('deletes a session from database', async () => {
      await manager.deleteSession('session-1');
      expect(db.sessions.delete).toHaveBeenCalledWith('session-1');
    });
  });

  describe('listSessions', () => {
    it('returns empty array when no sessions', () => {
      expect(manager.listSessions()).toEqual([]);
    });

    it('returns parsed sessions from database', () => {
      (db.sessions.getAll as any).mockReturnValue([
        {
          id: 's1', title: 'Session 1', claude_session_id: null, status: 'idle',
          cwd: '/tmp', mounted_paths: '[]', allowed_tools: '["read"]',
          memory_enabled: 0, created_at: 1000, updated_at: 2000,
        },
      ]);

      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('s1');
      expect(sessions[0].allowedTools).toEqual(['read']);
    });
  });

  describe('getMessages', () => {
    it('returns empty array when no messages', () => {
      expect(manager.getMessages('session-1')).toEqual([]);
    });

    it('normalizes message content from JSON', () => {
      (db.messages.getBySessionId as any).mockReturnValue([
        {
          id: 'msg-1', session_id: 'session-1', role: 'user',
          content: JSON.stringify([{ type: 'text', text: 'Hello' }]),
          timestamp: 1000, token_usage: null,
        },
      ]);

      const messages = manager.getMessages('session-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toEqual([{ type: 'text', text: 'Hello' }]);
    });

    it('handles malformed JSON content gracefully', () => {
      (db.messages.getBySessionId as any).mockReturnValue([
        {
          id: 'msg-1', session_id: 'session-1', role: 'user',
          content: 'not valid json {{{',
          timestamp: 1000, token_usage: null,
        },
      ]);

      const messages = manager.getMessages('session-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].content[0].type).toBe('text');
      expect((messages[0].content[0] as any).text).toBe('not valid json {{{');
    });
  });

  describe('handlePermissionResponse', () => {
    it('resolves pending permission', () => {
      const resolver = vi.fn();
      (manager as any).pendingPermissions.set('tool-1', resolver);
      manager.handlePermissionResponse('tool-1', 'allow');
      expect(resolver).toHaveBeenCalledWith('allow');
    });

    it('does not throw for unknown permission', () => {
      expect(() => manager.handlePermissionResponse('unknown', 'allow')).not.toThrow();
    });
  });

  describe('updateSessionCwd', () => {
    it('updates cwd and clears SDK session', () => {
      manager.updateSessionCwd('session-1', '/new/path');
      expect(db.sessions.update).toHaveBeenCalledWith('session-1', expect.objectContaining({
        cwd: '/new/path',
        claude_session_id: null,
      }));
    });
  });

  describe('reloadConfig', () => {
    it('reloads config without error', () => {
      expect(() => manager.reloadConfig()).not.toThrow();
    });
  });

  describe('getMCPManager', () => {
    it('returns the MCP manager instance', () => {
      expect(manager.getMCPManager()).toBeDefined();
    });
  });
});
