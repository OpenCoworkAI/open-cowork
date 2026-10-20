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
import { log, logError } from '../utils/logger';
import {
  normalizeLocalWatchConfig,
  type LocalWatchConfig,
  type ScheduledTaskRunOutcome,
} from '../../shared/schedule/local-watch-task';

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
  watchConfig?: LocalWatchConfig | null;
  watchConfigError?: string | null;
  lastState?: string | null;
  lastCheckedAt?: number | null;
  consecutiveUnchanged?: number;
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
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledTaskCreateInput {
  watchConfig?: LocalWatchConfig | null;
  title?: string;
  prompt: string;
  cwd: string;
  runAt: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduledTaskScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
}

export interface ScheduledTaskUpdateInput {
  watchConfig?: LocalWatchConfig | null;
  title?: string;
  prompt?: string;
  cwd?: string;
  runAt?: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduledTaskScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
}

export interface ScheduledTaskStoreUpdate extends ScheduledTaskUpdateInput {
  lastState?: string | null;
  lastCheckedAt?: number | null;
  consecutiveUnchanged?: number;
  lastRunAt?: number | null;
  lastRunSessionId?: string | null;
  lastError?: string | null;
}

export interface ScheduledTaskStore {
  list(): ScheduledTask[];
  get(id: string): ScheduledTask | null;
  create(input: ScheduledTaskCreateInput): ScheduledTask;
  update(id: string, updates: ScheduledTaskStoreUpdate): ScheduledTask | null;
  delete(id: string): boolean;
}

export interface ScheduledTaskRunResult {
  sessionId: string;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface ScheduledTaskExecutionRecord {
  success: boolean;
  outcome?: ScheduledTaskRunOutcome;
  sessionId?: string;
  error?: string;
}

interface ScheduledTaskManagerOptions {
  store: ScheduledTaskStore;
  executeTask: (task: ScheduledTask) => Promise<ScheduledTaskRunResult>;
  checkCondition?: (task: ScheduledTask) => Promise<string>;
  onTaskError?: (taskId: string, error: string) => void;
  now?: () => number;
}

export class ScheduledTaskManager {
  private readonly store: ScheduledTaskStore;
  private readonly executeTask: (task: ScheduledTask) => Promise<ScheduledTaskRunResult>;
  private readonly checkCondition?: (task: ScheduledTask) => Promise<string>;
  private readonly onTaskError?: (taskId: string, error: string) => void;
  private readonly now: () => number;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly executingTasks = new Set<string>();
  private running = false;

  constructor(options: ScheduledTaskManagerOptions) {
    this.store = options.store;
    this.executeTask = options.executeTask;
    this.checkCondition = options.checkCondition;
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
    const watchConfig =
      input.watchConfig == null ? null : normalizeLocalWatchConfig(input.watchConfig);
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
    if (
      watchConfig &&
      !normalizedScheduleConfig &&
      !(normalizedRepeatEvery && normalizedRepeatUnit)
    ) {
      throw new Error('Conditional tasks require a repeating schedule.');
    }
    const created = this.store.create({
      ...input,
      watchConfig,
      title: normalizedTitle,
      prompt: normalizedPrompt,
      scheduleConfig: normalizedScheduleConfig,
      nextRunAt: input.nextRunAt ?? input.runAt,
      enabled: input.enabled ?? true,
      repeatEvery: normalizedRepeatEvery,
      repeatUnit: normalizedRepeatUnit,
    });
    this.scheduleTask(created);
    return created;
  }

  update(id: string, updates: ScheduledTaskUpdateInput): ScheduledTask | null {
    const current = this.store.get(id);
    if (!current) return null;
    const watchConfig =
      updates.watchConfig === undefined
        ? current.watchConfig
        : updates.watchConfig === null
          ? null
          : normalizeLocalWatchConfig(updates.watchConfig);
    const resetBaseline =
      JSON.stringify(watchConfig) !== JSON.stringify(current.watchConfig) ||
      (updates.cwd !== undefined && updates.cwd !== current.cwd);
    const nextPrompt = updates.prompt === undefined ? current.prompt : updates.prompt.trim();
    const nextTitle =
      updates.title === undefined
        ? current.title
        : buildScheduledTaskTitle(updates.title || nextPrompt);
    const nextScheduleConfig =
      updates.scheduleConfig === undefined
        ? undefined
        : normalizeScheduleConfig(updates.scheduleConfig);
    const usesScheduleConfig =
      nextScheduleConfig !== undefined
        ? nextScheduleConfig !== null
        : current.scheduleConfig !== null;
    const nextRepeatEvery = usesScheduleConfig
      ? null
      : updates.repeatEvery === undefined
        ? undefined
        : normalizeRepeatEvery(updates.repeatEvery);
    let nextRepeatUnit = usesScheduleConfig
      ? null
      : updates.repeatUnit === undefined
        ? undefined
        : normalizeRepeatUnit(updates.repeatUnit);
    if (!usesScheduleConfig && nextRepeatEvery !== undefined && nextRepeatEvery === null) {
      nextRepeatUnit = null;
    }
    if (
      watchConfig &&
      !usesScheduleConfig &&
      !(
        (nextRepeatEvery === undefined ? current.repeatEvery : nextRepeatEvery) &&
        (nextRepeatUnit === undefined ? current.repeatUnit : nextRepeatUnit)
      )
    ) {
      throw new Error('Conditional tasks require a repeating schedule.');
    }
    const updated = this.store.update(id, {
      cwd: updates.cwd,
      runAt: updates.runAt,
      nextRunAt: updates.nextRunAt,
      enabled: updates.enabled,
      watchConfig: updates.watchConfig === undefined ? undefined : watchConfig,
      ...(resetBaseline ? { lastState: null, lastCheckedAt: null, consecutiveUnchanged: 0 } : {}),
      prompt: nextPrompt,
      title: nextTitle,
      scheduleConfig: nextScheduleConfig,
      repeatEvery: nextRepeatEvery,
      repeatUnit: nextRepeatUnit,
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

  async runNow(
    id: string
  ): Promise<{ task: ScheduledTask; outcome: ScheduledTaskRunOutcome } | null> {
    const task = this.store.get(id);
    if (!task) return null;
    if (this.executingTasks.has(id)) {
      throw new Error('Task is already executing');
    }
    this.executingTasks.add(id);
    const taskToExecute = this.prepareExecution(task);
    try {
      const execution = await this.executeAndRecord(taskToExecute);
      if (!execution.success) {
        throw new Error(execution.error ?? 'Scheduled task execution failed');
      }
      const current = this.store.get(id);
      return current ? { task: current, outcome: execution.outcome ?? 'started' } : null;
    } finally {
      this.executingTasks.delete(id);
    }
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
      // Preserve the next slot while a long check or agent run owns this task.
      this.prepareExecution(task);
      return;
    }
    this.executingTasks.add(taskId);
    const taskToExecute = this.prepareExecution(task);
    this.executeAndRecord(taskToExecute)
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

  private async executeAndRecord(task: ScheduledTask): Promise<ScheduledTaskExecutionRecord> {
    let checkingCondition = Boolean(task.watchConfig || task.watchConfigError);
    let executionTask = task;
    try {
      if (task.watchConfigError) throw new Error(task.watchConfigError);
      if (task.watchConfig) {
        if (!this.checkCondition) throw new Error('Condition checker is unavailable.');
        const state = await this.checkCondition(task);
        const current = this.store.get(task.id);
        if (!current || !this.isCurrentCondition(task, current))
          return { success: true, outcome: 'skipped' };
        const baseline = current.lastState == null;
        const unchanged = current.lastState === state;
        // Commit observations before starting the agent; failure must not replay a change.
        const observed = this.store.update(task.id, {
          lastState: state,
          lastCheckedAt: this.now(),
          consecutiveUnchanged: unchanged ? (current.consecutiveUnchanged ?? 0) + 1 : 0,
          lastError: null,
        });
        if (!observed) return { success: true, outcome: 'skipped' };
        if (baseline || unchanged)
          return { success: true, outcome: baseline ? 'baseline' : 'unchanged' };
        executionTask = observed;
      }
      checkingCondition = false;
      const result = await this.executeTask(executionTask);
      try {
        this.store.update(task.id, {
          lastRunAt: this.now(),
          lastRunSessionId: result.sessionId,
          lastError: null,
        });
      } catch (error) {
        logError('[ScheduledTaskManager] Failed to update store:', error);
      }
      return {
        success: true,
        sessionId: result.sessionId,
        outcome: task.watchConfig ? 'triggered' : 'started',
      };
    } catch (error) {
      if (checkingCondition && !this.isCurrentCondition(task))
        return { success: true, outcome: 'skipped' };
      const message = error instanceof Error ? error.message : String(error);
      try {
        this.store.update(task.id, {
          ...(!task.watchConfig && !task.watchConfigError
            ? { lastRunAt: this.now(), lastRunSessionId: null }
            : { lastCheckedAt: this.now() }),
          lastError: message,
        });
      } catch (updateError) {
        logError('[ScheduledTaskManager] Failed to update store:', updateError);
      }
      this.onTaskError?.(task.id, message);
      return { success: false, error: message };
    }
  }

  private isCurrentCondition(
    task: ScheduledTask,
    current: ScheduledTask | null = this.store.get(task.id)
  ): boolean {
    return Boolean(
      current &&
      current.cwd === task.cwd &&
      current.enabled === task.enabled &&
      current.watchConfigError === task.watchConfigError &&
      JSON.stringify(current.watchConfig) === JSON.stringify(task.watchConfig)
    );
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
