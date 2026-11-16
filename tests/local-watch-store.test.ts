import { describe, expect, it } from 'vitest';
import { ScheduledTaskManager } from '../src/main/schedule/scheduled-task-manager';
import { watchConfigForTaskUpdate } from '../src/shared/schedule/watch-config-update';
import { createScheduledTaskStore } from '../src/main/schedule/scheduled-task-store';
import type { ScheduledTaskRow } from '../src/main/db/database';
import type { LocalWatchConfig } from '../src/shared/schedule/local-watch-task';

function createDatabase() {
  const rows = new Map<string, ScheduledTaskRow>();
  return {
    rows,
    scheduledTasks: {
      getAll: () => [...rows.values()],
      get: (id: string) => rows.get(id),
      create: (row: ScheduledTaskRow) => {
        rows.set(row.id, row);
      },
      update: (id: string, updates: Partial<ScheduledTaskRow>) => {
        const row = rows.get(id);
        if (row) rows.set(id, { ...row, ...updates });
      },
      delete: (id: string) => {
        rows.delete(id);
      },
    },
  };
}

const watchConfig: LocalWatchConfig = {
  checkType: 'file',
  compareMode: 'content',
  checkConfig: { path: './watch.txt' },
};

describe('conditional task persistence', () => {
  it('round-trips configuration and observations across store instances', () => {
    const database = createDatabase();
    const first = createScheduledTaskStore(database);
    const task = first.create({ prompt: 'react', cwd: '/tmp', runAt: 100, watchConfig });
    first.update(task.id, {
      lastState: 'file:observed',
      lastCheckedAt: 101,
      consecutiveUnchanged: 2,
    });
    const reopened = createScheduledTaskStore(database).get(task.id)!;
    expect(reopened.watchConfig).toEqual(watchConfig);
    expect(reopened.lastState).toBe('file:observed');
    expect(reopened.lastCheckedAt).toBe(101);
    expect(reopened.consecutiveUnchanged).toBe(2);
    first.update(task.id, { watchConfig: null, lastState: null });
    expect(database.rows.get(task.id)!.watch_config).toBeNull();
  });

  it('surfaces malformed persisted data without replacing or executing it', () => {
    const database = createDatabase();
    const store = createScheduledTaskStore(database);
    const task = store.create({ prompt: 'react', cwd: '/tmp', runAt: 100 });
    for (const raw of [
      'broken JSON',
      '{"checkType":"http"}',
      JSON.stringify({ ...watchConfig, checkConfig: { path: '' } }),
    ]) {
      database.scheduledTasks.update(task.id, { watch_config: raw });
      const loaded = store.get(task.id)!;
      expect(loaded.watchConfig).toBeNull();
      expect(loaded.watchConfigError).toBeTruthy();
      expect(database.rows.get(task.id)!.watch_config).toBe(raw);
    }
  });

  it('reads legacy rows as ordinary tasks', () => {
    const database = createDatabase();
    const store = createScheduledTaskStore(database);
    const task = store.create({ prompt: 'ordinary', cwd: '/tmp', runAt: 100 });
    const row = database.rows.get(task.id)!;
    delete row.watch_config;
    delete row.last_state;
    delete row.last_checked_at;
    delete row.consecutive_unchanged;
    const loaded = store.get(task.id)!;
    expect(loaded.watchConfig).toBeNull();
    expect(loaded.watchConfigError).toBeNull();
    expect(loaded.lastState).toBeNull();
  });

  it('keeps a corrupt watch configuration when an edit does not change the condition', async () => {
    const database = createDatabase();
    const store = createScheduledTaskStore(database);
    let executed = false;
    const manager = new ScheduledTaskManager({
      store,
      executeTask: async () => {
        executed = true;
        return { sessionId: 'session' };
      },
      checkCondition: async () => 'unused',
    });
    const created = manager.create({
      prompt: 'react',
      cwd: '/tmp/project',
      runAt: Date.now() + 60_000,
      repeatEvery: 1,
      repeatUnit: 'minute',
      watchConfig,
    });
    database.scheduledTasks.update(created.id, { watch_config: 'broken JSON' });
    const loaded = store.get(created.id)!;
    const submittedWatchConfig = watchConfigForTaskUpdate(
      loaded.watchConfigError,
      false,
      loaded.watchConfig ?? null
    );
    manager.update(created.id, {
      cwd: '/tmp/other',
      ...(submittedWatchConfig !== undefined ? { watchConfig: submittedWatchConfig } : {}),
    });
    expect(database.rows.get(created.id)!.watch_config).toBe('broken JSON');
    expect(store.get(created.id)!.cwd).toBe('/tmp/other');
    await expect(manager.runNow(created.id)).rejects.toThrow(loaded.watchConfigError!);
    expect(executed).toBe(false);
  });

  it('clears a corrupt watch configuration when the edit explicitly removes it', async () => {
    const database = createDatabase();
    const store = createScheduledTaskStore(database);
    let executed = false;
    const manager = new ScheduledTaskManager({
      store,
      executeTask: async () => {
        executed = true;
        return { sessionId: 'session' };
      },
      checkCondition: async () => 'unused',
    });
    const created = manager.create({
      prompt: 'react',
      cwd: '/tmp/project',
      runAt: Date.now() + 60_000,
      repeatEvery: 1,
      repeatUnit: 'minute',
      watchConfig,
    });
    database.scheduledTasks.update(created.id, { watch_config: '{"checkType":"http"}' });
    const loaded = store.get(created.id)!;
    const submittedWatchConfig = watchConfigForTaskUpdate(loaded.watchConfigError, true, null);
    manager.update(created.id, { watchConfig: submittedWatchConfig });
    expect(database.rows.get(created.id)!.watch_config).toBeNull();
    await expect(manager.runNow(created.id)).resolves.toMatchObject({ outcome: 'started' });
    expect(executed).toBe(true);
  });
});
