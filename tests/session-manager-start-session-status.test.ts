import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseInstance, SessionRow } from '../src/main/db/database';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

vi.mock('electron-store', () => {
  class MockStore {
    store: Record<string, unknown> = {};
    path = '/tmp/mock-config.json';
    get(key: string): unknown {
      return this.store[key];
    }
    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = { ...this.store, ...key };
    }
    clear(): void {
      this.store = {};
    }
  }
  return { default: MockStore };
});

vi.mock('../src/main/agent/agent-runner', () => ({
  CoworkAgentRunner: class {
    run = vi.fn();
    cancel = vi.fn();
    handleQuestionResponse = vi.fn();
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: { getEnabledServers: () => [] },
}));

import { SessionManager } from '../src/main/session/session-manager';

function createStatefulDb(): DatabaseInstance {
  const rows = new Map<string, SessionRow>();
  return {
    sessions: {
      create: (session: SessionRow) => {
        rows.set(session.id, { ...session });
      },
      update: (id: string, updates: Partial<SessionRow>) => {
        const existing = rows.get(id);
        if (existing) rows.set(id, { ...existing, ...updates });
      },
      get: (id: string) => rows.get(id),
      getAll: () => [...rows.values()],
      delete: (id: string) => {
        rows.delete(id);
      },
    },
    messages: {
      create: vi.fn(),
      getBySessionId: () => [],
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: () => [],
      deleteBySessionId: vi.fn(),
    },
  } as unknown as DatabaseInstance;
}

describe('SessionManager.startSession status', () => {
  let db: DatabaseInstance;
  let sendToRenderer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = createStatefulDb();
    sendToRenderer = vi.fn();
  });

  it("returns the new session already marked 'running'", async () => {
    const manager = new SessionManager(db, sendToRenderer);
    (manager as unknown as { processPrompt: () => Promise<void> }).processPrompt = vi
      .fn()
      .mockResolvedValue(undefined);

    const session = await manager.startSession('New chat', 'hello');

    expect(session.status).toBe('running');
    expect(sendToRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session.status',
        payload: expect.objectContaining({
          sessionId: session.id,
          status: 'running',
          updatedAt: expect.any(Number),
        }),
      })
    );
  });
});
