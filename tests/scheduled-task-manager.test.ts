import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ScheduledTaskManager,
  type ScheduledTaskScheduleConfig,
  type ScheduledTask,
  type ScheduledTaskStore,
} from '../src/main/schedule/scheduled-task-manager';
import { buildScheduledTaskTitle } from '../src/shared/schedule/task-title';

function createTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  const now = Date.now();
  return {
    id: 'task-1',
    title: 'Daily reminder',
    prompt: 'run reminder',
    cwd: '/tmp/project',
    runAt: now,
    nextRunAt: now,
    enabled: true,
    scheduleConfig: null,
    repeatEvery: null,
    repeatUnit: null,
    lastRunAt: null,
    lastRunSessionId: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function toLocalTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function createDailySchedule(times: string[]): ScheduledTaskScheduleConfig {
  return { kind: 'daily', times };
}

function createWeeklySchedule(
  weekdays: number[],
  times: string[]
): ScheduledTaskScheduleConfig {
  return { kind: 'weekly', weekdays, times };
}

function createStore(initialTasks: ScheduledTask[]): ScheduledTaskStore {
  const tasks = new Map<string, ScheduledTask>(initialTasks.map((task) => [task.id, task]));

  return {
    list: () => Array.from(tasks.values()),
    get: (id) => tasks.get(id) ?? null,
    create: (input) => {
      const createdAt = Date.now();
      const task: ScheduledTask = {
        ...input,
        id: `task-${tasks.size + 1}`,
        lastRunAt: null,
        lastRunSessionId: null,
        lastError: null,
        createdAt,
        updatedAt: createdAt,
      };
      tasks.set(task.id, task);
      return task;
    },
    update: (id, updates) => {
      const existing = tasks.get(id);
      if (!existing) return null;
      const next: ScheduledTask = {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
      };
      tasks.set(id, next);
      return next;
    },
    delete: (id) => tasks.delete(id),
  };
}

describe('ScheduledTaskManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-02T09:00:00.000Z'));
  });

  it('runs one-time task once and disables it', async () => {
    const now = Date.now();
    const store = createStore([
      createTask({
        id: 'once',
        runAt: now + 1000,
        nextRunAt: now + 1000,
      }),
    ]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-1' });

    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });
    manager.start();

    await vi.advanceTimersByTimeAsync(1000);

    const after = store.get('once');
    expect(executeTask).toHaveBeenCalledTimes(1);
    expect(after?.enabled).toBe(false);
    expect(after?.lastRunSessionId).toBe('session-1');
  });

  it('advances nextRunAt for repeating task', async () => {
    const now = Date.now();
    const store = createStore([
      createTask({
        id: 'repeat',
        runAt: now + 1000,
        nextRunAt: now + 1000,
        repeatEvery: 5,
        repeatUnit: 'minute',
      }),
    ]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-2' });

    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });
    manager.start();

    await vi.advanceTimersByTimeAsync(1000);

    const after = store.get('repeat');
    expect(executeTask).toHaveBeenCalledTimes(1);
    expect(after?.enabled).toBe(true);
    expect(after?.nextRunAt).toBe(now + 1000 + 5 * 60 * 1000);
  });

  it('allows concurrent runs for same repeating task', async () => {
    const now = Date.now();
    const store = createStore([
      createTask({
        id: 'concurrent',
        runAt: now + 1000,
        nextRunAt: now + 1000,
        repeatEvery: 1,
        repeatUnit: 'minute',
      }),
    ]);

    let resolveFirst: (() => void) | null = null;
    const executeTask = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ sessionId: string }>((resolve) => {
            resolveFirst = () => resolve({ sessionId: 'session-first' });
          })
      )
      .mockResolvedValueOnce({ sessionId: 'session-second' });

    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });
    manager.start();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(executeTask).toHaveBeenCalledTimes(2);

    resolveFirst?.();
    await Promise.resolve();
  });

  it('runs overdue task immediately on startup and advances nextRunAt', async () => {
    const now = Date.now();
    const store = createStore([
      createTask({
        id: 'overdue',
        runAt: now - 15 * 60 * 1000,
        nextRunAt: now - 15 * 60 * 1000,
        repeatEvery: 5,
        repeatUnit: 'minute',
      }),
    ]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-overdue' });

    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });
    manager.start();

    await vi.runOnlyPendingTimersAsync();

    const after = store.get('overdue');
    expect(executeTask).toHaveBeenCalledTimes(1);
    expect(after?.nextRunAt).toBe(now + 5 * 60 * 1000);
  });

  it('runNow consumes one-time schedule and prevents duplicate auto trigger', async () => {
    const now = Date.now();
    const store = createStore([
      createTask({
        id: 'run-now-once',
        runAt: now + 1000,
        nextRunAt: now + 1000,
      }),
    ]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-now-once' });

    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });
    manager.start();

    await manager.runNow('run-now-once');

    const afterRunNow = store.get('run-now-once');
    expect(executeTask).toHaveBeenCalledTimes(1);
    expect(afterRunNow?.enabled).toBe(false);
    expect(afterRunNow?.nextRunAt).toBeNull();

    await vi.advanceTimersByTimeAsync(1000);
    expect(executeTask).toHaveBeenCalledTimes(1);
  });

  it('runNow on overdue repeating task reschedules and avoids immediate duplicate run', async () => {
    const now = Date.now();
    const store = createStore([
      createTask({
        id: 'run-now-repeat-overdue',
        runAt: now - 60 * 1000,
        nextRunAt: now - 60 * 1000,
        repeatEvery: 1,
        repeatUnit: 'minute',
      }),
    ]);
    const executeTask = vi
      .fn()
      .mockResolvedValueOnce({ sessionId: 'session-repeat-now-1' })
      .mockResolvedValueOnce({ sessionId: 'session-repeat-now-2' });

    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });
    manager.start();

    await manager.runNow('run-now-repeat-overdue');

    const afterRunNow = store.get('run-now-repeat-overdue');
    expect(executeTask).toHaveBeenCalledTimes(1);
    expect(afterRunNow?.enabled).toBe(true);
    expect(afterRunNow?.nextRunAt).toBe(now + 60 * 1000);

    await vi.advanceTimersByTimeAsync(0);
    expect(executeTask).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(executeTask).toHaveBeenCalledTimes(2);
  });

  it('treats epoch nextRunAt=0 as a valid scheduled time', async () => {
    const store = createStore([
      createTask({
        id: 'epoch-task',
        runAt: 0,
        nextRunAt: 0,
        enabled: true,
      }),
    ]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-epoch' });

    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });
    manager.start();

    await vi.runOnlyPendingTimersAsync();

    expect(executeTask).toHaveBeenCalledTimes(1);
  });

  it('ignores stale trigger when task has been moved to a future nextRunAt', async () => {
    const now = Date.now();
    const store = createStore([
      createTask({
        id: 'stale-trigger',
        runAt: now - 60 * 1000,
        nextRunAt: now - 60 * 1000,
        repeatEvery: 1,
        repeatUnit: 'minute',
      }),
    ]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-stale' });

    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });
    manager.start();

    await manager.runNow('stale-trigger');
    expect(executeTask).toHaveBeenCalledTimes(1);

    (manager as any).handleTrigger('stale-trigger');
    expect(executeTask).toHaveBeenCalledTimes(1);
  });

  it('runNow throws on execution error and clears lastRunSessionId', async () => {
    const now = Date.now();
    const store = createStore([
      createTask({
        id: 'run-now-failure',
        runAt: now + 1000,
        nextRunAt: now + 1000,
        lastRunSessionId: 'previous-session',
      }),
    ]);
    const executeTask = vi.fn().mockRejectedValue(new Error('runner failed'));

    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });
    manager.start();

    await expect(manager.runNow('run-now-failure')).rejects.toThrow('runner failed');

    const after = store.get('run-now-failure');
    expect(after?.lastRunSessionId).toBeNull();
    expect(after?.lastError).toBe('runner failed');
  });

  it('normalizes repeatEvery below 1 to one-time schedule', () => {
    const now = Date.now();
    const store = createStore([]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-normalize' });
    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });

    const created = manager.create({
      title: 'normalize',
      prompt: 'run',
      cwd: '/tmp/project',
      runAt: now + 60 * 1000,
      repeatEvery: 0.4,
      repeatUnit: 'hour',
      enabled: true,
    });

    expect(created.repeatEvery).toBeNull();
    expect(created.repeatUnit).toBeNull();
  });

  it('keeps provided title and normalizes schedule prefix', () => {
    const now = Date.now();
    const store = createStore([]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-title-create' });
    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });

    const created = manager.create({
      title: '  需要汇总论文  ',
      prompt: '  帮我整理今天团队待办  ',
      cwd: '/tmp/project',
      runAt: now + 60 * 1000,
      enabled: true,
    });

    expect(created.title).toBe(buildScheduledTaskTitle('需要汇总论文'));
  });

  it('keeps existing title when prompt changes without explicit title update', () => {
    const now = Date.now();
    const store = createStore([
      createTask({
        id: 'title-update',
        title: buildScheduledTaskTitle('旧标题'),
        prompt: '旧任务',
        runAt: now + 60_000,
        nextRunAt: now + 60_000,
      }),
    ]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-title-update' });
    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });

    const updated = manager.update('title-update', { prompt: '每周汇总销售数据并发送到群里' });

    expect(updated?.title).toBe(buildScheduledTaskTitle('旧标题'));
  });

  it('does not execute long-delay task before nextRunAt when delay exceeds max timer range', async () => {
    const now = Date.now();
    const longDelay = 2_147_483_647 + 60_000;
    const store = createStore([
      createTask({
        id: 'long-delay',
        runAt: now + longDelay,
        nextRunAt: now + longDelay,
        enabled: true,
      }),
    ]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-long-delay' });
    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });
    manager.start();

    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(executeTask).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(executeTask).toHaveBeenCalledTimes(1);
  });

  it('re-enables repeating task with next future slot instead of immediate catch-up run', async () => {
    const now = Date.now();
    const store = createStore([
      createTask({
        id: 'toggle-repeat',
        enabled: false,
        runAt: now - 15 * 60 * 1000,
        nextRunAt: null,
        repeatEvery: 5,
        repeatUnit: 'minute',
      }),
    ]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-toggle-repeat' });
    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });
    manager.start();

    const toggled = manager.toggle('toggle-repeat', true);
    expect(toggled?.nextRunAt).toBe(now + 5 * 60 * 1000);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(executeTask).toHaveBeenCalledTimes(0);
  });

  it('advances daily multi-slot schedule to the next time slot after execution', async () => {
    const now = toLocalTimestamp(2026, 3, 2, 6, 30);
    vi.setSystemTime(now);
    const store = createStore([
      createTask({
        id: 'daily-multi-slot',
        runAt: toLocalTimestamp(2026, 3, 2, 6, 30),
        nextRunAt: toLocalTimestamp(2026, 3, 2, 6, 30),
        scheduleConfig: createDailySchedule(['04:00', '06:30', '08:00']),
      }),
    ]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-daily-multi-slot' });
    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });
    manager.start();

    await vi.runOnlyPendingTimersAsync();

    const after = store.get('daily-multi-slot');
    expect(executeTask).toHaveBeenCalledTimes(1);
    expect(after?.enabled).toBe(true);
    expect(after?.nextRunAt).toBe(toLocalTimestamp(2026, 3, 2, 8, 0));
  });

  it('re-enables weekly multi-slot schedule with the nearest future weekday slot', () => {
    const now = toLocalTimestamp(2026, 3, 3, 9, 15);
    vi.setSystemTime(now);
    const store = createStore([
      createTask({
        id: 'weekly-multi-slot',
        enabled: false,
        runAt: toLocalTimestamp(2026, 3, 2, 8, 0),
        nextRunAt: null,
        scheduleConfig: createWeeklySchedule([1, 4], ['00:30', '01:00', '08:00']),
      }),
    ]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-weekly-multi-slot' });
    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });

    const toggled = manager.toggle('weekly-multi-slot', true);

    expect(toggled?.enabled).toBe(true);
    expect(toggled?.nextRunAt).toBe(toLocalTimestamp(2026, 3, 5, 0, 30));
  });

  it('sorts list by enabled then nearest nextRunAt', () => {
    const now = Date.now();
    const store = createStore([
      createTask({ id: 'disabled', enabled: false, nextRunAt: null, createdAt: now - 1_000 }),
      createTask({ id: 'enabled-late', enabled: true, nextRunAt: now + 10 * 60 * 1000, createdAt: now - 2_000 }),
      createTask({ id: 'enabled-soon', enabled: true, nextRunAt: now + 60 * 1000, createdAt: now - 3_000 }),
    ]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-sort' });
    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });

    const ids = manager.list().map((task) => task.id);
    expect(ids).toEqual(['enabled-soon', 'enabled-late', 'disabled']);
  });

  it('rejects enabling overdue one-time task to avoid immediate execution', () => {
    const now = Date.now();
    const store = createStore([
      createTask({
        id: 'toggle-once-overdue',
        enabled: false,
        runAt: now - 60_000,
        nextRunAt: null,
        repeatEvery: null,
        repeatUnit: null,
      }),
    ]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-toggle-once-overdue' });
    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });

    expect(() => manager.toggle('toggle-once-overdue', true)).toThrow('一次性任务执行时间已过');
    const after = store.get('toggle-once-overdue');
    expect(after?.enabled).toBe(false);
    expect(after?.nextRunAt).toBeNull();
  });
});
