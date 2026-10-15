import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseInstance, TraceStepRow } from '../src/main/db/database';

const state = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: () => state.userData,
    getVersion: () => '0.0.0-test',
  },
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

function traceRow(overrides: Partial<TraceStepRow>): TraceStepRow {
  return {
    id: 'step-1',
    session_id: 's1',
    type: 'memory',
    status: 'completed',
    title: 'Memory used',
    content: null,
    tool_name: null,
    tool_input: null,
    tool_output: null,
    is_error: null,
    memory_items: null,
    timestamp: 5,
    duration: null,
    ...overrides,
  };
}

function createSession(db: DatabaseInstance): void {
  db.sessions.create({
    id: 's1',
    title: 'Session',
    claude_session_id: null,
    openai_thread_id: null,
    status: 'idle',
    cwd: null,
    mounted_paths: '[]',
    allowed_tools: '[]',
    memory_enabled: 1,
    model: null,
    created_at: 1,
    updated_at: 1,
  });
}

describe('trace_steps.memory_items', () => {
  let closeDatabase: () => void;

  beforeEach(() => {
    state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-trace-'));
    vi.resetModules();
  });

  afterEach(() => {
    closeDatabase?.();
    fs.rmSync(state.userData, { recursive: true, force: true });
  });

  it('saves and returns the memory items of a trace step', async () => {
    const database = await import('../src/main/db/database');
    closeDatabase = database.closeDatabase;
    const db = database.initDatabase();
    createSession(db);
    const items = JSON.stringify([
      { scope: 'core', key: 'name', value: 'Jack', userWritten: true },
    ]);

    db.traceSteps.create(traceRow({ id: 'memory-1', memory_items: items, timestamp: 1 }));
    db.traceSteps.create(traceRow({ id: 'thinking-1', type: 'thinking', timestamp: 2 }));

    const rows = db.traceSteps.getBySessionId('s1');
    expect(rows.map((row) => [row.id, row.memory_items])).toEqual([
      ['memory-1', items],
      ['thinking-1', null],
    ]);
  });

  it('adds the column to a database created before it existed and keeps old steps', async () => {
    const dataDir = path.join(state.userData, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const legacy = new Database(path.join(dataDir, 'cowork.db'));
    legacy.exec(`
      CREATE TABLE trace_steps (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        tool_name TEXT,
        tool_input TEXT,
        tool_output TEXT,
        is_error INTEGER,
        timestamp INTEGER NOT NULL,
        duration INTEGER
      );
      INSERT INTO trace_steps (id, session_id, type, status, title, timestamp)
      VALUES ('old-step', 's1', 'thinking', 'completed', 'Thinking', 1);
    `);
    legacy.close();

    const database = await import('../src/main/db/database');
    closeDatabase = database.closeDatabase;
    const db = database.initDatabase();

    expect(db.traceSteps.getBySessionId('s1')).toEqual([
      expect.objectContaining({ id: 'old-step', memory_items: null }),
    ]);
    createSession(db);
    db.traceSteps.create(traceRow({ id: 'memory-1', memory_items: '[]', timestamp: 2 }));
    expect(db.traceSteps.getBySessionId('s1').map((row) => row.memory_items)).toEqual([null, '[]']);
  });
});
