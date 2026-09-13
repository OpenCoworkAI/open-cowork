import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseInstance } from '../src/main/db/database';

// --- Mocks (must be before SessionManager import) ---

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
    public path = '/tmp/mock-perm-store.json';

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

function createMockDb() {
  return {
    sessions: {
      create: vi.fn(),
      get: vi.fn(() => null),
      getAll: vi.fn(() => []),
      update: vi.fn(),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn(),
      getBySessionId: vi.fn(() => []),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
    },
  } as unknown as DatabaseInstance;
}

describe('SessionManager permission timeout', () => {
  let db: DatabaseInstance;
  let sendToRenderer: ReturnType<typeof vi.fn>;
  let manager: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    db = createMockDb();
    sendToRenderer = vi.fn();
    manager = new SessionManager(db, sendToRenderer);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function dismissEvents() {
    return sendToRenderer.mock.calls.filter((c) => c[0].type === 'permission.dismiss');
  }

  function permissionRequests() {
    return sendToRenderer.mock.calls.filter((c) => c[0].type === 'permission.request');
  }

  it('auto-denies after 60s by default with exactly one dismiss event', async () => {
    let result: string | null = null;
    manager.requestPermission('s1', 'tool-1', 'bash', {}).then((r) => {
      result = r;
    });

    expect(permissionRequests()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(result).toBeNull(); // still pending

    await vi.advanceTimersByTimeAsync(1_000);
    expect(result).toBe('deny');
    expect(dismissEvents()).toHaveLength(1);
  });

  it('deferPermissionTimeout extends the window to 5 minutes', async () => {
    let result: string | null = null;
    manager.requestPermission('s1', 'tool-2', 'bash', {}).then((r) => {
      result = r;
    });

    expect(manager.deferPermissionTimeout('tool-2', 300_000)).toBe(true);

    // The old 60s deadline must no longer fire.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(result).toBeNull();

    await vi.advanceTimersByTimeAsync(240_000);
    expect(result).toBe('deny');
    expect(dismissEvents()).toHaveLength(1);
  });

  it('a reply after deferring resolves the permission and leaves no timer behind', async () => {
    let result: string | null = null;
    manager.requestPermission('s1', 'tool-3', 'bash', {}).then((r) => {
      result = r;
    });

    expect(manager.deferPermissionTimeout('tool-3', 300_000)).toBe(true);

    manager.handlePermissionResponse('tool-3', 'allow');
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toBe('allow');

    // Advance far past both deadlines — nothing may fire.
    await vi.advanceTimersByTimeAsync(600_000);
    expect(result).toBe('allow');
    expect(dismissEvents()).toHaveLength(0);
  });

  it('deferPermissionTimeout returns false for an already-settled or unknown id', async () => {
    let result: string | null = null;
    manager.requestPermission('s1', 'tool-4', 'bash', {}).then((r) => {
      result = r;
    });
    manager.handlePermissionResponse('tool-4', 'deny');
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toBe('deny');

    expect(manager.deferPermissionTimeout('tool-4', 300_000)).toBe(false);
    expect(manager.deferPermissionTimeout('never-requested', 300_000)).toBe(false);
  });

  it('each permission request is independent', async () => {
    const results: (string | null)[] = [null, null];
    manager.requestPermission('s1', 'tool-a', 'bash', {}).then((r) => {
      results[0] = r;
    });
    manager.requestPermission('s1', 'tool-b', 'bash', {}).then((r) => {
      results[1] = r;
    });

    manager.handlePermissionResponse('tool-a', 'allow');
    await vi.advanceTimersByTimeAsync(0);
    expect(results[0]).toBe('allow');
    expect(results[1]).toBeNull();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(results[1]).toBe('deny');
  });
});
