import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { ScheduledTaskRow } from '../src/main/db/database';
import {
  createScheduledTaskStore,
  type ScheduledTaskDatabase,
} from '../src/main/schedule/scheduled-task-store';
import type {
  ScheduledTaskCreateInput,
  ScheduledTaskUpdateInput,
} from '../src/main/schedule/scheduled-task-manager';

type RuntimeStateKey = 'lastState' | 'lastCheckedAt' | 'consecutiveUnchanged';

function createRow(overrides: Partial<ScheduledTaskRow> = {}): ScheduledTaskRow {
  return {
    id: 'task-1',
    title: 'Watch endpoint',
    prompt: 'Observe endpoint state',
    cwd: '/tmp/project',
    run_at: 1_000,
    next_run_at: 2_000,
    schedule_config: null,
    watch_config: null,
    last_state: null,
    last_checked_at: null,
    consecutive_unchanged: 0,
    repeat_every: 5,
    repeat_unit: 'minute',
    enabled: 1,
    last_run_at: null,
    last_run_session_id: null,
    last_error: null,
    created_at: 100,
    updated_at: 200,
    ...overrides,
  };
}

function createFakeDatabase(initialRows: readonly ScheduledTaskRow[] = []): {
  readonly database: ScheduledTaskDatabase;
  readonly rows: Map<string, ScheduledTaskRow>;
} {
  const rows = new Map(initialRows.map((row) => [row.id, row]));

  return {
    database: {
      scheduledTasks: {
        create: (task) => {
          rows.set(task.id, task);
        },
        update: (id, updates) => {
          const existing = rows.get(id);
          if (!existing) return;
          rows.set(id, { ...existing, ...updates, updated_at: existing.updated_at + 1 });
        },
        get: (id) => rows.get(id),
        getAll: () => Array.from(rows.values()),
        delete: (id) => {
          rows.delete(id);
        },
      },
    },
    rows,
  };
}

describe('createScheduledTaskStore', () => {
  it('stores normalized watch config and default runtime state when creating a task', () => {
    const { database, rows } = createFakeDatabase();
    const store = createScheduledTaskStore(database);

    const created = store.create({
      title: 'Watch endpoint',
      prompt: 'Observe endpoint state',
      cwd: '/tmp/project',
      runAt: 1_000,
      watchConfig: {
        checkType: 'http',
        compareMode: 'status',
        checkConfig: { url: 'HTTP://EXAMPLE.COM:80/health' },
      },
    });

    expect(rows.get(created.id)).toMatchObject({
      watch_config:
        '{"checkType":"http","compareMode":"status","checkConfig":{"url":"http://example.com/health","method":"GET","timeoutMs":10000}}',
      last_state: null,
      last_checked_at: null,
      consecutive_unchanged: 0,
    });
    expect(created).toMatchObject({
      watchConfig: {
        checkType: 'http',
        compareMode: 'status',
        checkConfig: {
          url: 'http://example.com/health',
          method: 'GET',
          timeoutMs: 10_000,
        },
      },
      watchConfigError: null,
      lastState: null,
      lastCheckedAt: null,
      consecutiveUnchanged: 0,
    });
  });

  it('returns valid watch config through get and list after an ordinary update', () => {
    const { database } = createFakeDatabase([
      createRow({
        watch_config:
          '{"checkType":"http","compareMode":"bodyHash","checkConfig":{"url":"https://example.com/feed","method":"GET","timeoutMs":5000}}',
        last_state: 'before',
        last_checked_at: 1_500,
        consecutive_unchanged: 2,
      }),
    ]);
    const store = createScheduledTaskStore(database);

    store.update('task-1', { title: 'Updated watch endpoint' });

    expect(store.get('task-1')).toMatchObject({
      title: 'Updated watch endpoint',
      watchConfig: {
        checkType: 'http',
        compareMode: 'bodyHash',
        checkConfig: {
          url: 'https://example.com/feed',
          method: 'GET',
          timeoutMs: 5_000,
        },
      },
      watchConfigError: null,
      lastState: 'before',
      lastCheckedAt: 1_500,
      consecutiveUnchanged: 2,
    });
    expect(store.list()).toEqual([expect.objectContaining({ id: 'task-1' })]);
  });

  it('maps a legacy null watch config to no config and default runtime state', () => {
    const { database } = createFakeDatabase([createRow()]);
    const store = createScheduledTaskStore(database);

    expect(store.get('task-1')).toMatchObject({
      watchConfig: null,
      watchConfigError: null,
      lastState: null,
      lastCheckedAt: null,
      consecutiveUnchanged: 0,
      scheduleConfig: null,
    });
  });

  it('removes a configured watch when explicitly updated to null', () => {
    const { database, rows } = createFakeDatabase([
      createRow({
        watch_config:
          '{"checkType":"http","compareMode":"status","checkConfig":{"url":"https://example.com/health","method":"GET","timeoutMs":10000}}',
      }),
    ]);
    const store = createScheduledTaskStore(database);

    store.update('task-1', { watchConfig: null });

    expect(rows.get('task-1')?.watch_config).toBeNull();
    expect(store.get('task-1')).toMatchObject({ watchConfig: null, watchConfigError: null });
  });

  it('persists runtime state through the Store-only update path', () => {
    const { database, rows } = createFakeDatabase([createRow()]);
    const store = createScheduledTaskStore(database);

    store.update('task-1', {
      lastState: 'state-after-check',
      lastCheckedAt: 4_000,
      consecutiveUnchanged: 3,
    });

    expect(rows.get('task-1')).toMatchObject({
      last_state: 'state-after-check',
      last_checked_at: 4_000,
      consecutive_unchanged: 3,
    });
  });

  it('preserves malformed persisted JSON as an error without throwing or logging raw data from list', () => {
    const rawConfig = '{secret:do-not-log';
    const { database } = createFakeDatabase([createRow({ watch_config: rawConfig })]);
    const store = createScheduledTaskStore(database);
    const errorSpy = vi.spyOn(console, 'error');

    const listed = store.list();

    expect(listed).toEqual([
      expect.objectContaining({
        watchConfig: null,
        watchConfigError: 'Invalid persisted HTTP watch configuration JSON.',
      }),
    ]);
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining(rawConfig));
  });

  it('maps valid JSON with an invalid watch shape to its deterministic error', () => {
    const { database } = createFakeDatabase([createRow({ watch_config: '{"checkType":"http"}' })]);
    const store = createScheduledTaskStore(database);

    expect(store.get('task-1')).toMatchObject({
      watchConfig: null,
      watchConfigError: 'Watch configuration compareMode must be status or bodyHash.',
    });
  });

  it('keeps runtime state outside public manager create and update inputs', () => {
    expectTypeOf<Extract<keyof ScheduledTaskCreateInput, RuntimeStateKey>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof ScheduledTaskUpdateInput, RuntimeStateKey>>().toEqualTypeOf<never>();
  });
});
