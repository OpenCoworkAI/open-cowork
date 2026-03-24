import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Minimal in-memory SQLite-like stub that tracks prepared statements
// ---------------------------------------------------------------------------
interface RowRecord {
  id: string;
  session_id: string;
  content: string;
  metadata: string;
  created_at: number;
}

function createDbStub() {
  const rows: RowRecord[] = [];

  const prepare = vi.fn((sql: string) => {
    const trimmed = sql.trim();

    return {
      run: vi.fn((..._args: unknown[]) => {
        // INSERT INTO memory_entries
        if (/INSERT INTO memory_entries/i.test(trimmed)) {
          const [id, session_id, content, metadata, created_at] = _args as [
            string,
            string,
            string,
            string,
            number,
          ];
          rows.push({ id, session_id, content, metadata, created_at });
        }
        // Reject any INSERT INTO memory_fts — should never be called
        if (/INSERT INTO memory_fts/i.test(trimmed)) {
          throw new Error('memory_fts table does not exist');
        }
      }),
      all: vi.fn((...args: unknown[]) => {
        const [sessionId, likePattern] = args as [string, string];
        const pattern = (likePattern as string).slice(1, -1).toLowerCase(); // strip %...%
        return rows.filter(
          (r) => r.session_id === sessionId && r.content.toLowerCase().includes(pattern)
        );
      }),
    };
  });

  return { prepare, _rows: rows };
}

import { MemoryManager } from '../src/main/memory/memory-manager';

describe('MemoryManager — no memory_fts dependency', () => {
  let db: ReturnType<typeof createDbStub>;
  let manager: MemoryManager;

  beforeEach(() => {
    db = createDbStub();
    manager = new MemoryManager(db as never);
  });

  it('saveMemoryEntry does NOT insert into memory_fts', () => {
    manager.saveMemoryEntry('sess-1', 'hello world', { source: 'test', tags: [] });

    const ftsCall = db.prepare.mock.calls.find(([sql]) => /memory_fts/i.test(sql as string));
    expect(ftsCall).toBeUndefined();
  });

  it('saveMemoryEntry persists to memory_entries', () => {
    const entry = manager.saveMemoryEntry('sess-1', 'store this', { source: 'test', tags: [] });

    expect(entry.id).toBeTruthy();
    expect(entry.content).toBe('store this');
    expect(db._rows).toHaveLength(1);
  });

  it('searchMemory uses LIKE not JOIN memory_fts', () => {
    manager.saveMemoryEntry('sess-1', 'relevant content here', { source: 'test', tags: [] });
    manager.saveMemoryEntry('sess-1', 'unrelated stuff', { source: 'test', tags: [] });

    const results = manager.searchMemory('sess-1', 'relevant');

    // The query used should contain LIKE not memory_fts
    const searchCall = db.prepare.mock.calls.find(
      ([sql]) =>
        /SELECT.*FROM memory_entries/i.test(sql as string) &&
        !/JOIN.*memory_fts/i.test(sql as string)
    );
    expect(searchCall).toBeDefined();

    // No FTS JOIN ever queried
    const ftsJoinCall = db.prepare.mock.calls.find(([sql]) =>
      /JOIN.*memory_fts/i.test(sql as string)
    );
    expect(ftsJoinCall).toBeUndefined();

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('relevant content here');
  });

  it('searchMemory returns empty array when no match', () => {
    manager.saveMemoryEntry('sess-1', 'something else', { source: 'test', tags: [] });
    const results = manager.searchMemory('sess-1', 'nomatch');
    expect(results).toHaveLength(0);
  });
});
