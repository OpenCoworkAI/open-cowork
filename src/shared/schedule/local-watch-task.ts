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
  workspaceEscape: 'schedule.watchWorkspaceEscape',
  sandboxUnavailable: 'schedule.watchSandboxUnavailable',
  outputTooLarge: 'schedule.watchOutputTooLarge',
  fileTooLarge: 'schedule.watchFileTooLarge',
  notRegularFile: 'schedule.watchNotRegularFile',
  timedOut: 'schedule.watchTimedOut',
  commandExited: 'schedule.watchCommandExited',
} as const;

const localWatchErrorKeys = new Set<string>(Object.values(LOCAL_WATCH_CONFIG_ERRORS));
const remoteErrorPrefix = /^Error invoking remote method '[^']+': (?:Error: )?/;
const timedOutPrefix = `${LOCAL_WATCH_CONFIG_ERRORS.timedOut}:`;
const exitedPrefix = `${LOCAL_WATCH_CONFIG_ERRORS.commandExited}:`;
const legacyTimedOut = /^Watch command timed out after (\d+) ms\.$/;
const legacyExited = /^Watch command exited with code (-?\d+|null): ([\s\S]*)$/;
const legacyWatchMessages: Record<string, string> = {
  'Watch command output exceeds 1 MiB.': LOCAL_WATCH_CONFIG_ERRORS.outputTooLarge,
  'Watch file exceeds 10 MiB.': LOCAL_WATCH_CONFIG_ERRORS.fileTooLarge,
  'Watch path must refer to a regular file.': LOCAL_WATCH_CONFIG_ERRORS.notRegularFile,
};

export type WatchTranslate = (key: string, options?: Record<string, unknown>) => string;

export function watchTimedOutMessage(ms: number): string {
  return `${timedOutPrefix}${ms}`;
}

export function watchCommandExitedMessage(code: number | null, detail: string): string {
  return `${exitedPrefix}${code ?? 'null'}:${detail}`;
}

export function localizeWatchConfigError(message: string, translate: WatchTranslate): string {
  const raw = message.replace(remoteErrorPrefix, '');
  if (localWatchErrorKeys.has(raw)) return translate(raw);
  if (raw.startsWith(timedOutPrefix)) {
    const ms = raw.slice(timedOutPrefix.length);
    if (/^\d+$/.test(ms)) return translate(LOCAL_WATCH_CONFIG_ERRORS.timedOut, { ms });
  }
  if (raw.startsWith(exitedPrefix)) {
    const body = raw.slice(exitedPrefix.length);
    const split = body.indexOf(':');
    if (split > 0) {
      const code = body.slice(0, split);
      const detail = body.slice(split + 1);
      if (/^(-?\d+|null)$/.test(code)) {
        return translate(LOCAL_WATCH_CONFIG_ERRORS.commandExited, { code, detail });
      }
    }
  }
  const timedOut = legacyTimedOut.exec(raw);
  if (timedOut) return translate(LOCAL_WATCH_CONFIG_ERRORS.timedOut, { ms: timedOut[1] });
  const exited = legacyExited.exec(raw);
  if (exited) {
    return translate(LOCAL_WATCH_CONFIG_ERRORS.commandExited, {
      code: exited[1],
      detail: exited[2],
    });
  }
  const legacy = legacyWatchMessages[raw];
  return legacy ? translate(legacy) : raw;
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
