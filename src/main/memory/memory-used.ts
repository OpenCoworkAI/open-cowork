import type { MemoryUsedItem } from '../../renderer/types';
import type { CoreMemoryListEntry, ProgressiveSummaryItem } from './memory-types';

/** The memory injected into one run, ready to show in the trace panel. */
export interface PromptMemoryContext {
  promptPrefix: string;
  used: MemoryUsedItem[];
}

/** Every core entry is injected into the prompt, so every entry was used. */
export function coreUsedItems(entries: CoreMemoryListEntry[]): MemoryUsedItem[] {
  return entries.map((entry) => ({
    scope: 'core',
    ...(entry.category ? { category: entry.category } : {}),
    key: entry.key,
    value: entry.value,
    userWritten: entry.userWritten,
  }));
}

/**
 * The retrieved summaries are what the model was given. An item is marked
 * expanded when the navigator also read the chunk, or the session it came from,
 * in full.
 */
export function experienceUsedItems(
  summaries: ProgressiveSummaryItem[],
  expandedChunkIds: ReadonlySet<string>,
  expandedSessionIds: ReadonlySet<string>
): MemoryUsedItem[] {
  return summaries.map((item) => ({
    scope: 'experience',
    kind: item.type,
    sessionId: item.sessionId,
    ...(item.sourceSessionTitle ? { sessionTitle: item.sourceSessionTitle } : {}),
    workspace: item.sourceWorkspace ?? null,
    summary: item.summary,
    expanded:
      (item.type === 'chunk' && expandedChunkIds.has(item.id)) ||
      expandedSessionIds.has(item.sessionId),
  }));
}
