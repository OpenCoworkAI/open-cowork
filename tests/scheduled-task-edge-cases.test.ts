import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  ScheduledTaskManager,
  type ScheduledTask,
  type ScheduledTaskStore,
} from '../src/main/schedule/scheduled-task-manager';

function createTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  const now = Date.now();
  return {
    id: 'task-1',
    title: 'Edge case task',
    prompt: 'run edge case',
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

const MAX_TIMER_DELAY_MS = 2_147_483_647;

describe('ScheduledTaskManager – edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-06T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('timer overflow: re-schedules when delay exceeds MAX_TIMER_DELAY_MS, then executes after full delay', async () => {
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const store = createStore([
      createTask({
        id: 'overflow',
        runAt: now + thirtyDaysMs,
        nextRunAt: now + thirtyDaysMs,
        enabled: true,
      }),
    ]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-overflow' });

    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });
    manager.start();

    // Advance by MAX_TIMER_DELAY_MS — handleTrigger fires but task.nextRunAt is still
    // in the future, so it should re-schedule (not execute).
    await vi.advanceTimersByTimeAsync(MAX_TIMER_DELAY_MS);
    expect(executeTask).toHaveBeenCalledTimes(0);

    // The remaining time is thirtyDaysMs - MAX_TIMER_DELAY_MS.
    const remaining = thirtyDaysMs - MAX_TIMER_DELAY_MS;
    await vi.advanceTimersByTimeAsync(remaining);
    expect(executeTask).toHaveBeenCalledTimes(1);

    const after = store.get('overflow');
    expect(after?.enabled).toBe(false);
    expect(after?.lastRunSessionId).toBe('session-overflow');
  });

  it('prepareExecution falls back to disabling task when store.update returns null', async () => {
    const now = Date.now();
    const task = createTask({
      id: 'null-update',
      runAt: now + 1000,
      nextRunAt: now + 1000,
      enabled: true,
      repeatEvery: 5,
      repeatUnit: 'minute',
    });

    // Build a store where update returns null for the first call (simulating
    // a concurrent deletion or race condition), but otherwise works.
    const innerStore = createStore([task]);
    const originalUpdate = innerStore.update.bind(innerStore);
    let updateCallCount = 0;
    innerStore.update = (id, updates) => {
      updateCallCount += 1;
      // First update inside prepareExecution (the nextRunAt advance) → return null
      if (updateCallCount === 1) return null;
      // Second update (fallback disable) → also return null (store gone)
      if (updateCallCount === 2) return null;
      return originalUpdate(id, updates);
    };

    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-null' });
    const manager = new ScheduledTaskManager({ store: innerStore, executeTask, now: () => Date.now() });
    manager.start();

    // Should not throw even though store.update returns null
    await vi.advanceTimersByTimeAsync(1000);

    // executeTask should still be called with the original task (fallback path)
    expect(executeTask).toHaveBeenCalledTimes(1);
  });

  it('rapid toggle: three toggles in quick succession leave task in correct final state', () => {
    const now = Date.now();
    const store = createStore([
      createTask({
        id: 'rapid-toggle',
        runAt: now + 60_000,
        nextRunAt: now + 60_000,
        enabled: true,
        repeatEvery: 5,
        repeatUnit: 'minute',
      }),
    ]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-rapid' });
    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });
    manager.start();

    // Toggle off, on, off rapidly
    manager.toggle('rapid-toggle', false);
    manager.toggle('rapid-toggle', true);
    manager.toggle('rapid-toggle', false);

    const after = store.get('rapid-toggle');
    expect(after?.enabled).toBe(false);
    expect(after?.nextRunAt).toBeNull();

    // Now toggle back on — should be enabled with a valid nextRunAt
    manager.toggle('rapid-toggle', true);
    const final = store.get('rapid-toggle');
    expect(final?.enabled).toBe(true);
    expect(final?.nextRunAt).toBeGreaterThan(now);

    // Access internal timers map to verify exactly one timer exists
    const timers = (manager as any).timers as Map<string, NodeJS.Timeout>;
    expect(timers.size).toBe(1);
    expect(timers.has('rapid-toggle')).toBe(true);
  });

  it('empty times array in daily scheduleConfig normalizes to null (one-time task)', () => {
    const now = Date.now();
    const store = createStore([]);
    const executeTask = vi.fn().mockResolvedValue({ sessionId: 'session-empty-times' });
    const manager = new ScheduledTaskManager({ store, executeTask, now: () => Date.now() });

    // Create a task with daily schedule but empty times array.
    // normalizeScheduleConfig should reduce this to null (no valid config),
    // making the task behave as a one-time task.
    const created = manager.create({
      title: 'Empty times',
      prompt: 'do something',
      cwd: '/tmp/project',
      runAt: now + 60_000,
      scheduleConfig: { kind: 'daily', times: [] },
      enabled: true,
    });

    // scheduleConfig should be normalized to null
    expect(created.scheduleConfig).toBeNull();

    // Since there's no repeat config either, it should be a one-time task
    expect(created.repeatEvery).toBeNull();
    expect(created.repeatUnit).toBeNull();
    expect(created.enabled).toBe(true);
    expect(created.nextRunAt).toBe(now + 60_000);
  });
});
