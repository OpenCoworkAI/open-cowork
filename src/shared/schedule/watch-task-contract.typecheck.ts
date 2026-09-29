import type { ScheduleCreateInput, ScheduleTask, ScheduleUpdateInput } from '../../renderer/types';
import type { HttpWatchConfig, HttpWatchConfigInput } from './watch-task';

export type Assert<T extends true> = T;

type IsEqual<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? (<Value>() => Value extends Right ? 1 : 2) extends <Value>() => Value extends Left ? 1 : 2
      ? true
      : false
    : false;

type RuntimeStateKey = 'lastState' | 'lastCheckedAt' | 'consecutiveUnchanged' | 'watchConfigError';
type PublicScheduleInputKey = keyof ScheduleCreateInput | keyof ScheduleUpdateInput;

export type ScheduleTaskHasNormalizedWatchConfig = Assert<
  IsEqual<ScheduleTask['watchConfig'], HttpWatchConfig | null>
>;
export type ScheduleTaskHasLastState = Assert<IsEqual<ScheduleTask['lastState'], string | null>>;
export type ScheduleTaskHasLastCheckedAt = Assert<
  IsEqual<ScheduleTask['lastCheckedAt'], number | null>
>;
export type ScheduleTaskHasConsecutiveUnchanged = Assert<
  IsEqual<ScheduleTask['consecutiveUnchanged'], number>
>;
export type ScheduleTaskHasWatchConfigError = Assert<
  IsEqual<ScheduleTask['watchConfigError'], string | null>
>;
export type ScheduleCreateInputHasEditableWatchConfig = Assert<
  IsEqual<ScheduleCreateInput['watchConfig'], HttpWatchConfigInput | null | undefined>
>;
export type ScheduleUpdateInputHasEditableWatchConfig = Assert<
  IsEqual<ScheduleUpdateInput['watchConfig'], HttpWatchConfigInput | null | undefined>
>;
export type RuntimeStateKeysAreExcludedFromPublicInputs = Assert<
  Extract<RuntimeStateKey, PublicScheduleInputKey> extends never ? true : false
>;
