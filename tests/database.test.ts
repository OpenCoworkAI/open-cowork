import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron app - use plain functions, not vi.fn() which gets reset
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-userdata',
    getVersion: () => '3.1.0',
  },
}));

// Track calls with arrays instead of vi.fn() to avoid mockReset issues
const runCalls: any[][] = [];
const getCalls: any[][] = [];
const allCalls: any[][] = [];
const prepareCalls: any[][] = [];
const execCalls: any[][] = [];
const pragmaCalls: any[][] = [];
let closeCalled = false;

vi.mock('better-sqlite3', () => {
  return {
    default: function() {
      return {
        prepare: (...args: any[]) => {
          prepareCalls.push(args);
          return {
            run: (...a: any[]) => { runCalls.push(a); },
            get: (...a: any[]) => { getCalls.push(a); return undefined; },
            all: (...a: any[]) => { allCalls.push(a); return []; },
          };
        },
        exec: (...args: any[]) => { execCalls.push(args); },
        pragma: (...args: any[]) => { pragmaCalls.push(args); },
        close: () => { closeCalled = true; },
      };
    },
  };
});

vi.mock('fs', () => ({
  existsSync: () => true,
  mkdirSync: () => {},
  createWriteStream: () => ({ write: () => {}, end: () => {} }),
  readdirSync: () => [],
  statSync: () => ({ size: 100, mtime: new Date() }),
  unlinkSync: () => {},
}));

import { initDatabase, getDatabase, closeDatabase } from '../src/main/db/database';

describe('database', () => {
  beforeEach(() => {
    runCalls.length = 0;
    getCalls.length = 0;
    allCalls.length = 0;
    prepareCalls.length = 0;
    execCalls.length = 0;
    pragmaCalls.length = 0;
    closeCalled = false;
    // Reset database singleton
    try { closeDatabase(); } catch { /* ignore */ }
  });

  describe('initDatabase', () => {
    it('creates and returns a database instance', () => {
      const db = initDatabase();
      expect(db).toBeDefined();
      expect(db.sessions).toBeDefined();
      expect(db.messages).toBeDefined();
      expect(db.traceSteps).toBeDefined();
    });

    it('returns same instance on subsequent calls', () => {
      const db1 = initDatabase();
      const db2 = initDatabase();
      expect(db1).toBe(db2);
    });

    it('enables foreign keys', () => {
      initDatabase();
      expect(pragmaCalls.some(c => c[0] === 'foreign_keys = ON')).toBe(true);
    });

    it('sets WAL journal mode', () => {
      initDatabase();
      expect(pragmaCalls.some(c => c[0] === 'journal_mode = WAL')).toBe(true);
    });

    it('creates all required tables', () => {
      initDatabase();
      const allExecSql = execCalls.map(c => c[0] as string);
      expect(allExecSql.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS sessions'))).toBe(true);
      expect(allExecSql.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS messages'))).toBe(true);
      expect(allExecSql.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS trace_steps'))).toBe(true);
      expect(allExecSql.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS memory_entries'))).toBe(true);
      expect(allExecSql.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS skills'))).toBe(true);
      expect(allExecSql.some(sql => sql.includes('CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts'))).toBe(true);
    });

    it('creates required indexes', () => {
      initDatabase();
      const allExecSql = execCalls.map(c => c[0] as string);
      expect(allExecSql.some(sql => sql.includes('idx_messages_session_id'))).toBe(true);
      expect(allExecSql.some(sql => sql.includes('idx_messages_timestamp'))).toBe(true);
      expect(allExecSql.some(sql => sql.includes('idx_trace_steps_session_id'))).toBe(true);
    });
  });

  describe('getDatabase', () => {
    it('throws when not initialized', () => {
      expect(() => getDatabase()).toThrow('Database not initialized');
    });

    it('returns instance after initialization', () => {
      initDatabase();
      expect(() => getDatabase()).not.toThrow();
    });
  });

  describe('closeDatabase', () => {
    it('closes without error when not initialized', () => {
      expect(() => closeDatabase()).not.toThrow();
    });

    it('closes the database connection', () => {
      initDatabase();
      closeDatabase();
      expect(closeCalled).toBe(true);
    });
  });

  describe('session CRUD', () => {
    it('creates a session', () => {
      const db = initDatabase();
      const before = runCalls.length;
      db.sessions.create({
        id: 'test-1', title: 'Test', claude_session_id: null, status: 'idle',
        cwd: null, mounted_paths: '[]', allowed_tools: '[]', memory_enabled: 0,
        created_at: Date.now(), updated_at: Date.now(),
      });
      expect(runCalls.length).toBeGreaterThan(before);
    });

    it('gets a session by id', () => {
      const db = initDatabase();
      const before = getCalls.length;
      db.sessions.get('test-id');
      expect(getCalls.length).toBeGreaterThan(before);
      expect(getCalls[getCalls.length - 1][0]).toBe('test-id');
    });

    it('gets all sessions', () => {
      const db = initDatabase();
      const before = allCalls.length;
      db.sessions.getAll();
      expect(allCalls.length).toBeGreaterThan(before);
    });

    it('deletes a session', () => {
      const db = initDatabase();
      const before = runCalls.length;
      db.sessions.delete('test-id');
      expect(runCalls.length).toBeGreaterThan(before);
      expect(runCalls[runCalls.length - 1][0]).toBe('test-id');
    });

    it('skips update when no fields provided', () => {
      const db = initDatabase();
      const before = prepareCalls.length;
      db.sessions.update('test-id', {});
      // Should not prepare a new query for empty updates
      expect(prepareCalls.length).toBe(before);
    });
  });

  describe('message CRUD', () => {
    it('creates a message', () => {
      const db = initDatabase();
      const before = runCalls.length;
      db.messages.create({
        id: 'msg-1', session_id: 'session-1', role: 'user',
        content: '[]', timestamp: Date.now(), token_usage: null,
      });
      expect(runCalls.length).toBeGreaterThan(before);
    });

    it('gets messages by session id', () => {
      const db = initDatabase();
      const before = allCalls.length;
      db.messages.getBySessionId('session-1');
      expect(allCalls.length).toBeGreaterThan(before);
      expect(allCalls[allCalls.length - 1][0]).toBe('session-1');
    });

    it('deletes messages by session id', () => {
      const db = initDatabase();
      const before = runCalls.length;
      db.messages.deleteBySessionId('session-1');
      expect(runCalls.length).toBeGreaterThan(before);
      expect(runCalls[runCalls.length - 1][0]).toBe('session-1');
    });
  });

  describe('trace step CRUD', () => {
    it('creates a trace step', () => {
      const db = initDatabase();
      const before = runCalls.length;
      db.traceSteps.create({
        id: 'step-1', session_id: 'session-1', type: 'tool_call', status: 'running',
        title: 'Test', content: null, tool_name: 'read', tool_input: null,
        tool_output: null, is_error: null, timestamp: Date.now(), duration: null,
      });
      expect(runCalls.length).toBeGreaterThan(before);
    });

    it('gets trace steps by session id', () => {
      const db = initDatabase();
      const before = allCalls.length;
      db.traceSteps.getBySessionId('session-1');
      expect(allCalls.length).toBeGreaterThan(before);
      expect(allCalls[allCalls.length - 1][0]).toBe('session-1');
    });

    it('deletes trace steps by session id', () => {
      const db = initDatabase();
      const before = runCalls.length;
      db.traceSteps.deleteBySessionId('session-1');
      expect(runCalls.length).toBeGreaterThan(before);
      expect(runCalls[runCalls.length - 1][0]).toBe('session-1');
    });
  });
});
