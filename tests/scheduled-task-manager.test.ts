import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ScheduledTaskManager,
  type ScheduledTaskCreateInput,
  type ScheduledTaskRunResult,
  type ScheduledTaskScheduleConfig,
  type ScheduledTask,
  type ScheduledTaskStore,
} from '../src/main/schedule/scheduled-task-manager';
import { buildScheduledTaskTitle } from '../src/shared/schedule/task-title';
import {
  normalizeWatchConfig,
  type HttpWatchConfig,
  type HttpWatchConfigInput,
} from '../src/shared/schedule/watch-task';

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
    watchConfig: null,
    watchConfigError: null,
    lastState: null,
    lastCheckedAt: null,
    consecutiveUnchanged: 0,
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

function createWeeklySchedule(weekdays: number[], times: string[]): ScheduledTaskScheduleConfig {
  return { kind: 'weekly', weekdays, times };
}

function createHttpWatchConfig(
  checkConfig: HttpWatchConfigInput['checkConfig'] = { url: 'https://example.com/status' },
  compareMode: HttpWatchConfigInput['compareMode'] = 'status'
): HttpWatchConfigInput {
  return { checkType: 'http', compareMode, checkConfig };
}

function createWatchTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return createTask({
    repeatEvery: 1,
    repeatUnit: 'minute',
    watchConfig: normalizeWatchConfig(createHttpWatchConfig()),
    lastState: 'prior-state',
    lastCheckedAt: 1_700_000_000_000,
    consecutiveUnchanged: 3,
    lastError: 'prior check failed',
    ...overrides,
  });
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: (value: T) => void = () => {
    throw new Error('Deferred promise resolver was not initialized.');
  };
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
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
        watchConfig: null,
        watchConfigError: null,
        lastState: null,
        lastCheckedAt: null,
        consecutiveUnchanged: 0,
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

type WatchTaskFixtureOptions = {
  readonly task: ScheduledTask;
  readonly checkCondition: (config: HttpWatchConfig) => Promise<string>;
  readonly executeTask: (task: ScheduledTask) => Promise<ScheduledTaskRunResult>;
  readonly onTaskError?: (taskId: string, error: string) => void;
};

function createWatchTaskFixture(options: WatchTaskFixtureOptions): {
  readonly manager: ScheduledTaskManager;
  readonly store: ScheduledTaskStore;
  readonly onTaskError: (taskId: string, error: string) => void;
} {
  const store = createStore([options.task]);
  const onTaskError = options.onTaskError ?? vi.fn();
  const manager = new ScheduledTaskManager({
    store,
    checkCondition: options.checkCondition,
    executeTask: options.executeTask,
    onTaskError,
    now: () => Date.now(),
  });
  return { manager, store, onTaskError };
}

async function runAutomaticWatchTask(manager: ScheduledTaskManager): Promise<void> {
  manager.start();
  await vi.advanceTimersByTimeAsync(0);
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

  it('prevents concurrent runs for same repeating task', async () => {
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

    // First trigger fires at t=1000
    await vi.advanceTimersByTimeAsync(1000);
    // First execution is still in-flight; second trigger fires at t=61000
    await vi.advanceTimersByTimeAsync(60 * 1000);

    // While the first run is still pending the second trigger must be suppressed
    expect(executeTask).toHaveBeenCalledTimes(1);

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

    (manager as unknown as { handleTrigger(id: string): void }).handleTrigger('stale-trigger');
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

  it('normalizes provided title with schedule prefix', () => {
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
      createTask({
        id: 'enabled-late',
        enabled: true,
        nextRunAt: now + 10 * 60 * 1000,
        createdAt: now - 2_000,
      }),
      createTask({
        id: 'enabled-soon',
        enabled: true,
        nextRunAt: now + 60 * 1000,
        createdAt: now - 3_000,
      }),
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

    expect(() => manager.toggle('toggle-once-overdue', true)).toThrow(
      'Cannot enable: one-time task is overdue'
    );
    const after = store.get('toggle-once-overdue');
    expect(after?.enabled).toBe(false);
    expect(after?.nextRunAt).toBeNull();
  });

  it('logs error via .catch when store.update inside executeAndRecord throws', async () => {
    const now = Date.now();
    const store = createStore([
      createTask({
        id: 'trigger-error',
        runAt: now + 1000,
        nextRunAt: now + 1000,
      }),
    ]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-trigger-error' });
    // Make store.update throw on the second call (first call is from prepareExecution,
    // second is from executeAndRecord recording the result)
    const originalUpdate = store.update.bind(store);
    let updateCallCount = 0;
    store.update = (id, updates) => {
      updateCallCount++;
      if (updateCallCount >= 2) {
        throw new Error('db locked');
      }
      return originalUpdate(id, updates);
    };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });
    manager.start();

    await vi.advanceTimersByTimeAsync(1000);
    // Flush microtask queue so the .catch() handler runs
    await Promise.resolve();
    await Promise.resolve();

    expect(executeTask).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.any(String), // timestamp prefix from logger
      expect.stringContaining('[ScheduledTaskManager] Failed to update store:'),
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('calls onTaskError callback when task execution fails', async () => {
    const now = Date.now();
    const store = createStore([
      createTask({
        id: 'error-callback',
        runAt: now + 1000,
        nextRunAt: now + 1000,
      }),
    ]);
    const executeTask = vi.fn().mockRejectedValue(new Error('execution failed'));
    const onTaskError = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const manager = new ScheduledTaskManager({
      store,
      executeTask,
      onTaskError,
      now: () => Date.now(),
    });
    manager.start();

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();

    expect(executeTask).toHaveBeenCalledTimes(1);
    expect(onTaskError).toHaveBeenCalledWith('error-callback', 'execution failed');
    const after = store.get('error-callback');
    expect(after?.lastError).toBe('execution failed');
    consoleSpy.mockRestore();
  });

  describe('WatchTask validation', () => {
    function createValidationManager(initialTasks: ScheduledTask[] = []): {
      manager: ScheduledTaskManager;
      store: ScheduledTaskStore;
    } {
      const store = createStore(initialTasks);
      const manager = new ScheduledTaskManager({
        store,
        executeTask: vi.fn().mockResolvedValue({ sessionId: 'watch-validation' }),
        now: () => Date.now(),
      });
      return { manager, store };
    }

    it('accepts an interval WatchTask and writes its normalized configuration', () => {
      const { manager, store } = createValidationManager();
      const createSpy = vi.spyOn(store, 'create');
      const watchConfig = createHttpWatchConfig({ url: 'HTTPS://EXAMPLE.COM:443/status' });

      manager.create({
        prompt: 'check interval',
        cwd: '/tmp/project',
        runAt: Date.now() + 60_000,
        repeatEvery: 1,
        repeatUnit: 'minute',
        watchConfig,
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ watchConfig: normalizeWatchConfig(watchConfig) })
      );
    });

    it('accepts a daily WatchTask and writes its normalized configuration', () => {
      const { manager, store } = createValidationManager();
      const createSpy = vi.spyOn(store, 'create');
      const watchConfig = createHttpWatchConfig();

      manager.create({
        prompt: 'check daily',
        cwd: '/tmp/project',
        runAt: Date.now() + 60_000,
        scheduleConfig: createDailySchedule(['09:00']),
        watchConfig,
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ watchConfig: normalizeWatchConfig(watchConfig) })
      );
    });

    it('accepts a weekly WatchTask and writes its normalized configuration', () => {
      const { manager, store } = createValidationManager();
      const createSpy = vi.spyOn(store, 'create');
      const watchConfig = createHttpWatchConfig();

      manager.create({
        prompt: 'check weekly',
        cwd: '/tmp/project',
        runAt: Date.now() + 60_000,
        scheduleConfig: createWeeklySchedule([1], ['09:00']),
        watchConfig,
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ watchConfig: normalizeWatchConfig(watchConfig) })
      );
    });

    it('rejects a one-time WatchTask before it reaches the Store', () => {
      const { manager, store } = createValidationManager();
      const createSpy = vi.spyOn(store, 'create');

      expect(() =>
        manager.create({
          prompt: 'check once',
          cwd: '/tmp/project',
          runAt: Date.now() + 60_000,
          watchConfig: createHttpWatchConfig(),
        })
      ).toThrow('WatchTasks require a repeating interval, daily, or weekly schedule.');
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('rejects an automatic WatchTask interval shorter than one minute', () => {
      const { manager, store } = createValidationManager();
      const createSpy = vi.spyOn(store, 'create');

      expect(() =>
        manager.create({
          prompt: 'check too soon',
          cwd: '/tmp/project',
          runAt: Date.now() + 60_000,
          repeatEvery: 0.5,
          repeatUnit: 'minute',
          watchConfig: createHttpWatchConfig(),
        })
      ).toThrow('WatchTasks require a repeating interval, daily, or weekly schedule.');
      expect(createSpy).not.toHaveBeenCalled();
    });

    it.each([
      {
        condition: 'uses a non-HTTP protocol',
        watchConfig: createHttpWatchConfig({ url: 'file:///tmp/status' }),
        message: 'Watch configuration URL must use HTTP or HTTPS.',
      },
      {
        condition: 'uses an out-of-range timeout',
        watchConfig: createHttpWatchConfig({
          url: 'https://example.com/status',
          timeoutMs: 999,
        }),
        message: 'Watch configuration timeoutMs must be an integer between 1000 and 30000.',
      },
      {
        condition: 'compares a HEAD response body hash',
        watchConfig: createHttpWatchConfig(
          { url: 'https://example.com/status', method: 'HEAD' },
          'bodyHash'
        ),
        message: 'Watch configuration cannot compare a HEAD response body hash.',
      },
    ])('rejects a WatchTask that $condition', ({ watchConfig, message }) => {
      const { manager, store } = createValidationManager();
      const createSpy = vi.spyOn(store, 'create');

      expect(() =>
        manager.create({
          prompt: 'check invalid config',
          cwd: '/tmp/project',
          runAt: Date.now() + 60_000,
          repeatEvery: 1,
          repeatUnit: 'minute',
          watchConfig,
        })
      ).toThrow(message);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('merges the current one-time schedule before accepting a WatchTask update', () => {
      const { manager, store } = createValidationManager([createTask({ id: 'one-time' })]);
      const updateSpy = vi.spyOn(store, 'update');

      expect(() => manager.update('one-time', { watchConfig: createHttpWatchConfig() })).toThrow(
        'WatchTasks require a repeating interval, daily, or weekly schedule.'
      );
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('preserves WatchTask runtime state for an equivalent normalized configuration', () => {
      const currentWatchConfig = normalizeWatchConfig(createHttpWatchConfig());
      const { manager } = createValidationManager([
        createWatchTask({ id: 'equivalent', watchConfig: currentWatchConfig }),
      ]);
      const equivalentConfig = createHttpWatchConfig({
        url: 'HTTPS://EXAMPLE.COM:443/status',
      });

      const updated = manager.update('equivalent', { watchConfig: equivalentConfig });

      expect(updated).toMatchObject({
        watchConfig: currentWatchConfig,
        lastState: 'prior-state',
        lastCheckedAt: 1_700_000_000_000,
        consecutiveUnchanged: 3,
        lastError: 'prior check failed',
      });
    });

    it.each([
      {
        field: 'URL',
        watchConfig: createHttpWatchConfig({ url: 'https://example.com/changed' }),
      },
      {
        field: 'method',
        watchConfig: createHttpWatchConfig({ url: 'https://example.com/status', method: 'HEAD' }),
      },
      {
        field: 'compare mode',
        watchConfig: createHttpWatchConfig({ url: 'https://example.com/status' }, 'bodyHash'),
      },
      {
        field: 'timeout',
        watchConfig: createHttpWatchConfig({
          url: 'https://example.com/status',
          timeoutMs: 12_000,
        }),
      },
    ])('resets WatchTask runtime state when the $field changes', ({ watchConfig }) => {
      const { manager } = createValidationManager([createWatchTask({ id: 'reset-config' })]);

      const updated = manager.update('reset-config', { watchConfig });

      expect(updated).toMatchObject({
        lastState: null,
        lastCheckedAt: null,
        consecutiveUnchanged: 0,
        lastError: null,
      });
    });

    it('resets WatchTask runtime state when watch configuration is removed', () => {
      const { manager } = createValidationManager([createWatchTask({ id: 'remove-watch' })]);

      const updated = manager.update('remove-watch', { watchConfig: null });

      expect(updated).toMatchObject({
        watchConfig: null,
        lastState: null,
        lastCheckedAt: null,
        consecutiveUnchanged: 0,
        lastError: null,
      });
    });

    it('does not forward public runtime state supplied during WatchTask creation', () => {
      const { manager, store } = createValidationManager();
      const createSpy = vi.spyOn(store, 'create');
      const publicCreatePayload: ScheduledTaskCreateInput & {
        lastState: string;
        lastCheckedAt: number;
        consecutiveUnchanged: number;
      } = {
        prompt: 'check state input',
        cwd: '/tmp/project',
        runAt: Date.now() + 60_000,
        repeatEvery: 1,
        repeatUnit: 'minute',
        watchConfig: createHttpWatchConfig(),
        lastState: 'injected-state',
        lastCheckedAt: 123,
        consecutiveUnchanged: 99,
      };

      manager.create(publicCreatePayload);

      expect(createSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({
          lastState: 'injected-state',
          lastCheckedAt: 123,
          consecutiveUnchanged: 99,
        })
      );
    });

    it('does not mutate WatchTask runtime state from a public update payload', () => {
      const { manager } = createValidationManager([createWatchTask({ id: 'state-update' })]);
      const publicUpdatePayload = {
        lastState: 'injected-state',
        lastCheckedAt: 123,
        consecutiveUnchanged: 99,
      };

      const updated = manager.update('state-update', publicUpdatePayload);

      expect(updated).toMatchObject({
        lastState: 'prior-state',
        lastCheckedAt: 1_700_000_000_000,
        consecutiveUnchanged: 3,
      });
    });
  });

  describe('WatchTask check-persist-act pipeline', () => {
    it('persists the first baseline before an automatic WatchTask decides not to invoke Agent', async () => {
      const now = Date.now();
      const task = createWatchTask({
        id: 'watch-baseline',
        nextRunAt: now,
        lastState: null,
        lastCheckedAt: null,
        consecutiveUnchanged: 0,
        lastError: 'previous failure',
        lastRunAt: 123,
        lastRunSessionId: 'prior-session',
      });
      const checkCondition = vi.fn().mockResolvedValue('A');
      const executeTask = vi.fn().mockResolvedValue({ sessionId: 'unexpected' });
      const { manager, store } = createWatchTaskFixture({ task, checkCondition, executeTask });
      const updateSpy = vi.spyOn(store, 'update');
      checkCondition.mockImplementation(async () => {
        expect(updateSpy).toHaveBeenCalledWith(
          task.id,
          expect.objectContaining({ nextRunAt: now + 60_000, enabled: true })
        );
        return 'A';
      });

      await runAutomaticWatchTask(manager);

      expect(store.get(task.id)).toMatchObject({
        nextRunAt: now + 60_000,
        lastState: 'A',
        lastCheckedAt: now,
        consecutiveUnchanged: 0,
        lastError: null,
        lastRunAt: 123,
        lastRunSessionId: 'prior-session',
      });
      expect(checkCondition).toHaveBeenCalledWith(task.watchConfig);
      expect(executeTask).not.toHaveBeenCalled();
    });

    it('increments an unchanged state and clears its prior check error without invoking Agent', async () => {
      const now = Date.now();
      const task = createWatchTask({
        id: 'watch-unchanged',
        nextRunAt: now,
        lastState: 'A',
        consecutiveUnchanged: 2,
        lastError: 'previous check failure',
        lastRunAt: 456,
      });
      const checkCondition = vi.fn().mockResolvedValue('A');
      const executeTask = vi.fn().mockResolvedValue({ sessionId: 'unexpected' });
      const { manager, store } = createWatchTaskFixture({ task, checkCondition, executeTask });

      await runAutomaticWatchTask(manager);

      expect(store.get(task.id)).toMatchObject({
        lastState: 'A',
        lastCheckedAt: now,
        consecutiveUnchanged: 3,
        lastError: null,
        lastRunAt: 456,
      });
      expect(executeTask).not.toHaveBeenCalled();
    });

    it('persists a changed state before invoking Agent', async () => {
      const now = Date.now();
      const task = createWatchTask({
        id: 'watch-changed',
        nextRunAt: now,
        lastState: 'A',
        consecutiveUnchanged: 4,
        lastError: 'previous check failure',
      });
      const checkCondition = vi.fn().mockResolvedValue('B');
      const executeTask = vi.fn().mockImplementation(async () => {
        expect(store.get(task.id)).toMatchObject({
          lastState: 'B',
          lastCheckedAt: now,
          consecutiveUnchanged: 0,
          lastError: null,
        });
        return { sessionId: 'watch-session' };
      });
      const { manager, store } = createWatchTaskFixture({ task, checkCondition, executeTask });

      await runAutomaticWatchTask(manager);

      expect(executeTask).toHaveBeenCalledTimes(1);
      expect(store.get(task.id)).toMatchObject({
        lastState: 'B',
        lastCheckedAt: now,
        consecutiveUnchanged: 0,
        lastError: null,
        lastRunAt: now,
        lastRunSessionId: 'watch-session',
      });
    });

    it('keeps an advanced baseline after Agent fails and does not retry it when unchanged', async () => {
      const now = Date.now();
      const task = createWatchTask({
        id: 'watch-agent-failure',
        nextRunAt: now,
        lastState: 'A',
      });
      const checkCondition = vi.fn().mockResolvedValue('B');
      const executeTask = vi.fn().mockRejectedValue(new Error('Agent failed'));
      const { manager, store } = createWatchTaskFixture({ task, checkCondition, executeTask });

      await runAutomaticWatchTask(manager);

      expect(store.get(task.id)).toMatchObject({
        lastState: 'B',
        lastCheckedAt: now,
        consecutiveUnchanged: 0,
        lastError: 'Agent failed',
        lastRunAt: now,
        lastRunSessionId: null,
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(executeTask).toHaveBeenCalledTimes(1);
      expect(store.get(task.id)).toMatchObject({
        lastState: 'B',
        consecutiveUnchanged: 1,
        lastError: null,
      });
    });

    it('records and reports checker failures without invoking Agent', async () => {
      const now = Date.now();
      const task = createWatchTask({
        id: 'watch-checker-failure',
        nextRunAt: now,
        lastState: 'A',
        consecutiveUnchanged: 2,
      });
      const checkCondition = vi.fn().mockRejectedValue(new Error('checker failed'));
      const executeTask = vi.fn().mockResolvedValue({ sessionId: 'unexpected' });
      const onTaskError = vi.fn();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { manager, store } = createWatchTaskFixture({
        task,
        checkCondition,
        executeTask,
        onTaskError,
      });

      await runAutomaticWatchTask(manager);

      expect(store.get(task.id)).toMatchObject({
        lastState: 'A',
        lastCheckedAt: now,
        consecutiveUnchanged: 2,
        lastError: 'checker failed',
      });
      expect(executeTask).not.toHaveBeenCalled();
      expect(onTaskError).toHaveBeenCalledWith(task.id, 'checker failed');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('reports a WatchTask state persistence failure and skips Agent', async () => {
      const now = Date.now();
      const task = createWatchTask({
        id: 'watch-state-persist-throws',
        nextRunAt: now,
        lastState: null,
      });
      const checkCondition = vi.fn().mockResolvedValue('A');
      const executeTask = vi.fn().mockResolvedValue({ sessionId: 'unexpected' });
      const onTaskError = vi.fn();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { manager, store } = createWatchTaskFixture({
        task,
        checkCondition,
        executeTask,
        onTaskError,
      });
      const originalUpdate = store.update.bind(store);
      store.update = (id, updates) => {
        if (updates.lastCheckedAt !== undefined) {
          throw new Error('state persistence failed');
        }
        return originalUpdate(id, updates);
      };

      await runAutomaticWatchTask(manager);

      expect(executeTask).not.toHaveBeenCalled();
      expect(onTaskError).toHaveBeenCalledWith(
        task.id,
        expect.stringContaining('state persistence failed')
      );
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('reports a missing WatchTask state update and skips Agent', async () => {
      const now = Date.now();
      const task = createWatchTask({
        id: 'watch-state-persist-null',
        nextRunAt: now,
        lastState: null,
      });
      const checkCondition = vi.fn().mockResolvedValue('A');
      const executeTask = vi.fn().mockResolvedValue({ sessionId: 'unexpected' });
      const onTaskError = vi.fn();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { manager, store } = createWatchTaskFixture({
        task,
        checkCondition,
        executeTask,
        onTaskError,
      });
      const originalUpdate = store.update.bind(store);
      store.update = (id, updates) =>
        updates.lastCheckedAt !== undefined ? null : originalUpdate(id, updates);

      await runAutomaticWatchTask(manager);

      expect(executeTask).not.toHaveBeenCalled();
      expect(onTaskError).toHaveBeenCalledWith(
        task.id,
        expect.stringContaining('state update returned no task')
      );
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('treats malformed persisted WatchTasks as check failures for automatic and runNow paths', async () => {
      const now = Date.now();
      const task = createWatchTask({
        id: 'watch-malformed',
        nextRunAt: now,
        watchConfig: null,
        watchConfigError: 'Invalid persisted HTTP watch configuration JSON.',
        lastState: 'A',
        consecutiveUnchanged: 2,
      });
      const checkCondition = vi.fn().mockResolvedValue('unexpected');
      const executeTask = vi.fn().mockResolvedValue({ sessionId: 'unexpected' });
      const onTaskError = vi.fn();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { manager, store } = createWatchTaskFixture({
        task,
        checkCondition,
        executeTask,
        onTaskError,
      });

      await runAutomaticWatchTask(manager);
      await expect(manager.runNow(task.id)).rejects.toThrow(
        'Invalid persisted HTTP watch configuration JSON.'
      );

      expect(store.get(task.id)).toMatchObject({
        lastState: 'A',
        lastCheckedAt: now,
        consecutiveUnchanged: 2,
        lastError: 'Invalid persisted HTTP watch configuration JSON.',
      });
      expect(checkCondition).not.toHaveBeenCalled();
      expect(executeTask).not.toHaveBeenCalled();
      expect(onTaskError).toHaveBeenCalledTimes(2);
      consoleSpy.mockRestore();
    });

    it('rejects runNow after recording a checker failure without invoking Agent', async () => {
      const now = Date.now();
      const task = createWatchTask({
        id: 'watch-run-now-checker-failure',
        nextRunAt: now + 60_000,
        lastState: 'A',
        consecutiveUnchanged: 2,
      });
      const checkCondition = vi.fn().mockRejectedValue(new Error('runNow checker failed'));
      const executeTask = vi.fn().mockResolvedValue({ sessionId: 'unexpected' });
      const onTaskError = vi.fn();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { manager, store } = createWatchTaskFixture({
        task,
        checkCondition,
        executeTask,
        onTaskError,
      });

      await expect(manager.runNow(task.id)).rejects.toThrow('runNow checker failed');

      expect(store.get(task.id)).toMatchObject({
        lastState: 'A',
        lastCheckedAt: now,
        consecutiveUnchanged: 2,
        lastError: 'runNow checker failed',
        lastRunAt: null,
        lastRunSessionId: null,
      });
      expect(executeTask).not.toHaveBeenCalled();
      expect(onTaskError).toHaveBeenCalledWith(task.id, 'runNow checker failed');
      consoleSpy.mockRestore();
    });

    it('rejects runNow after Agent fails while retaining the advanced WatchTask baseline', async () => {
      const now = Date.now();
      const task = createWatchTask({
        id: 'watch-run-now-agent-failure',
        nextRunAt: now + 60_000,
        lastState: 'A',
      });
      const checkCondition = vi.fn().mockResolvedValue('B');
      const executeTask = vi.fn().mockRejectedValue(new Error('runNow Agent failed'));
      const { manager, store } = createWatchTaskFixture({ task, checkCondition, executeTask });

      await expect(manager.runNow(task.id)).rejects.toThrow('runNow Agent failed');

      expect(store.get(task.id)).toMatchObject({
        lastState: 'B',
        lastCheckedAt: now,
        consecutiveUnchanged: 0,
        lastError: 'runNow Agent failed',
        lastRunAt: now,
        lastRunSessionId: null,
      });
    });

    it('reschedules a WatchTask after its timer overlaps an unresolved checker', async () => {
      // Given
      const now = Date.now();
      const task = createWatchTask({ id: 'watch-long-checker', nextRunAt: now, lastState: null });
      const checker = createDeferred<string>();
      const checkCondition = vi.fn().mockReturnValue(checker.promise);
      const executeTask = vi.fn().mockResolvedValue({ sessionId: 'unexpected' });
      const { manager, store } = createWatchTaskFixture({ task, checkCondition, executeTask });

      // When
      await runAutomaticWatchTask(manager);
      await vi.advanceTimersByTimeAsync(60_000);

      // Then
      expect(checkCondition).toHaveBeenCalledTimes(1);
      expect(executeTask).not.toHaveBeenCalled();
      expect(store.get(task.id)?.nextRunAt).toBe(now + 120_000);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(checkCondition).toHaveBeenCalledTimes(1);
      expect(store.get(task.id)?.nextRunAt).toBe(now + 180_000);

      checker.resolve('A');
      await vi.advanceTimersByTimeAsync(60_000);

      expect(checkCondition).toHaveBeenCalledTimes(2);
      manager.stop();
    });

    it('reschedules a WatchTask after its timer overlaps an unresolved Agent', async () => {
      // Given
      const now = Date.now();
      const task = createWatchTask({ id: 'watch-long-agent', nextRunAt: now, lastState: 'A' });
      const agent = createDeferred<ScheduledTaskRunResult>();
      const checkCondition = vi.fn().mockResolvedValue('B');
      const executeTask = vi.fn().mockReturnValue(agent.promise);
      const { manager, store } = createWatchTaskFixture({ task, checkCondition, executeTask });

      // When
      await runAutomaticWatchTask(manager);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(60_000);

      // Then
      expect(checkCondition).toHaveBeenCalledTimes(1);
      expect(executeTask).toHaveBeenCalledTimes(1);
      expect(store.get(task.id)?.nextRunAt).toBe(now + 120_000);

      agent.resolve({ sessionId: 'watch-agent' });
      await vi.advanceTimersByTimeAsync(60_000);

      expect(checkCondition).toHaveBeenCalledTimes(2);
      expect(executeTask).toHaveBeenCalledTimes(1);
      manager.stop();
    });

    it('keeps a future WatchTask timer after runNow overlaps it', async () => {
      // Given
      const now = Date.now();
      const task = createWatchTask({
        id: 'watch-run-now-overlap',
        nextRunAt: now + 60_000,
        lastState: null,
      });
      const checker = createDeferred<string>();
      const checkCondition = vi.fn().mockReturnValue(checker.promise);
      const executeTask = vi.fn().mockResolvedValue({ sessionId: 'unexpected' });
      const { manager, store } = createWatchTaskFixture({ task, checkCondition, executeTask });
      manager.start();

      // When
      const runNow = manager.runNow(task.id);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(60_000);

      // Then
      expect(checkCondition).toHaveBeenCalledTimes(1);
      expect(executeTask).not.toHaveBeenCalled();
      expect(store.get(task.id)?.nextRunAt).toBe(now + 120_000);

      checker.resolve('A');
      await runNow;
      await vi.advanceTimersByTimeAsync(60_000);

      expect(checkCondition).toHaveBeenCalledTimes(2);
      manager.stop();
    });

    it('leaves a stale WatchTask trigger at its persisted future slot', async () => {
      // Given
      const now = Date.now();
      const task = createWatchTask({
        id: 'watch-stale-trigger',
        nextRunAt: now - 60_000,
        lastState: 'A',
      });
      const checkCondition = vi.fn().mockResolvedValue('A');
      const executeTask = vi.fn().mockResolvedValue({ sessionId: 'unexpected' });
      const { manager, store } = createWatchTaskFixture({ task, checkCondition, executeTask });
      const timerSpy = vi.spyOn(globalThis, 'setTimeout');
      manager.start();
      const staleTrigger = timerSpy.mock.calls[0]?.[0];
      if (typeof staleTrigger !== 'function') {
        throw new Error('Expected an initial timer callback.');
      }

      // When
      await manager.runNow(task.id);
      staleTrigger();

      // Then
      expect(checkCondition).toHaveBeenCalledTimes(1);
      expect(executeTask).not.toHaveBeenCalled();
      expect(store.get(task.id)?.nextRunAt).toBe(now + 60_000);
      timerSpy.mockRestore();
      manager.stop();
    });

    it('restores an overdue WatchTask from its persisted future slot after restart', async () => {
      // Given
      const now = Date.now();
      const task = createWatchTask({
        id: 'watch-restart-overdue',
        nextRunAt: now - 60_000,
        lastState: null,
      });
      const checker = createDeferred<string>();
      const firstCheckCondition = vi.fn().mockReturnValue(checker.promise);
      const executeTask = vi.fn().mockResolvedValue({ sessionId: 'unexpected' });
      const { manager, store } = createWatchTaskFixture({
        task,
        checkCondition: firstCheckCondition,
        executeTask,
      });
      manager.start();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
      manager.stop();
      checker.resolve('A');
      await Promise.resolve();
      const restartedCheckCondition = vi.fn().mockResolvedValue('A');
      const restartedManager = new ScheduledTaskManager({
        store,
        checkCondition: restartedCheckCondition,
        executeTask,
        now: () => Date.now(),
      });

      // When
      restartedManager.start();
      await vi.advanceTimersByTimeAsync(60_000);

      // Then
      expect(firstCheckCondition).toHaveBeenCalledTimes(1);
      expect(restartedCheckCondition).toHaveBeenCalledTimes(1);
      expect(executeTask).not.toHaveBeenCalled();
      restartedManager.stop();
    });

    it('keeps ordinary one-time, interval, daily, and weekly tasks out of the checker', async () => {
      // Given
      const now = Date.now();
      const tasks = [
        createTask({ id: 'ordinary-once', nextRunAt: now + 60_000 }),
        createTask({
          id: 'ordinary-interval',
          nextRunAt: now + 60_000,
          repeatEvery: 1,
          repeatUnit: 'minute',
        }),
        createTask({
          id: 'ordinary-daily',
          nextRunAt: now + 60_000,
          scheduleConfig: createDailySchedule(['09:00']),
        }),
        createTask({
          id: 'ordinary-weekly',
          nextRunAt: now + 60_000,
          scheduleConfig: createWeeklySchedule([1], ['09:00']),
        }),
      ];
      const store = createStore(tasks);
      const checkCondition = vi.fn().mockResolvedValue('unexpected');
      const executeTask = vi.fn().mockResolvedValue({ sessionId: 'ordinary-session' });
      const manager = new ScheduledTaskManager({
        store,
        checkCondition,
        executeTask,
        now: () => Date.now(),
      });

      // When
      for (const task of tasks) {
        await manager.runNow(task.id);
      }

      // Then
      expect(checkCondition).not.toHaveBeenCalled();
      expect(executeTask).toHaveBeenCalledTimes(4);
    });
  });
});
