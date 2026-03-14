import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryManager } from '../src/main/memory/memory-manager';

// Create mock database
function createMockDb() {
  const mockRun = vi.fn();
  const mockAll = vi.fn().mockReturnValue([]);
  const mockPrepare = vi.fn().mockReturnValue({ run: mockRun, all: mockAll });

  return {
    prepare: mockPrepare,
    exec: vi.fn(),
    pragma: vi.fn(),
    _mockRun: mockRun,
    _mockAll: mockAll,
  } as any;
}

describe('MemoryManager', () => {
  let db: any;
  let manager: MemoryManager;

  beforeEach(() => {
    db = createMockDb();
    manager = new MemoryManager(db, 180000);
  });

  describe('saveMessage', () => {
    it('saves a message to the database', async () => {
      const message = {
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'Hello' }],
        timestamp: Date.now(),
      };

      await manager.saveMessage('session-1', message);
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO messages'));
      expect(db._mockRun).toHaveBeenCalled();
    });
  });

  describe('getMessageHistory', () => {
    it('returns empty array when no messages', async () => {
      const messages = await manager.getMessageHistory('session-1');
      expect(messages).toEqual([]);
    });

    it('respects limit parameter', async () => {
      await manager.getMessageHistory('session-1', 10);
      const prepareCall = db.prepare.mock.calls[0][0];
      expect(prepareCall).toContain('LIMIT 10');
    });
  });

  describe('searchMessages', () => {
    it('filters messages by keyword', async () => {
      const now = Date.now();
      db._mockAll.mockReturnValue([
        {
          id: 'msg-1',
          session_id: 'session-1',
          role: 'user',
          content: JSON.stringify([{ type: 'text', text: 'Hello world' }]),
          timestamp: now,
          token_usage: null,
        },
        {
          id: 'msg-2',
          session_id: 'session-1',
          role: 'user',
          content: JSON.stringify([{ type: 'text', text: 'Goodbye' }]),
          timestamp: now + 1,
          token_usage: null,
        },
      ]);

      const results = await manager.searchMessages('session-1', 'hello');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('msg-1');
    });
  });

  describe('manageContext', () => {
    it('returns full context when under token limit', async () => {
      db._mockAll.mockReturnValue([
        {
          id: 'msg-1',
          session_id: 'session-1',
          role: 'user',
          content: JSON.stringify([{ type: 'text', text: 'Short message' }]),
          timestamp: Date.now(),
          token_usage: null,
        },
      ]);

      const strategy = await manager.manageContext('session-1');
      expect(strategy.type).toBe('full');
      expect(strategy.messages.length).toBe(1);
    });

    it('returns full context when messages count is <= 20', async () => {
      const messages = Array.from({ length: 15 }, (_, i) => ({
        id: `msg-${i}`,
        session_id: 'session-1',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: JSON.stringify([{ type: 'text', text: `Message ${i}` }]),
        timestamp: Date.now() + i,
        token_usage: null,
      }));
      db._mockAll.mockReturnValue(messages);

      const strategy = await manager.manageContext('session-1');
      expect(strategy.type).toBe('full');
    });
  });

  describe('getRelevantContext', () => {
    it('returns messages sorted by relevance', async () => {
      db._mockAll.mockReturnValue([
        {
          id: 'msg-1',
          session_id: 'session-1',
          role: 'user',
          content: JSON.stringify([{ type: 'text', text: 'talk about programming languages' }]),
          timestamp: Date.now(),
          token_usage: null,
        },
        {
          id: 'msg-2',
          session_id: 'session-1',
          role: 'user',
          content: JSON.stringify([{ type: 'text', text: 'what about weather today' }]),
          timestamp: Date.now() + 1,
          token_usage: null,
        },
      ]);

      const results = await manager.getRelevantContext('session-1', 'programming languages');
      expect(results.length).toBe(2);
      // The programming message should be first (higher relevance)
      expect(results[0].id).toBe('msg-1');
    });
  });

  describe('deleteSessionMessages', () => {
    it('deletes all messages for a session', async () => {
      await manager.deleteSessionMessages('session-1');
      expect(db.prepare).toHaveBeenCalledWith('DELETE FROM messages WHERE session_id = ?');
      expect(db._mockRun).toHaveBeenCalledWith('session-1');
    });
  });

  describe('deleteSessionMemory', () => {
    it('deletes all memory entries for a session', async () => {
      await manager.deleteSessionMemory('session-1');
      expect(db.prepare).toHaveBeenCalledWith('DELETE FROM memory_entries WHERE session_id = ?');
      expect(db._mockRun).toHaveBeenCalledWith('session-1');
    });
  });
});
