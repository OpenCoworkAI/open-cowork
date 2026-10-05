import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export type ScheduledTaskRunOutcome =
  | 'baseline'
  | 'unchanged'
  | 'triggered'
  | 'started'
  | 'skipped';

export const LOCAL_WATCH_CONFIG_ERRORS = {
  invalid: 'schedule.watchInvalid',
  fileRequired: 'schedule.watchFileRequired',
  commandRequired: 'schedule.watchCommandRequired',
} as const;

const localWatchErrorKeys = new Set<string>(Object.values(LOCAL_WATCH_CONFIG_ERRORS));

export function localizeWatchConfigError(
  message: string,
  translate: (key: string) => string
): string {
  return localWatchErrorKeys.has(message) ? translate(message) : message;
}

export type LocalWatchConfig =
  | { checkType: 'file'; compareMode: 'content'; checkConfig: { path: string } }
  | {
      checkType: 'command';
      compareMode: 'output';
      checkConfig: { command: string; timeoutMs?: number };
    };

export function isLocalWatchTimeoutValid(config: LocalWatchConfig | null): boolean {
  if (config?.checkType !== 'command') return true;
  const timeoutMs = config.checkConfig.timeoutMs ?? 10000;
  return Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 30000;
}

export function isLocalWatchConditionComplete(config: LocalWatchConfig | null): boolean {
  if (!config) return true;
  const value = config.checkType === 'file' ? config.checkConfig.path : config.checkConfig.command;
  return value.trim().length > 0;
}

const watchSchema = Type.Union([
  Type.Object({
    checkType: Type.Literal('file'),
    compareMode: Type.Literal('content'),
    checkConfig: Type.Object({ path: Type.String({ minLength: 1, maxLength: 4096 }) }),
  }),
  Type.Object({
    checkType: Type.Literal('command'),
    compareMode: Type.Literal('output'),
    checkConfig: Type.Object({
      command: Type.String({ minLength: 1, maxLength: 10000 }),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 30000 })),
    }),
  }),
]);

export function normalizeLocalWatchConfig(input: unknown): LocalWatchConfig {
  if (!Value.Check(watchSchema, input)) {
    throw new Error(LOCAL_WATCH_CONFIG_ERRORS.invalid);
  }
  const config = input as LocalWatchConfig;
  if (config.checkType === 'file') {
    const path = config.checkConfig.path.trim();
    if (!path) throw new Error(LOCAL_WATCH_CONFIG_ERRORS.fileRequired);
    return { checkType: 'file', compareMode: 'content', checkConfig: { path } };
  }
  const command = config.checkConfig.command.trim();
  if (!command) throw new Error(LOCAL_WATCH_CONFIG_ERRORS.commandRequired);
  return {
    checkType: 'command',
    compareMode: 'output',
    checkConfig: { command, timeoutMs: config.checkConfig.timeoutMs ?? 10000 },
  };
}
