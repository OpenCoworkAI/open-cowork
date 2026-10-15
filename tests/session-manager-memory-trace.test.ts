import { describe, expect, it, vi } from 'vitest';
import type { DatabaseInstance, TraceStepRow } from '../src/main/db/database';
import type { MemoryUsedItem, ServerEvent, TraceStep } from '../src/renderer/types';

const runner = vi.hoisted(() => ({
  sendToRenderer: null as null | ((event: ServerEvent) => void),
}));

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
    public path = '/tmp/mock-session-manager-memory-trace-config-store.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...(options?.defaults || {}) };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = { ...this.store, ...key };
    }
  }
  return { default: MockStore };
});

vi.mock('../src/main/agent/agent-runner', () => ({
  CoworkAgentRunner: class {
    constructor(options: { sendToRenderer: (event: ServerEvent) => void }) {
      runner.sendToRenderer = options.sendToRenderer;
    }
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getEnabledServers: () => [],
  },
}));

import { SessionManager } from '../src/main/session/session-manager';

const items: MemoryUsedItem[] = [
  { scope: 'core', category: 'identity', key: 'name', value: 'Jack', userWritten: false },
  {
    scope: 'experience',
    kind: 'chunk',
    sessionId: 'session-a',
    sessionTitle: 'Gateway fixes',
    workspace: '/repo/a',
    summary: 'Rotated the gateway token',
    expanded: true,
  },
];

function makeDb(rows: TraceStepRow[] = []) {
  return {
    sessions: { create: vi.fn(), get: vi.fn(() => null), getAll: vi.fn(() => []) },
    messages: { create: vi.fn(), getBySessionId: vi.fn(() => []) },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => rows),
      deleteBySessionId: vi.fn(),
    },
  } as unknown as DatabaseInstance;
}

function row(overrides: Partial<TraceStepRow>): TraceStepRow {
  return {
    id: 'step-1',
    session_id: 's1',
    type: 'memory',
    status: 'completed',
    title: 'Memory used',
    content: null,
    tool_name: null,
    tool_input: null,
    tool_output: null,
    is_error: null,
    memory_items: null,
    timestamp: 5,
    duration: null,
    ...overrides,
  };
}

describe('SessionManager memory trace steps', () => {
  it('stores the memory items of a trace step as JSON', () => {
    const db = makeDb();
    const sendToRenderer = vi.fn();
    new SessionManager(db, sendToRenderer);
    const step: TraceStep = {
      id: 'memory-1',
      type: 'memory',
      status: 'completed',
      title: 'Memory used',
      memoryItems: items,
      timestamp: 5,
    };

    runner.sendToRenderer?.({ type: 'trace.step', payload: { sessionId: 's1', step } });

    expect(db.traceSteps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'memory-1',
        session_id: 's1',
        type: 'memory',
        memory_items: JSON.stringify(items),
      })
    );
    expect(sendToRenderer).toHaveBeenCalled();
  });

  it('stores no memory items for steps that carry none', () => {
    const db = makeDb();
    new SessionManager(db, vi.fn());
    const step: TraceStep = {
      id: 'thinking-1',
      type: 'thinking',
      status: 'running',
      title: 'Thinking',
      timestamp: 5,
    };

    runner.sendToRenderer?.({ type: 'trace.step', payload: { sessionId: 's1', step } });

    expect(db.traceSteps.create).toHaveBeenCalledWith(
      expect.objectContaining({ memory_items: null })
    );
  });

  it('restores the memory items of saved steps and leaves other steps without them', () => {
    const db = makeDb([
      row({ id: 'memory-1', memory_items: JSON.stringify(items) }),
      row({ id: 'thinking-1', type: 'thinking', memory_items: null }),
    ]);
    const manager = new SessionManager(db, vi.fn());

    const steps = manager.getTraceSteps('s1');

    expect(steps[0].memoryItems).toEqual(items);
    expect(steps[1].memoryItems).toBeUndefined();
  });
});
