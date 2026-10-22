import { describe, expect, it } from 'vitest';
import type { CoreMemoryListEntry, ProgressiveSummaryItem } from '../../main/memory/memory-types';
import { coreUsedItems, experienceUsedItems } from '../../main/memory/memory-used';

describe('coreUsedItems', () => {
  it('lists every entry with its category, key, value and who wrote it', () => {
    const entries: CoreMemoryListEntry[] = [
      {
        combinedKey: 'identity.name',
        category: 'identity',
        key: 'name',
        value: 'Jack',
        userWritten: true,
      },
      {
        combinedKey: 'preferences.response_language',
        category: 'preferences',
        key: 'response_language',
        value: 'Chinese',
        userWritten: false,
      },
    ];

    expect(coreUsedItems(entries)).toEqual([
      { scope: 'core', category: 'identity', key: 'name', value: 'Jack', userWritten: true },
      {
        scope: 'core',
        category: 'preferences',
        key: 'response_language',
        value: 'Chinese',
        userWritten: false,
      },
    ]);
  });

  it('leaves the category out of entries that have none', () => {
    const [item] = coreUsedItems([
      { combinedKey: 'timezone', key: 'timezone', value: 'UTC+8', userWritten: false },
    ]);

    expect(item).toEqual({ scope: 'core', key: 'timezone', value: 'UTC+8', userWritten: false });
    expect(item).not.toHaveProperty('category');
  });
});

describe('experienceUsedItems', () => {
  const chunk: ProgressiveSummaryItem = {
    type: 'chunk',
    id: 'chunk-1',
    sessionId: 'session-a',
    sourceWorkspace: '/repo/a',
    sourceSessionTitle: 'Gateway fixes',
    summary: 'Rotated the gateway token',
  };
  const session: ProgressiveSummaryItem = {
    type: 'session',
    id: 'session-b',
    sessionId: 'session-b',
    sourceWorkspace: null,
    sourceSessionTitle: 'Notes',
    summary: 'Planning notes',
  };

  it('lists the retrieved summaries with the conversation each came from', () => {
    expect(experienceUsedItems([chunk, session], new Set(), new Set())).toEqual([
      {
        scope: 'experience',
        kind: 'chunk',
        sessionId: 'session-a',
        sessionTitle: 'Gateway fixes',
        workspace: '/repo/a',
        summary: 'Rotated the gateway token',
        expanded: false,
      },
      {
        scope: 'experience',
        kind: 'session',
        sessionId: 'session-b',
        sessionTitle: 'Notes',
        workspace: null,
        summary: 'Planning notes',
        expanded: false,
      },
    ]);
  });

  it('marks a chunk as expanded when the chunk or its whole session was read', () => {
    const [byChunk] = experienceUsedItems([chunk], new Set(['chunk-1']), new Set());
    const [bySession] = experienceUsedItems([chunk], new Set(), new Set(['session-a']));
    const [other] = experienceUsedItems([chunk], new Set(['chunk-2']), new Set(['session-b']));

    expect(byChunk).toMatchObject({ expanded: true });
    expect(bySession).toMatchObject({ expanded: true });
    expect(other).toMatchObject({ expanded: false });
  });

  it('marks a session summary as expanded only when that session was read', () => {
    const [chunkExpanded] = experienceUsedItems([session], new Set(['session-b']), new Set());
    const [sessionExpanded] = experienceUsedItems([session], new Set(), new Set(['session-b']));

    expect(chunkExpanded).toMatchObject({ expanded: false });
    expect(sessionExpanded).toMatchObject({ expanded: true });
  });

  it('leaves the title out when the source conversation has none', () => {
    const [item] = experienceUsedItems(
      [{ ...chunk, sourceSessionTitle: undefined, sourceWorkspace: undefined }],
      new Set(),
      new Set()
    );

    expect(item).not.toHaveProperty('sessionTitle');
    expect(item).toMatchObject({ workspace: null });
  });
});
