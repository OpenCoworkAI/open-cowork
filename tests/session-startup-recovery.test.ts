import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const paths = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => paths.userData, getVersion: () => '0.0.0' },
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-session-startup-recovery-config-store.json';

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
    // A run that never settles: the process is killed while it is in flight.
    run = vi.fn(() => new Promise<void>(() => {}));
    cancel = vi.fn();
    handleQuestionResponse = vi.fn();
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: { getEnabledServers: () => [] },
}));

import { closeDatabase, initDatabase, type SessionRow } from '../src/main/db/database';
import { SessionManager } from '../src/main/session/session-manager';

function sessionRow(id: string, status: string, updatedAt: number): SessionRow {
  return {
    id,
    title: id,
    claude_session_id: null,
    openai_thread_id: null,
    status,
    cwd: null,
    mounted_paths: '[]',
    allowed_tools: '[]',
    memory_enabled: 1,
    model: null,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

describe('sessions left running by a previous launch', () => {
  beforeEach(() => {
    paths.userData = mkdtempSync(join(tmpdir(), 'cowork-session-startup-recovery-'));
    mkdirSync(join(paths.userData, 'data'));
  });
  afterEach(() => {
    closeDatabase();
    rmSync(paths.userData, { recursive: true, force: true });
  });

  it('are idle after the next launch when the app was killed mid-run', async () => {
    const firstLaunch = initDatabase();
    const manager = new SessionManager(firstLaunch, vi.fn());
    const session = await manager.startSession('killed mid-run', 'hello', paths.userData);
    await vi.waitFor(() => expect(firstLaunch.sessions.get(session.id)?.status).toBe('running'));

    // The process dies here: no cleanup runs. The next launch reopens the same database file.
    closeDatabase();
    const secondLaunch = initDatabase();
    expect(new SessionManager(secondLaunch, vi.fn()).listSessions()[0]?.status).toBe('running');

    expect(secondLaunch.sessions.markRunningIdle()).toBe(1);

    const listed = new SessionManager(secondLaunch, vi.fn()).listSessions();
    expect(listed.map((item) => [item.id, item.status])).toEqual([[session.id, 'idle']]);
  });

  it('reset only running sessions and keep their place in the list', () => {
    const db = initDatabase();
    db.sessions.create(sessionRow('running', 'running', 300));
    db.sessions.create(sessionRow('idle', 'idle', 200));
    db.sessions.create(sessionRow('failed', 'error', 100));

    expect(db.sessions.markRunningIdle()).toBe(1);

    expect(db.sessions.getAll().map((row) => [row.id, row.status, row.updated_at])).toEqual([
      ['running', 'idle', 300],
      ['idle', 'idle', 200],
      ['failed', 'error', 100],
    ]);
    expect(db.sessions.markRunningIdle()).toBe(0);
  });
});
