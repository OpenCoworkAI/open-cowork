import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export type ScheduledTaskRunOutcome =
  | 'baseline'
  | 'unchanged'
  | 'triggered'
  | 'started'
  | 'skipped';

export type LocalWatchConfig =
  | { checkType: 'file'; compareMode: 'content'; checkConfig: { path: string } }
  | {
      checkType: 'command';
      compareMode: 'output';
      checkConfig: { command: string; timeoutMs?: number };
    };

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
    throw new Error(
      'Invalid watch configuration: select a file or command and a timeout from 1000 to 30000 ms.'
    );
  }
  const config = input as LocalWatchConfig;
  if (config.checkType === 'file') {
    const path = config.checkConfig.path.trim();
    if (!path) throw new Error('Watch file path is required.');
    return { checkType: 'file', compareMode: 'content', checkConfig: { path } };
  }
  const command = config.checkConfig.command.trim();
  if (!command) throw new Error('Watch command is required.');
  return {
    checkType: 'command',
    compareMode: 'output',
    checkConfig: { command, timeoutMs: config.checkConfig.timeoutMs ?? 10000 },
  };
}
