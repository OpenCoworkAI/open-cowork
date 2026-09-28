import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

/**
 * Regression tests for src/main/remote/remote-manager.ts remote session id
 * mapping lifecycle:
 *
 * - Issue #291: clearSessionBuffer() ran on every turn completion and tore down
 *   the persistent session id mappings, while remoteSessionIds (only ever added
 *   to) kept the remote id. The next turn saw isNewSession === false but could
 *   not resolve the actual session id and threw "No actual session ID found".
 * - Stale binding after session deletion: deleting a channel-bound session from
 *   the desktop UI removed it from cowork.db while the in-memory mapping
 *   survived, so every later channel message threw "Session not found" and the
 *   bot replied "internal error" until restart. executeAgent now self-heals,
 *   and handleSessionDeleted (onSessionDeleted hook) clears bindings eagerly.
 */

vi.mock('electron', () => {
  const app = {
    getPath: () => '/tmp/test-user-data',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    on: vi.fn(),
    getName: () => 'test',
    name: 'test',
  };
  const ipcMain = { on: vi.fn(), handle: vi.fn() };
  const shell = {};
  const electron = { app, ipcMain, shell, BrowserWindow: vi.fn() };
  return { ...electron, default: electron };
});

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import { RemoteManager, type AgentExecutor } from '../src/main/remote/remote-manager';
import { SessionNotFoundError } from '../src/main/session/session-errors';
import { AgentRuntimeExtensionManager } from '../src/main/extensions/agent-runtime-extension-manager';
import type { RemoteMessage } from '../src/main/remote/types';

/** Route a message the way channels do (via the public RemoteManager API). */
function route(manager: RemoteManager, message: RemoteMessage): Promise<void> {
  return manager.routeMessage(message);
}

function makeMessage(channelId: string, text: string): RemoteMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    channelType: 'stdio' as RemoteMessage['channelType'],
    channelId,
    sender: { id: 'stdio-user', name: 'stdio', isBot: false },
    content: { type: 'text', text },
    timestamp: 1_700_000_000_000,
    isGroup: false,
    isMentioned: true,
  };
}

describe('RemoteManager multi-turn session mapping (issue #291)', () => {
  let manager: RemoteManager;
  let startSession: Mock;
  let continueSession: Mock;
  let hasSession: Mock;
  let sessionCounter: number;

  beforeEach(() => {
    manager = new RemoteManager();
    sessionCounter = 0;
    startSession = vi.fn(async (_title: string, prompt: string, cwd?: string) => {
      sessionCounter++;
      return {
        id: `actual-session-${sessionCounter}`,
        title: prompt.slice(0, 10),
        cwd,
        messages: [],
      } as unknown as Awaited<ReturnType<AgentExecutor['startSession']>>;
    });
    continueSession = vi.fn(async () => {});
    hasSession = vi.fn(() => true);

    const executor = {
      startSession,
      continueSession,
      stopSession: vi.fn(async () => {}),
      hasSession,
    } as unknown as AgentExecutor;
    manager.setAgentExecutor(executor);
    // No renderer callback needed; emitRemoteUserMessage no-ops without one.
  });

  it('continues an existing session on the second turn instead of throwing', async () => {
    const channelId = 'stdio-abc';

    // Turn 1: starts a new session.
    await route(manager, makeMessage(channelId, 'hello'));
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(continueSession).not.toHaveBeenCalled();

    const actualSessionId = 'actual-session-1';
    expect(manager.isRemoteSession(actualSessionId)).toBe(true);

    // Simulate turn completion clearing the ephemeral buffer
    // (this is what session.status idle/error triggers in index.ts).
    await manager.clearSessionBuffer(actualSessionId);

    // The persistent mapping must survive the per-turn cleanup.
    expect(manager.isRemoteSession(actualSessionId)).toBe(true);

    // Turn 2: same channel session -> must continue, not throw, not re-start.
    await expect(route(manager, makeMessage(channelId, 'again'))).resolves.not.toThrow();
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(continueSession).toHaveBeenCalledTimes(1);
    expect(continueSession).toHaveBeenCalledWith(
      actualSessionId,
      'again',
      expect.anything(),
      undefined
    );
  });

  it('clearSessionBuffer does not remove persistent session id mappings', async () => {
    await route(manager, makeMessage('stdio-xyz', 'hi'));
    const actualSessionId = 'actual-session-1';

    await manager.clearSessionBuffer(actualSessionId);

    expect(manager.getRemoteSessionId(actualSessionId)).toBeDefined();
    expect(manager.isRemoteSession(actualSessionId)).toBe(true);
  });

  it('removeRemoteSession tears down mappings so the id can no longer be continued', async () => {
    await route(manager, makeMessage('stdio-teardown', 'hi'));
    const actualSessionId = 'actual-session-1';
    expect(manager.isRemoteSession(actualSessionId)).toBe(true);

    await manager.removeRemoteSession(actualSessionId);

    expect(manager.isRemoteSession(actualSessionId)).toBe(false);
    expect(manager.getRemoteSessionId(actualSessionId)).toBeUndefined();

    // A subsequent message on the same channel starts a fresh session
    // (remoteSessionIds was cleared in lockstep, so no drift/throw).
    await expect(route(manager, makeMessage('stdio-teardown', 'again'))).resolves.not.toThrow();
    expect(startSession).toHaveBeenCalledTimes(2);
  });

  it('clearRemoteSession cascades teardown so the next message starts fresh', async () => {
    await route(manager, makeMessage('stdio-cascade', 'hi'));
    const actualSessionId = 'actual-session-1';
    const remoteSessionId = manager.getRemoteSessionId(actualSessionId);
    expect(remoteSessionId).toBeDefined();

    expect(await manager.clearRemoteSession(remoteSessionId!)).toBe(true);
    expect(manager.isRemoteSession(actualSessionId)).toBe(false);

    // After full teardown the remote id is forgotten, so the next message on
    // the same channel session creates a brand-new agent session.
    await route(manager, makeMessage('stdio-cascade', 'again'));
    expect(startSession).toHaveBeenCalledTimes(2);
  });

  it('clearRemoteSession also accepts the actual session id (id-agnostic)', async () => {
    await route(manager, makeMessage('stdio-agnostic', 'hi'));
    const actualSessionId = 'actual-session-1';

    // A caller passing the actual (internal) session id must still trigger the
    // full teardown — otherwise remoteSessionIds would stay populated and the
    // mapping leak would resurface through this path.
    expect(await manager.clearRemoteSession(actualSessionId)).toBe(true);
    expect(manager.isRemoteSession(actualSessionId)).toBe(false);
    expect(manager.getRemoteSessionId(actualSessionId)).toBeUndefined();

    await route(manager, makeMessage('stdio-agnostic', 'again'));
    expect(startSession).toHaveBeenCalledTimes(2);
  });

  it('clearRemoteSession with an unknown id is a harmless no-op', async () => {
    await route(manager, makeMessage('stdio-unknown', 'hi'));
    const actualSessionId = 'actual-session-1';

    expect(await manager.clearRemoteSession('remote-does-not-exist')).toBe(false);

    // Existing state untouched: the next message still continues the session.
    expect(manager.isRemoteSession(actualSessionId)).toBe(true);
    await manager.clearSessionBuffer(actualSessionId);
    await route(manager, makeMessage('stdio-unknown', 'again'));
    expect(continueSession).toHaveBeenCalledTimes(1);
    expect(startSession).toHaveBeenCalledTimes(1);
  });

  it('self-heals a stale binding when the actual session was deleted', async () => {
    await route(manager, makeMessage('stdio-stale', 'hi'));
    expect(startSession).toHaveBeenCalledTimes(1);

    // The desktop UI deleted actual-session-1 (gone from cowork.db), but the
    // in-memory mapping survives — the regression this guards against is the
    // channel replying "internal error" forever until restart. This exercises
    // the catch path (probe said alive, continue failed) via the string
    // fallback used by executors that predate SessionNotFoundError.
    continueSession.mockRejectedValueOnce(new Error('Session not found: actual-session-1'));

    await route(manager, makeMessage('stdio-stale', 'again'));
    // The stale binding was dropped and a fresh session created in one turn.
    expect(startSession).toHaveBeenCalledTimes(2);
    expect(manager.isRemoteSession('actual-session-1')).toBe(false);
    expect(manager.isRemoteSession('actual-session-2')).toBe(true);

    // Subsequent turns continue the healed session.
    await route(manager, makeMessage('stdio-stale', 'once more'));
    expect(continueSession).toHaveBeenLastCalledWith(
      'actual-session-2',
      'once more',
      expect.anything(),
      undefined
    );
  });

  it('self-heals on a typed SessionNotFoundError (no string matching needed)', async () => {
    await route(manager, makeMessage('stdio-typed', 'hi'));

    continueSession.mockRejectedValueOnce(new SessionNotFoundError('actual-session-1'));

    await route(manager, makeMessage('stdio-typed', 'again'));
    expect(startSession).toHaveBeenCalledTimes(2);
    expect(manager.isRemoteSession('actual-session-2')).toBe(true);
  });

  it('probe path rebinds without emitting a user message to the deleted session', async () => {
    const userEmits: string[] = [];
    manager.setRendererCallback((event) => {
      if (event.type === 'stream.message') {
        const message = event.payload.message;
        if (message.role === 'user') userEmits.push(message.sessionId);
      }
    });

    await route(manager, makeMessage('stdio-probe', 'hi'));

    // Desktop UI deleted the session; the probe sees it BEFORE any emission or
    // continuation attempt.
    hasSession.mockReturnValueOnce(false);

    await route(manager, makeMessage('stdio-probe', 'again'));
    expect(startSession).toHaveBeenCalledTimes(2);
    expect(continueSession).not.toHaveBeenCalled();

    // Exactly one user emission per turn; the second targets the healed
    // session — no spurious user message aimed at the deleted session.
    expect(userEmits).toEqual(['actual-session-1', 'actual-session-2']);
  });

  it('onSessionDeleted extension hook clears the binding using the actual session id', async () => {
    await route(manager, makeMessage('stdio-hook', 'hi'));
    expect(manager.isRemoteSession('actual-session-1')).toBe(true);

    // Mirrors the index.ts wiring: SessionManager dispatches onSessionDeleted
    // with the actual agent session id (the same id passed to
    // db.sessions.delete).
    const extensions = new AgentRuntimeExtensionManager([]);
    extensions.register({
      name: 'remote-session-binding',
      onSessionDeleted: async ({ sessionId }) => {
        await manager.handleSessionDeleted(sessionId);
      },
    });
    await extensions.onSessionDeleted({ sessionId: 'actual-session-1', session: null });

    expect(manager.isRemoteSession('actual-session-1')).toBe(false);
    await route(manager, makeMessage('stdio-hook', 'again'));
    expect(startSession).toHaveBeenCalledTimes(2);
  });

  it('handleSessionDeleted clears the channel binding so the next message starts fresh', async () => {
    await route(manager, makeMessage('stdio-del', 'hi'));
    const actualSessionId = 'actual-session-1';

    await manager.handleSessionDeleted(actualSessionId);

    expect(manager.isRemoteSession(actualSessionId)).toBe(false);
    expect(manager.getRemoteSessionId(actualSessionId)).toBeUndefined();

    await route(manager, makeMessage('stdio-del', 'again'));
    expect(startSession).toHaveBeenCalledTimes(2);
  });

  it('handleSessionDeleted is a no-op for sessions without a channel binding', async () => {
    await route(manager, makeMessage('stdio-keep', 'hi'));
    const actualSessionId = 'actual-session-1';

    await manager.handleSessionDeleted('some-unrelated-session');

    expect(manager.isRemoteSession(actualSessionId)).toBe(true);
    await manager.clearSessionBuffer(actualSessionId);
    await route(manager, makeMessage('stdio-keep', 'again'));
    expect(continueSession).toHaveBeenCalledTimes(1);
    expect(startSession).toHaveBeenCalledTimes(1);
  });

  it('does not self-heal on failures other than "Session not found"', async () => {
    await route(manager, makeMessage('stdio-err', 'hi'));
    const actualSessionId = 'actual-session-1';

    continueSession.mockRejectedValueOnce(new Error('LLM provider timeout'));
    await route(manager, makeMessage('stdio-err', 'again'));

    // The binding must survive: only a deleted session justifies a rebuild.
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(manager.isRemoteSession(actualSessionId)).toBe(true);

    // The next turn recovers on the same session.
    await route(manager, makeMessage('stdio-err', 'once more'));
    expect(continueSession).toHaveBeenLastCalledWith(
      actualSessionId,
      'once more',
      expect.anything(),
      undefined
    );
  });
});
