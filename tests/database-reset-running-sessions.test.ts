import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const paths = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => paths.userData } }));
vi.mock('../src/main/utils/logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));

import { closeDatabase, initDatabase } from '../src/main/db/database';
import type { SessionRow } from '../src/main/db/database';

function makeSession(id: string, status: string): SessionRow {
  return {
    id,
    title: id,
    claude_session_id: null,
    openai_thread_id: null,
    status,
    cwd: '/tmp/workspace',
    mounted_paths: '[]',
    allowed_tools: '[]',
    memory_enabled: 0,
    model: null,
    created_at: 1000,
    updated_at: 1000,
  };
}

beforeEach(() => {
  paths.userData = mkdtempSync(join(tmpdir(), 'cowork-db-'));
  mkdirSync(join(paths.userData, 'data'));
});
afterEach(() => {
  closeDatabase();
  rmSync(paths.userData, { recursive: true, force: true });
});

describe('database startup reconciliation', () => {
  it('leaves recovery to the startup owner instead of resetting on database open', () => {
    const first = initDatabase();
    first.sessions.create(makeSession('interrupted', 'running'));
    first.sessions.create(makeSession('idle-session', 'idle'));
    first.sessions.create(makeSession('completed-session', 'completed'));
    closeDatabase();

    const reopened = initDatabase();
    expect(reopened.sessions.get('interrupted')?.status).toBe('running');
    expect(reopened.sessions.markRunningIdle()).toBe(1);
    expect(reopened.sessions.get('interrupted')?.status).toBe('idle');
    expect(reopened.sessions.get('idle-session')?.status).toBe('idle');
    expect(reopened.sessions.get('completed-session')?.status).toBe('completed');
  });

  it('does not reset a live session when another instance opens the same database', async () => {
    const owner = initDatabase();
    owner.sessions.create(makeSession('active-in-owner', 'running'));
    // A fresh module models another process, with its own database singleton.
    vi.resetModules();
    const otherInstance = await import('../src/main/db/database');
    try {
      const other = otherInstance.initDatabase();
      expect(other.sessions.get('active-in-owner')?.status).toBe('running');
      expect(owner.sessions.get('active-in-owner')?.status).toBe('running');
    } finally {
      otherInstance.closeDatabase();
    }
  });
});

describe('sessions.update updated_at', () => {
  it('honors an explicitly provided updated_at instead of overwriting it', () => {
    const db = initDatabase();
    db.sessions.create(makeSession('s1', 'idle'));

    db.sessions.update('s1', { status: 'running', updated_at: 424242 });

    expect(db.sessions.get('s1')?.updated_at).toBe(424242);
  });

  it('defaults updated_at to now when the caller omits it', () => {
    const db = initDatabase();
    db.sessions.create(makeSession('s2', 'idle'));

    db.sessions.update('s2', { status: 'running' });

    expect(db.sessions.get('s2')?.updated_at ?? 0).toBeGreaterThan(1000);
  });
});
