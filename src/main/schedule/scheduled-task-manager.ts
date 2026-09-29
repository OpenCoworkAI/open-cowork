/**
 * @module main/schedule/scheduled-task-manager
 *
 * Cron-like scheduled task system (488 lines).
 *
 * Responsibilities:
 * - Scheduled task CRUD with daily/weekly/interval repeat modes
 * - Timer-based execution engine with tick loop
 * - Task persistence via SQLite (ScheduledTask rows)
 * - Delegates execution to session-manager for AI-powered tasks
 *
 * Dependencies: session-manager, database
 */
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
} from '../../shared/schedule/task-title';
import {
  areHttpWatchConfigsEqual,
  normalizeWatchConfig,
  type HttpWatchConfig,
  type HttpWatchConfigInput,
} from '../../shared/schedule/watch-task';
import { log, logError } from '../utils/logger';

export type ScheduleRepeatUnit = 'minute' | 'hour' | 'day';
export type ScheduledTaskWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ScheduledTaskDailyScheduleConfig {
  kind: 'daily';
  times: string[];
}

export interface ScheduledTaskWeeklyScheduleConfig {
  kind: 'weekly';
  weekdays: ScheduledTaskWeekday[];
  times: string[];
}

export type ScheduledTaskScheduleConfig =
  | ScheduledTaskDailyScheduleConfig
  | ScheduledTaskWeeklyScheduleConfig;

export interface ScheduledTask {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  runAt: number;
  nextRunAt: number | null;
  scheduleConfig: ScheduledTaskScheduleConfig | null;
  repeatEvery: number | null;
  repeatUnit: ScheduleRepeatUnit | null;
  enabled: boolean;
  lastRunAt: number | null;
  lastRunSessionId: string | null;
  lastError: string | null;
  watchConfig: HttpWatchConfig | null;
  watchConfigError: string | null;
  lastState: string | null;
  lastCheckedAt: number | null;
  consecutiveUnchanged: number;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledTaskCreateInput {
  title?: string;
  prompt: string;
  cwd: string;
  runAt: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduledTaskScheduleConfig | null;
  watchConfig?: HttpWatchConfigInput | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
}

export interface ScheduledTaskUpdateInput {
  title?: string;
  prompt?: string;
  cwd?: string;
  runAt?: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduledTaskScheduleConfig | null;
  watchConfig?: HttpWatchConfigInput | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
  lastRunAt?: number | null;
  lastRunSessionId?: string | null;
  lastError?: string | null;
}

export type ScheduledTaskStoreCreateInput = ScheduledTaskCreateInput;

export interface ScheduledTaskStoreUpdateInput extends ScheduledTaskUpdateInput {
  lastState?: string | null;
  lastCheckedAt?: number | null;
  consecutiveUnchanged?: number;
}

export interface ScheduledTaskStore {
  list(): ScheduledTask[];
  get(id: string): ScheduledTask | null;
  create(input: ScheduledTaskStoreCreateInput): ScheduledTask;
  update(id: string, updates: ScheduledTaskStoreUpdateInput): ScheduledTask | null;
  delete(id: string): boolean;
}

export interface ScheduledTaskRunResult {
  sessionId: string;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MIN_WATCH_TASK_INTERVAL_MS = 60_000;

interface ScheduledTaskExecutionRecord {
  success: boolean;
  sessionId?: string;
  error?: string;
}

interface ScheduledTaskManagerOptions {
  store: ScheduledTaskStore;
  checkCondition?: (config: HttpWatchConfig) => Promise<string>;
  executeTask: (task: ScheduledTask) => Promise<ScheduledTaskRunResult>;
  onTaskError?: (taskId: string, error: string) => void;
  now?: () => number;
}

export class ScheduledTaskManager {
  private readonly store: ScheduledTaskStore;
  private readonly checkCondition?: (config: HttpWatchConfig) => Promise<string>;
  private readonly executeTask: (task: ScheduledTask) => Promise<ScheduledTaskRunResult>;
  private readonly onTaskError?: (taskId: string, error: string) => void;
  private readonly now: () => number;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly executingTasks = new Set<string>();
  private running = false;

  constructor(options: ScheduledTaskManagerOptions) {
    this.store = options.store;
    this.checkCondition = options.checkCondition;
    this.executeTask = options.executeTask;
    this.onTaskError = options.onTaskError;
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tasks = this.store.list();
    for (const task of tasks) {
      this.scheduleTask(task);
    }
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  list(): ScheduledTask[] {
    return this.store.list().sort((a, b) => {
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
      }
      const aNextRun = a.nextRunAt ?? Number.MAX_SAFE_INTEGER;
      const bNextRun = b.nextRunAt ?? Number.MAX_SAFE_INTEGER;
      if (aNextRun !== bNextRun) {
        return aNextRun - bNextRun;
      }
      return b.createdAt - a.createdAt;
    });
  }

  get(id: string): ScheduledTask | null {
    return this.store.get(id);
  }

  create(input: ScheduledTaskCreateInput): ScheduledTask {
    const normalizedPrompt = input.prompt.trim();
    const normalizedTitle = input.title
      ? buildScheduledTaskTitle(input.title)
      : buildScheduledTaskFallbackTitle(normalizedPrompt);
    const normalizedScheduleConfig = normalizeScheduleConfig(input.scheduleConfig);
    const normalizedRepeatEvery = normalizedScheduleConfig
      ? null
      : normalizeRepeatEvery(input.repeatEvery);
    const normalizedRepeatUnit =
      normalizedScheduleConfig || normalizedRepeatEvery === null
        ? null
        : normalizeRepeatUnit(input.repeatUnit);
    const normalizedWatchConfig = normalizeWatchConfigInput(input.watchConfig);
    if (normalizedWatchConfig !== null && normalizedWatchConfig !== undefined) {
      assertValidWatchTaskSchedule(
        normalizedScheduleConfig,
        normalizedRepeatEvery,
        normalizedRepeatUnit
      );
    }
    const created = this.store.create({
      title: normalizedTitle,
      prompt: normalizedPrompt,
      cwd: input.cwd,
      runAt: input.runAt,
      scheduleConfig: normalizedScheduleConfig,
      nextRunAt: input.nextRunAt ?? input.runAt,
      enabled: input.enabled ?? true,
      watchConfig: normalizedWatchConfig,
      repeatEvery: normalizedRepeatEvery,
      repeatUnit: normalizedRepeatUnit,
    });
    this.scheduleTask(created);
    return created;
  }

  update(id: string, updates: ScheduledTaskUpdateInput): ScheduledTask | null {
    const current = this.store.get(id);
    if (!current) return null;
    const nextPrompt = updates.prompt === undefined ? current.prompt : updates.prompt.trim();
    const nextTitle =
      updates.title === undefined
        ? current.title
        : buildScheduledTaskTitle(updates.title || nextPrompt);
    const normalizedScheduleConfig =
      updates.scheduleConfig === undefined
        ? undefined
        : normalizeScheduleConfig(updates.scheduleConfig);
    const nextScheduleConfig =
      normalizedScheduleConfig === undefined ? current.scheduleConfig : normalizedScheduleConfig;
    const usesScheduleConfig = nextScheduleConfig !== null;
    const normalizedRepeatEvery = usesScheduleConfig
      ? null
      : updates.repeatEvery === undefined
        ? undefined
        : normalizeRepeatEvery(updates.repeatEvery);
    let normalizedRepeatUnit = usesScheduleConfig
      ? null
      : updates.repeatUnit === undefined
        ? undefined
        : normalizeRepeatUnit(updates.repeatUnit);
    if (
      !usesScheduleConfig &&
      normalizedRepeatEvery !== undefined &&
      normalizedRepeatEvery === null
    ) {
      normalizedRepeatUnit = null;
    }
    const nextRepeatEvery = usesScheduleConfig
      ? null
      : normalizedRepeatEvery === undefined
        ? current.repeatEvery
        : normalizedRepeatEvery;
    let nextRepeatUnit = usesScheduleConfig
      ? null
      : normalizedRepeatUnit === undefined
        ? current.repeatUnit
        : normalizedRepeatUnit;
    if (!usesScheduleConfig && nextRepeatEvery === null) {
      nextRepeatUnit = null;
    }
    const normalizedWatchConfig = normalizeWatchConfigInput(updates.watchConfig);
    const nextWatchConfig =
      normalizedWatchConfig === undefined ? current.watchConfig : normalizedWatchConfig;
    if (nextWatchConfig !== null) {
      assertValidWatchTaskSchedule(nextScheduleConfig, nextRepeatEvery, nextRepeatUnit);
    }
    const resetWatchRuntimeState =
      normalizedWatchConfig === null
        ? current.watchConfig !== null || current.watchConfigError !== null
        : normalizedWatchConfig !== undefined &&
          (current.watchConfig === null ||
            !areHttpWatchConfigsEqual(current.watchConfig, normalizedWatchConfig));
    const updated = this.store.update(id, {
      title: nextTitle,
      prompt: nextPrompt,
      scheduleConfig: normalizedScheduleConfig,
      repeatEvery: normalizedRepeatEvery,
      repeatUnit: normalizedRepeatUnit,
      ...(updates.cwd === undefined ? {} : { cwd: updates.cwd }),
      ...(updates.runAt === undefined ? {} : { runAt: updates.runAt }),
      ...(updates.nextRunAt === undefined ? {} : { nextRunAt: updates.nextRunAt }),
      ...(normalizedWatchConfig === undefined ? {} : { watchConfig: normalizedWatchConfig }),
      ...(updates.enabled === undefined ? {} : { enabled: updates.enabled }),
      ...(updates.lastRunAt === undefined ? {} : { lastRunAt: updates.lastRunAt }),
      ...(updates.lastRunSessionId === undefined
        ? {}
        : { lastRunSessionId: updates.lastRunSessionId }),
      ...(resetWatchRuntimeState
        ? { lastError: null }
        : updates.lastError === undefined
          ? {}
          : { lastError: updates.lastError }),
      ...(resetWatchRuntimeState
        ? {
            lastState: null,
            lastCheckedAt: null,
            consecutiveUnchanged: 0,
          }
        : {}),
    });
    if (!updated) return null;
    this.scheduleTask(updated);
    return updated;
  }

  delete(id: string): boolean {
    this.clearTimer(id);
    return this.store.delete(id);
  }

  toggle(id: string, enabled: boolean): ScheduledTask | null {
    const current = this.store.get(id);
    if (!current) return null;
    if (enabled && !isRepeatingTask(current)) {
      const oneTimeRunAt = current.nextRunAt ?? current.runAt;
      if (oneTimeRunAt <= this.now()) {
        throw new Error('Cannot enable: one-time task is overdue. Edit the schedule first.');
      }
    }
    const nextRunAt = enabled ? this.computeToggleNextRunAt(current) : null;
    const updated = this.store.update(id, { enabled, nextRunAt });
    if (!updated) return null;
    this.scheduleTask(updated);
    return updated;
  }

  async runNow(id: string): Promise<ScheduledTask | null> {
    const task = this.store.get(id);
    if (!task) return null;
    if (this.executingTasks.has(id)) {
      throw new Error('Task is already executing');
    }
    this.executingTasks.add(id);
    const taskToExecute = this.prepareExecution(task);
    try {
      const execution = await this.executeTaskPipeline(taskToExecute);
      if (!execution.success) {
        throw new Error(execution.error ?? 'Scheduled task execution failed');
      }
    } finally {
      this.executingTasks.delete(id);
    }
    return this.store.get(id);
  }

  private scheduleTask(task: ScheduledTask): void {
    this.clearTimer(task.id);
    if (!this.running) return;
    if (!task.enabled) return;
    if (task.nextRunAt === null) return;
    const delay = Math.max(0, task.nextRunAt - this.now());
    const effectiveDelay = Math.min(delay, MAX_TIMER_DELAY_MS);
    if (effectiveDelay < delay) {
      log('[Scheduler] Delay clamped to max for task:', task.id);
    }
    const timer = setTimeout(() => {
      this.handleTrigger(task.id);
    }, effectiveDelay);
    this.timers.set(task.id, timer);
  }

  private handleTrigger(taskId: string): void {
    this.timers.delete(taskId);
    const task = this.store.get(taskId);
    if (!task || !task.enabled) return;
    if (task.nextRunAt === null) return;
    if (task.nextRunAt > this.now()) {
      this.scheduleTask(task);
      return;
    }
    if (this.executingTasks.has(taskId)) {
      if (task.watchConfig !== null || task.watchConfigError !== null) {
        const nextRunAt = computeNextRunAt(task, this.now());
        if (nextRunAt !== null) {
          const updated = this.store.update(task.id, { nextRunAt, enabled: true });
          if (updated) {
            this.scheduleTask(updated);
          }
        }
      }
      return;
    }
    this.executingTasks.add(taskId);
    const taskToExecute = this.prepareExecution(task);
    this.executeTaskPipeline(taskToExecute)
      .catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        try {
          this.store.update(taskToExecute.id, {
            lastRunAt: this.now(),
            lastRunSessionId: null,
            lastError: errorMessage,
          });
        } catch (updateError) {
          logError(
            '[ScheduledTaskManager] Failed to update store after unhandled error:',
            updateError
          );
        }
        this.onTaskError?.(taskToExecute.id, errorMessage);
        logError(`[ScheduledTask] Unhandled error executing task ${taskToExecute.id}:`, err);
      })
      .finally(() => {
        this.executingTasks.delete(taskId);
      });
  }

  private prepareExecution(task: ScheduledTask): ScheduledTask {
    this.clearTimer(task.id);

    if (!task.enabled) {
      return task;
    }

    if (isRepeatingTask(task)) {
      const nextRunAt = computeNextRunAt(task, this.now());
      if (nextRunAt !== null) {
        const updated = this.store.update(task.id, {
          nextRunAt,
          enabled: true,
        });
        if (updated) {
          this.scheduleTask(updated);
          return updated;
        }
      }
    }

    return (
      this.store.update(task.id, {
        enabled: false,
        nextRunAt: null,
      }) ?? task
    );
  }

  private computeToggleNextRunAt(task: ScheduledTask): number {
    const now = this.now();
    if (isRepeatingTask(task)) {
      const nextRunAt = computeNextRunAt(task, now);
      if (nextRunAt !== null) {
        return nextRunAt;
      }
    }
    const base = task.nextRunAt ?? task.runAt ?? now;
    return Math.max(base, now);
  }

  private async executeTaskPipeline(task: ScheduledTask): Promise<ScheduledTaskExecutionRecord> {
    if (task.watchConfig !== null) {
      return this.checkAndExecuteWatchTask(task, task.watchConfig, this.now());
    }
    if (task.watchConfigError !== null) {
      return this.recordWatchTaskCheckFailure(task, this.now(), task.watchConfigError);
    }
    return this.executeAndRecord(task);
  }

  private async checkAndExecuteWatchTask(
    task: ScheduledTask,
    config: HttpWatchConfig,
    checkedAt: number
  ): Promise<ScheduledTaskExecutionRecord> {
    if (this.checkCondition === undefined) {
      return this.recordWatchTaskCheckFailure(
        task,
        checkedAt,
        'WatchTask condition checker is unavailable.'
      );
    }

    let currentState: string;
    try {
      currentState = await this.checkCondition(config);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.recordWatchTaskCheckFailure(task, checkedAt, errorMessage);
    }

    const stateUpdate = this.buildWatchTaskStateUpdate(task, currentState, checkedAt);
    const updatedTask = this.persistWatchTaskState(task, stateUpdate.updates);
    if (updatedTask === null) {
      return { success: false, error: 'WatchTask state update could not be persisted.' };
    }
    if (!stateUpdate.shouldExecute) {
      return { success: true };
    }
    return this.executeAndRecord(updatedTask);
  }

  private buildWatchTaskStateUpdate(
    task: ScheduledTask,
    currentState: string,
    checkedAt: number
  ): {
    readonly shouldExecute: boolean;
    readonly updates: ScheduledTaskStoreUpdateInput;
  } {
    if (task.lastState === null) {
      return {
        shouldExecute: false,
        updates: {
          lastState: currentState,
          lastCheckedAt: checkedAt,
          consecutiveUnchanged: 0,
          lastError: null,
        },
      };
    }
    if (task.lastState === currentState) {
      return {
        shouldExecute: false,
        updates: {
          lastCheckedAt: checkedAt,
          consecutiveUnchanged: task.consecutiveUnchanged + 1,
          lastError: null,
        },
      };
    }
    return {
      shouldExecute: true,
      updates: {
        lastState: currentState,
        lastCheckedAt: checkedAt,
        consecutiveUnchanged: 0,
        lastError: null,
      },
    };
  }

  private recordWatchTaskCheckFailure(
    task: ScheduledTask,
    checkedAt: number,
    error: string
  ): ScheduledTaskExecutionRecord {
    const updatedTask = this.persistWatchTaskState(task, {
      lastCheckedAt: checkedAt,
      lastError: error,
    });
    if (updatedTask === null) {
      return { success: false, error: 'WatchTask state update could not be persisted.' };
    }
    this.reportWatchTaskError(task.id, error);
    return { success: false, error };
  }

  private persistWatchTaskState(
    task: ScheduledTask,
    updates: ScheduledTaskStoreUpdateInput
  ): ScheduledTask | null {
    try {
      const updatedTask = this.store.update(task.id, updates);
      if (updatedTask !== null) {
        return updatedTask;
      }
      this.reportWatchTaskError(task.id, 'WatchTask state update returned no task.');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.reportWatchTaskError(task.id, `WatchTask state update failed: ${errorMessage}`);
    }
    return null;
  }

  private reportWatchTaskError(taskId: string, error: string): void {
    this.onTaskError?.(taskId, error);
    logError(`[ScheduledTask] WatchTask check failed for ${taskId}:`, error);
  }

  private async executeAndRecord(task: ScheduledTask): Promise<ScheduledTaskExecutionRecord> {
    try {
      const result = await this.executeTask(task);
      try {
        this.store.update(task.id, {
          lastRunAt: this.now(),
          lastRunSessionId: result.sessionId,
          lastError: null,
        });
      } catch (error) {
        logError('[ScheduledTaskManager] Failed to update store:', error);
      }
      return { success: true, sessionId: result.sessionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        this.store.update(task.id, {
          lastRunAt: this.now(),
          lastRunSessionId: null,
          lastError: message,
        });
      } catch (updateError) {
        logError('[ScheduledTaskManager] Failed to update store:', updateError);
      }
      this.onTaskError?.(task.id, message);
      return { success: false, error: message };
    }
  }

  private clearTimer(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
  }
}

function normalizeRepeatEvery(value: number | null | undefined): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  if (normalized <= 0) return null;
  return normalized;
}

function normalizeRepeatUnit(
  value: ScheduleRepeatUnit | null | undefined
): ScheduleRepeatUnit | null {
  if (value === 'minute' || value === 'hour' || value === 'day') {
    return value;
  }
  return null;
}

function normalizeScheduleConfig(
  value: ScheduledTaskScheduleConfig | null | undefined
): ScheduledTaskScheduleConfig | null {
  if (!value) {
    return null;
  }
  if (value.kind === 'daily') {
    const times = normalizeScheduleTimes(value.times);
    if (times.length === 0) {
      return null;
    }
    return { kind: 'daily', times };
  }
  if (value.kind === 'weekly') {
    const times = normalizeScheduleTimes(value.times);
    const weekdays = normalizeWeekdays(value.weekdays);
    if (times.length === 0 || weekdays.length === 0) {
      return null;
    }
    return { kind: 'weekly', weekdays, times };
  }
  return null;
}

function normalizeWatchConfigInput(
  value: HttpWatchConfigInput | null | undefined
): HttpWatchConfig | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  return normalizeWatchConfig(value);
}

function assertValidWatchTaskSchedule(
  scheduleConfig: ScheduledTaskScheduleConfig | null,
  repeatEvery: number | null,
  repeatUnit: ScheduleRepeatUnit | null
): void {
  if (scheduleConfig !== null) {
    return;
  }
  const intervalMs = getIntervalMs(repeatEvery, repeatUnit);
  if (intervalMs === null) {
    throw new Error('WatchTasks require a repeating interval, daily, or weekly schedule.');
  }
  if (intervalMs < MIN_WATCH_TASK_INTERVAL_MS) {
    throw new Error('WatchTask automatic intervals must be at least 60000 ms.');
  }
}

function isRepeatingTask(task: ScheduledTask): boolean {
  return task.scheduleConfig !== null || Boolean(task.repeatEvery && task.repeatUnit);
}

function computeNextRunAt(task: ScheduledTask, now: number): number | null {
  if (task.scheduleConfig) {
    return computeNextRunAtFromScheduleConfig(task.scheduleConfig, now);
  }
  const intervalMs = getIntervalMs(task.repeatEvery, task.repeatUnit);
  if (intervalMs === null) return null;
  const nextBase = task.nextRunAt ?? task.runAt;
  if (!Number.isFinite(nextBase)) return null;
  if (nextBase > now) return nextBase;
  const skippedIntervals = Math.floor((now - nextBase) / intervalMs) + 1;
  return nextBase + skippedIntervals * intervalMs;
}

function getIntervalMs(
  repeatEvery: number | null,
  repeatUnit: ScheduleRepeatUnit | null
): number | null {
  if (!repeatEvery || !repeatUnit) return null;
  if (repeatUnit === 'minute') return repeatEvery * 60 * 1000;
  if (repeatUnit === 'hour') return repeatEvery * 60 * 60 * 1000;
  return repeatEvery * 24 * 60 * 60 * 1000;
}

function normalizeScheduleTimes(times: string[]): string[] {
  if (!Array.isArray(times)) {
    return [];
  }
  const validTimes = Array.from(
    new Set(times.filter((time) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(time)))
  );
  return validTimes.sort((left, right) => compareTimeStrings(left, right));
}

function normalizeWeekdays(days: number[]): ScheduledTaskWeekday[] {
  if (!Array.isArray(days)) {
    return [];
  }
  const normalized = Array.from(
    new Set(
      days.filter(
        (day): day is ScheduledTaskWeekday => Number.isInteger(day) && day >= 0 && day <= 6
      )
    )
  );
  return normalized.sort((left, right) => left - right);
}

function compareTimeStrings(left: string, right: string): number {
  return toTimeMinutes(left) - toTimeMinutes(right);
}

function toTimeMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function computeNextRunAtFromScheduleConfig(
  scheduleConfig: ScheduledTaskScheduleConfig,
  now: number
): number | null {
  if (scheduleConfig.kind === 'daily') {
    return findNextScheduledSlot(now, scheduleConfig.times);
  }
  return findNextScheduledSlot(now, scheduleConfig.times, scheduleConfig.weekdays);
}

function findNextScheduledSlot(
  now: number,
  times: string[],
  weekdays?: ScheduledTaskWeekday[]
): number | null {
  const normalizedTimes = normalizeScheduleTimes(times);
  if (normalizedTimes.length === 0) {
    return null;
  }
  const allowedWeekdays = weekdays ? new Set(normalizeWeekdays(weekdays)) : null;
  const nowDate = new Date(now);

  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const candidateDate = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate() + dayOffset,
      0,
      0,
      0,
      0
    );
    if (allowedWeekdays && !allowedWeekdays.has(candidateDate.getDay() as ScheduledTaskWeekday)) {
      continue;
    }
    for (const time of normalizedTimes) {
      const [hour, minute] = time.split(':').map(Number);
      const candidate = new Date(
        candidateDate.getFullYear(),
        candidateDate.getMonth(),
        candidateDate.getDate(),
        hour,
        minute,
        0,
        0
      ).getTime();
      if (candidate > now) {
        return candidate;
      }
    }
  }

  return null;
}
