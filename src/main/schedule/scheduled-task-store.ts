import { v4 as uuidv4 } from 'uuid';
import type { DatabaseInstance, ScheduledTaskRow } from '../db/database';
import { normalizeWatchConfig, parsePersistedWatchConfig } from '../../shared/schedule/watch-task';
import type { HttpWatchConfigInput } from '../../shared/schedule/watch-task';
import type {
  ScheduledTask,
  ScheduledTaskStore,
  ScheduledTaskStoreCreateInput,
  ScheduledTaskStoreUpdateInput,
} from './scheduled-task-manager';

export type ScheduledTaskDatabase = Pick<DatabaseInstance, 'scheduledTasks'>;

export function createScheduledTaskStore(db: ScheduledTaskDatabase): ScheduledTaskStore {
  return {
    list: () => db.scheduledTasks.getAll().map(mapRowToTask),
    get: (id: string) => {
      const row = db.scheduledTasks.get(id);
      return row ? mapRowToTask(row) : null;
    },
    create: (input: ScheduledTaskStoreCreateInput) => {
      const now = Date.now();
      const row: ScheduledTaskRow = {
        id: uuidv4(),
        title: input.title ?? '',
        prompt: input.prompt,
        cwd: input.cwd,
        run_at: input.runAt,
        next_run_at: input.nextRunAt ?? input.runAt,
        schedule_config: input.scheduleConfig ? JSON.stringify(input.scheduleConfig) : null,
        watch_config: serializeWatchConfig(input.watchConfig),
        last_state: null,
        last_checked_at: null,
        consecutive_unchanged: 0,
        repeat_every: input.repeatEvery ?? null,
        repeat_unit: input.repeatUnit ?? null,
        enabled: input.enabled === false ? 0 : 1,
        last_run_at: null,
        last_run_session_id: null,
        last_error: null,
        created_at: now,
        updated_at: now,
      };
      db.scheduledTasks.create(row);
      return mapRowToTask(row);
    },
    update: (id: string, updates: ScheduledTaskStoreUpdateInput) => {
      const mapped = mapTaskUpdatesToRow(updates);
      db.scheduledTasks.update(id, mapped);
      const row = db.scheduledTasks.get(id);
      return row ? mapRowToTask(row) : null;
    },
    delete: (id: string) => {
      const existing = db.scheduledTasks.get(id);
      if (!existing) return false;
      db.scheduledTasks.delete(id);
      return true;
    },
  };
}

function mapRowToTask(row: ScheduledTaskRow): ScheduledTask {
  const watch = mapPersistedWatchConfig(row.watch_config);

  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    cwd: row.cwd,
    runAt: row.run_at,
    nextRunAt: row.next_run_at,
    scheduleConfig: parseScheduleConfig(row.schedule_config),
    repeatEvery: row.repeat_every,
    repeatUnit: row.repeat_unit as ScheduledTask['repeatUnit'],
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    lastRunSessionId: row.last_run_session_id,
    lastError: row.last_error,
    ...watch,
    lastState: row.last_state ?? null,
    lastCheckedAt: row.last_checked_at ?? null,
    consecutiveUnchanged: row.consecutive_unchanged ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTaskUpdatesToRow(updates: ScheduledTaskStoreUpdateInput): Partial<ScheduledTaskRow> {
  const mapped: Partial<ScheduledTaskRow> = {};
  if (updates.title !== undefined) mapped.title = updates.title;
  if (updates.prompt !== undefined) mapped.prompt = updates.prompt;
  if (updates.cwd !== undefined) mapped.cwd = updates.cwd;
  if (updates.runAt !== undefined) mapped.run_at = updates.runAt;
  if (updates.nextRunAt !== undefined) mapped.next_run_at = updates.nextRunAt;
  if (updates.scheduleConfig !== undefined) {
    mapped.schedule_config = updates.scheduleConfig ? JSON.stringify(updates.scheduleConfig) : null;
  }
  if (updates.watchConfig !== undefined) {
    mapped.watch_config = serializeWatchConfig(updates.watchConfig);
  }
  if (updates.repeatEvery !== undefined) mapped.repeat_every = updates.repeatEvery;
  if (updates.repeatUnit !== undefined) mapped.repeat_unit = updates.repeatUnit;
  if (updates.enabled !== undefined) mapped.enabled = updates.enabled ? 1 : 0;
  if (updates.lastRunAt !== undefined) mapped.last_run_at = updates.lastRunAt;
  if (updates.lastRunSessionId !== undefined) mapped.last_run_session_id = updates.lastRunSessionId;
  if (updates.lastError !== undefined) mapped.last_error = updates.lastError;
  if (updates.lastState !== undefined) mapped.last_state = updates.lastState;
  if (updates.lastCheckedAt !== undefined) mapped.last_checked_at = updates.lastCheckedAt;
  if (updates.consecutiveUnchanged !== undefined) {
    mapped.consecutive_unchanged = updates.consecutiveUnchanged;
  }
  return mapped;
}

function serializeWatchConfig(value: HttpWatchConfigInput | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.stringify(normalizeWatchConfig(value));
}

function mapPersistedWatchConfig(
  value: string | null | undefined
): Pick<ScheduledTask, 'watchConfig' | 'watchConfigError'> {
  const parsed = parsePersistedWatchConfig(value ?? null);

  switch (parsed.kind) {
    case 'none':
      return { watchConfig: null, watchConfigError: null };
    case 'valid':
      return { watchConfig: parsed.config, watchConfigError: null };
    case 'invalid':
      return { watchConfig: null, watchConfigError: parsed.error };
    default:
      return assertNever(parsed);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected persisted watch configuration result: ${String(value)}`);
}

function parseScheduleConfig(value: string | null): ScheduledTask['scheduleConfig'] {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as ScheduledTask['scheduleConfig'];
  } catch {
    return null;
  }
}
