import { describe, expect, it, vi } from 'vitest';
import type { DatabaseInstance } from '../src/main/db/database';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-session-manager-cache-config-store.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = {
        ...(options?.defaults || {}),
      };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = {
        ...this.store,
        ...key,
      };
    }
  }

  return { default: MockStore };
});

vi.mock('../src/main/claude/agent-runner', () => ({
  ClaudeAgentRunner: class {
    run = vi.fn();
    cancel = vi.fn();
    handleQuestionResponse = vi.fn();
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getEnabledServers: () => [],
  },
}));

import { SessionManager } from '../src/main/session/session-manager';

describe('SessionManager message cache', () => {
  it('reuses cached session messages and appends saved messages without rereading DB', () => {
    const db = {
      sessions: {
        create: vi.fn(),
        get: vi.fn(),
        getAll: vi.fn(() => []),
        update: vi.fn(),
        delete: vi.fn(),
      },
      messages: {
        create: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm1',
            session_id: 's1',
            role: 'user',
            content: JSON.stringify([{ type: 'text', text: 'hello' }]),
            timestamp: 1,
            token_usage: null,
          },
        ]),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
      },
      traceSteps: {
        create: vi.fn(),
        update: vi.fn(),
        getBySessionId: vi.fn(() => []),
        deleteBySessionId: vi.fn(),
      },
    };

    const manager = new SessionManager(db as unknown as DatabaseInstance, vi.fn());

    const first = manager.getMessages('s1');
    const second = manager.getMessages('s1');

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(db.messages.getBySessionId).toHaveBeenCalledTimes(1);

    manager.saveMessage({
      id: 'm2',
      sessionId: 's1',
      role: 'assistant',
      content: [{ type: 'text', text: 'world' }],
      timestamp: 2,
    });

    const third = manager.getMessages('s1');
    expect(third).toHaveLength(2);
    expect(third[1].id).toBe('m2');
    expect(db.messages.getBySessionId).toHaveBeenCalledTimes(1);
  });
});
