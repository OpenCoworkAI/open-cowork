/**
 * Regression test for the blank-chat-on-switch bug.
 *
 * Zustand v5 feeds selector results straight into React's
 * useSyncExternalStore. If a selector returns a fresh `[]` whenever the
 * session state hasn't loaded yet, React detects an unstable getSnapshot,
 * force-re-renders in a loop and dies with "Maximum update depth exceeded"
 * (React error #185) — the chat panel then renders nothing.
 *
 * These tests assert the pure selectors return IDENTICAL references for the
 * not-yet-loaded case, which is what breaks the infinite loop.
 */
import { describe, it, expect } from 'vitest';
import {
  selectActiveSessionMessages,
  selectSessionMessages,
  selectActivePendingTurns,
  selectActiveTraceSteps,
} from '../src/renderer/store/selectors';
import type { AppState } from '../src/renderer/store/index';
import type { Session, Message, TraceStep } from '../src/renderer/types';

const makeState = (overrides: Partial<AppState> = {}): AppState =>
  ({
    sessions: [] as Session[],
    activeSessionId: 'missing-session',
    sessionStates: {},
    ...overrides,
  }) as unknown as AppState;

describe('store selectors: reference stability when session state is not loaded', () => {
  it('selectActiveSessionMessages returns the same reference on every call', () => {
    const state = makeState();
    const a = selectActiveSessionMessages(state);
    const b = selectActiveSessionMessages(state);
    expect(a).toBe(b);
  });

  it('selectActiveSessionMessages is stable with no active session', () => {
    const state = makeState({ activeSessionId: null });
    expect(selectActiveSessionMessages(state)).toBe(selectActiveSessionMessages(state));
  });

  it('selectSessionMessages returns the same reference for unknown session', () => {
    const state = makeState();
    expect(selectSessionMessages(state, 'nope')).toBe(selectSessionMessages(state, 'nope'));
  });

  it('selectActivePendingTurns returns the same reference on every call', () => {
    const state = makeState();
    expect(selectActivePendingTurns(state)).toBe(selectActivePendingTurns(state));
  });

  it('selectActiveTraceSteps returns the same reference on every call', () => {
    const state = makeState();
    expect(selectActiveTraceSteps(state)).toBe(selectActiveTraceSteps(state));
  });

  it('still returns the real cached arrays once the session state exists', () => {
    const messages: Message[] = [];
    const traceSteps: TraceStep[] = [];
    const state = makeState({
      sessionStates: {
        'missing-session': { messages, traceSteps, pendingTurns: ['x'] },
      },
    }) as unknown as AppState;
    expect(selectActiveSessionMessages(state)).toBe(messages);
    expect(selectActiveTraceSteps(state)).toBe(traceSteps);
    expect(selectActivePendingTurns(state)).toEqual(['x']);
  });
});
