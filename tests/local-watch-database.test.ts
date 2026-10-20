import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const paths = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => paths.userData } }));
vi.mock('../src/main/utils/logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));

import { closeDatabase, initDatabase } from '../src/main/db/database';
import { createScheduledTaskStore } from '../src/main/schedule/scheduled-task-store';

describe('conditional task SQLite migration', () => {
  beforeEach(() => {
    paths.userData = mkdtempSync(join(tmpdir(), 'cowork-watch-database-'));
    mkdirSync(join(paths.userData, 'data'));
  });
  afterEach(() => {
    closeDatabase();
    rmSync(paths.userData, { recursive: true, force: true });
  });

  it('preserves old tasks and round-trips observations after reopening the real database', () => {
    const legacy = new Database(join(paths.userData, 'data', 'cowork.db'));
    legacy.exec(`CREATE TABLE scheduled_tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, prompt TEXT NOT NULL, cwd TEXT NOT NULL,
      run_at INTEGER NOT NULL, next_run_at INTEGER, schedule_config TEXT,
      repeat_every INTEGER, repeat_unit TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER, last_run_session_id TEXT, last_error TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    ); INSERT INTO scheduled_tasks (id, title, prompt, cwd, run_at, created_at, updated_at)
       VALUES ('legacy', 'legacy', 'original prompt', '/tmp', 100, 100, 100);`);
    legacy.close();
    const store = createScheduledTaskStore(initDatabase());
    expect(store.get('legacy')).toMatchObject({
      prompt: 'original prompt',
      watchConfig: null,
      lastState: null,
      consecutiveUnchanged: 0,
    });
    const watchConfig = {
      checkType: 'file' as const,
      compareMode: 'content' as const,
      checkConfig: { path: './watched.txt' },
    };
    const task = store.create({ prompt: 'react', cwd: '/tmp', runAt: 100, watchConfig });
    store.update(task.id, {
      lastState: 'file:observed',
      lastCheckedAt: 101,
      consecutiveUnchanged: 2,
    });
    closeDatabase();
    const reopened = createScheduledTaskStore(initDatabase());
    expect(reopened.get(task.id)).toMatchObject({
      watchConfig,
      lastState: 'file:observed',
      lastCheckedAt: 101,
      consecutiveUnchanged: 2,
    });
    expect(reopened.get('legacy')?.prompt).toBe('original prompt');
  });
});
