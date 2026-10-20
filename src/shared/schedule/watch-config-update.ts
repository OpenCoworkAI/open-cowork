import type { LocalWatchConfig } from './local-watch-task';

export function watchConfigForTaskUpdate(
  persistedError: string | null | undefined,
  conditionEdited: boolean,
  draft: LocalWatchConfig | null
): LocalWatchConfig | null | undefined {
  if (persistedError && !conditionEdited) return undefined;
  return draft;
}
