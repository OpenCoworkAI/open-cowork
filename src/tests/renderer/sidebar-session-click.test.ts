/**
 * Regression test for React #185 "Maximum update depth exceeded" —
 * triggered by including `sessionStates` in handleSessionClick's dependency
 * array in Sidebar.tsx (issue #217).
 *
 * The loop mechanism:
 *   1. handleSessionClick calls setMessages(sessionId, messages)
 *   2. setMessages calls patchSession which spreads sessionStates → new object ref
 *   3. Sidebar's useAppStore((s) => s.sessionStates) subscription fires
 *   4. sessionStates dep in handleSessionClick changes → callback rebuilds
 *   5. Any effect that depends on handleSessionClick re-fires
 *   6. Repeat → exceeds React's nested update limit (React error #185)
 *
 * Fix: remove sessionStates from deps and read store state at call-time via
 * useAppStore.getState().sessionStates.
 *
 * This test verifies the dep-free pattern at the store level:
 * calling setMessages does produce a new sessionStates reference (confirming
 * why the old dep was dangerous), while getState() always returns current data
 * (confirming the fix is correct).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../renderer/store';

describe('Sidebar handleSessionClick — sessionStates dep loop prevention', () => {
  beforeEach(() => {
    // Reset store to clean state before each test
    useAppStore.setState({
      sessions: [],
      activeSessionId: null,
      sessionStates: {},
    });
  });

  it('setMessages produces a new sessionStates object reference', () => {
    const sessionId = 'session-1';
    const before = useAppStore.getState().sessionStates;

    useAppStore.getState().setMessages(sessionId, [
      {
        id: 'msg-1',
        sessionId,
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        timestamp: Date.now(),
      },
    ]);

    const after = useAppStore.getState().sessionStates;

    // The reference changes — this is why subscribing to sessionStates in
    // handleSessionClick's dep array would cause a rebuild on every setMessages call.
    expect(after).not.toBe(before);
  });

  it('getState().sessionStates returns current data without a subscription', () => {
    const sessionId = 'session-2';

    // Initially empty
    expect(useAppStore.getState().sessionStates[sessionId]).toBeUndefined();

    useAppStore.getState().setMessages(sessionId, [
      {
        id: 'msg-2',
        sessionId,
        role: 'assistant',
        content: [{ type: 'text', text: 'world' }],
        timestamp: Date.now(),
      },
    ]);

    // getState() always reflects the latest committed state — safe to read at
    // call-time from inside a useCallback without including it in deps.
    const messages = useAppStore.getState().sessionStates[sessionId]?.messages ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-2');
  });

  it('second setMessages call for same session still produces a new reference', () => {
    const sessionId = 'session-3';
    const msg = {
      id: 'msg-3',
      sessionId,
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'ping' }],
      timestamp: Date.now(),
    };

    useAppStore.getState().setMessages(sessionId, [msg]);
    const ref1 = useAppStore.getState().sessionStates;

    useAppStore.getState().setMessages(sessionId, [msg]);
    const ref2 = useAppStore.getState().sessionStates;

    // Every patchSession call spreads, so reference always changes.
    // A dep on sessionStates in useCallback would trigger a rebuild every time.
    expect(ref2).not.toBe(ref1);
  });

  it('existing messages check via getState() correctly skips reload', () => {
    const sessionId = 'session-4';
    const existingMsg = {
      id: 'msg-existing',
      sessionId,
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'already loaded' }],
      timestamp: Date.now(),
    };

    useAppStore.getState().setMessages(sessionId, [existingMsg]);

    // Simulate the fixed handleSessionClick check:
    // read at call-time rather than from a stale dep
    const currentStates = useAppStore.getState().sessionStates;
    const existingMessages = currentStates[sessionId]?.messages;

    // When messages exist, the callback should NOT call getSessionMessages again.
    // This assertion verifies the guard condition works with getState().
    expect(existingMessages).toHaveLength(1);
    expect(existingMessages![0].id).toBe('msg-existing');
  });
});
