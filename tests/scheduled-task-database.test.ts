import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTaskRow } from '../src/main/db/database';

interface SchemaColumn {
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: string | null;
}

interface WatchStateRow {
  readonly watch_config: string | null;
  readonly last_state: string | null;
  readonly last_checked_at: number | null;
  readonly consecutive_unchanged: number;
}

let testRoot = '';
let databaseModule: typeof import('../src/main/db/database') | null = null;

function mockElectron(userDataPath: string): void {
  vi.doMock('electron', () => ({
    app: {
      getPath: () => userDataPath,
    },
  }));
}

function mockLogger(): void {
  vi.doMock('../src/main/utils/logger', () => ({
    log: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
  }));
}

async function loadDatabaseModule(
  userDataPath: string
): Promise<typeof import('../src/main/db/database')> {
  vi.resetModules();
  mockElectron(userDataPath);
  mockLogger();
  databaseModule = await import('../src/main/db/database');
  return databaseModule;
}

function databasePath(userDataPath: string): string {
  return path.join(userDataPath, 'data', 'cowork.db');
}

function createLegacyScheduledTaskDatabase(userDataPath: string): void {
  const dbDirectory = path.join(userDataPath, 'data');
  fs.mkdirSync(dbDirectory, { recursive: true });

  const legacyDatabase = new Database(databasePath(userDataPath));
  legacyDatabase.exec(`
    CREATE TABLE scheduled_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cwd TEXT NOT NULL,
      run_at INTEGER NOT NULL,
      next_run_at INTEGER,
      schedule_config TEXT,
      repeat_every INTEGER,
      repeat_unit TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      last_run_session_id TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  legacyDatabase
    .prepare(
      `
    INSERT INTO scheduled_tasks (
      id, title, prompt, cwd, run_at, next_run_at, schedule_config, repeat_every, repeat_unit,
      enabled, last_run_at, last_run_session_id, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      'legacy-task',
      'Legacy task',
      'Legacy prompt',
      '/legacy/cwd',
      100,
      200,
      '{"kind":"legacy"}',
      5,
      'minutes',
      1,
      50,
      'legacy-session',
      'legacy-error',
      10,
      20
    );
  legacyDatabase.close();
}

function getWatchColumns(database: Database.Database): SchemaColumn[] {
  return database
    .prepare<[], SchemaColumn>('PRAGMA table_info(scheduled_tasks)')
    .all()
    .filter((column) =>
      ['watch_config', 'last_state', 'last_checked_at', 'consecutive_unchanged'].includes(
        column.name
      )
    )
    .map((column) => ({
      name: column.name,
      type: column.type,
      notnull: column.notnull,
      dflt_value: column.dflt_value,
    }));
}

function createScheduledTask(): ScheduledTaskRow {
  return {
    id: 'watch-task',
    title: 'Watch task',
    prompt: 'Observe the endpoint',
    cwd: '/watch/cwd',
    run_at: 1_000,
    next_run_at: 2_000,
    schedule_config: '{"kind":"interval"}',
    repeat_every: 60,
    repeat_unit: 'seconds',
    enabled: 1,
    last_run_at: 900,
    last_run_session_id: 'watch-session',
    last_error: null,
    created_at: 100,
    updated_at: 200,
    watch_config: '{"checkType":"http"}',
    last_state: 'state-one',
    last_checked_at: 1_500,
    consecutive_unchanged: 4,
  };
}

describe('scheduled task database watch columns', () => {
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-scheduled-task-db-test-'));
  });

  afterEach(() => {
    databaseModule?.closeDatabase();
    databaseModule = null;
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock('electron');
    vi.doUnmock('../src/main/utils/logger');

    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('creates watch columns with the approved definitions for a fresh database', async () => {
    const userDataPath = path.join(testRoot, 'userData');
    const database = await loadDatabaseModule(userDataPath);

    const instance = database.initDatabase();

    expect(getWatchColumns(instance.raw)).toEqual([
      { name: 'watch_config', type: 'TEXT', notnull: 0, dflt_value: null },
      { name: 'last_state', type: 'TEXT', notnull: 0, dflt_value: null },
      { name: 'last_checked_at', type: 'INTEGER', notnull: 0, dflt_value: null },
      { name: 'consecutive_unchanged', type: 'INTEGER', notnull: 1, dflt_value: '0' },
    ]);
  });

  it('migrates an old row with exact defaults while preserving legacy fields', async () => {
    const userDataPath = path.join(testRoot, 'userData');
    createLegacyScheduledTaskDatabase(userDataPath);
    const database = await loadDatabaseModule(userDataPath);

    const instance = database.initDatabase();
    const migrated = instance.scheduledTasks.get('legacy-task');
    const watchState = instance.raw
      .prepare<[string], WatchStateRow>(
        `
      SELECT watch_config, last_state, last_checked_at, consecutive_unchanged
      FROM scheduled_tasks
      WHERE id = ?
    `
      )
      .get('legacy-task');

    expect(migrated).toMatchObject({
      id: 'legacy-task',
      title: 'Legacy task',
      prompt: 'Legacy prompt',
      cwd: '/legacy/cwd',
      run_at: 100,
      next_run_at: 200,
      schedule_config: '{"kind":"legacy"}',
      repeat_every: 5,
      repeat_unit: 'minutes',
      enabled: 1,
      last_run_at: 50,
      last_run_session_id: 'legacy-session',
      last_error: 'legacy-error',
      created_at: 10,
      updated_at: 20,
    });
    expect(watchState).toEqual({
      watch_config: null,
      last_state: null,
      last_checked_at: null,
      consecutive_unchanged: 0,
    });
  });

  it('round-trips every watch field through create, update, get, list, and delete', async () => {
    const userDataPath = path.join(testRoot, 'userData');
    const database = await loadDatabaseModule(userDataPath);
    const instance = database.initDatabase();
    const task = createScheduledTask();

    instance.scheduledTasks.create(task);

    expect(instance.scheduledTasks.get(task.id)).toMatchObject(task);
    expect(instance.scheduledTasks.getAll()).toEqual([expect.objectContaining(task)]);

    instance.scheduledTasks.update(task.id, {
      watch_config: '{"checkType":"http","compareMode":"status"}',
      last_state: 'state-two',
      last_checked_at: 2_500,
      consecutive_unchanged: 0,
    });

    expect(instance.scheduledTasks.get(task.id)).toMatchObject({
      watch_config: '{"checkType":"http","compareMode":"status"}',
      last_state: 'state-two',
      last_checked_at: 2_500,
      consecutive_unchanged: 0,
    });

    instance.scheduledTasks.delete(task.id);

    expect(instance.scheduledTasks.get(task.id)).toBeUndefined();
    expect(instance.scheduledTasks.getAll()).toEqual([]);
  });

  it('initializes a migrated database again after closing the singleton', async () => {
    const userDataPath = path.join(testRoot, 'userData');
    createLegacyScheduledTaskDatabase(userDataPath);
    const database = await loadDatabaseModule(userDataPath);

    const first = database.initDatabase();
    first.close();
    const second = database.initDatabase();

    expect(getWatchColumns(second.raw)).toEqual([
      { name: 'watch_config', type: 'TEXT', notnull: 0, dflt_value: null },
      { name: 'last_state', type: 'TEXT', notnull: 0, dflt_value: null },
      { name: 'last_checked_at', type: 'INTEGER', notnull: 0, dflt_value: null },
      { name: 'consecutive_unchanged', type: 'INTEGER', notnull: 1, dflt_value: '0' },
    ]);
    expect(second.scheduledTasks.get('legacy-task')).toMatchObject({
      id: 'legacy-task',
      title: 'Legacy task',
      prompt: 'Legacy prompt',
    });
  });
});
