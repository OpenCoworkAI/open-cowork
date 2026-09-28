import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../renderer/store';
import type { MountedPath } from '../../renderer/types';

// Reset store before each test
beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState());
});

describe('SessionState unified store', () => {
  const makeSession = (id: string) => ({
    id,
    title: `Session ${id}`,
    status: 'idle' as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cwd: '/tmp',
    mountedPaths: [] as MountedPath[],
    allowedTools: [] as string[],
    memoryEnabled: false,
  });

  describe('addSession', () => {
    it('should initialize sessionStates entry with defaults', () => {
      const session = makeSession('s1');
      useAppStore.getState().addSession(session);

      const state = useAppStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessionStates['s1']).toBeDefined();
      expect(state.sessionStates['s1'].messages).toEqual([]);
      expect(state.sessionStates['s1'].partialMessage).toBe('');
      expect(state.sessionStates['s1'].partialThinking).toBe('');
      expect(state.sessionStates['s1'].pendingTurns).toEqual([]);
      expect(state.sessionStates['s1'].activeTurn).toBeNull();
      expect(state.sessionStates['s1'].executionClock).toEqual({ startAt: null, endAt: null });
      expect(state.sessionStates['s1'].traceSteps).toEqual([]);
      expect(state.sessionStates['s1'].contextWindow).toBe(0);
      expect(state.sessionScrollPositions['s1']).toBeUndefined();
    });
  });

  describe('removeSession', () => {
    it('should remove sessionStates entry', () => {
      const session = makeSession('s1');
      useAppStore.getState().addSession(session);
      expect(useAppStore.getState().sessionStates['s1']).toBeDefined();

      useAppStore.getState().removeSession('s1');
      expect(useAppStore.getState().sessionStates['s1']).toBeUndefined();
      expect(useAppStore.getState().sessions).toHaveLength(0);
      expect(useAppStore.getState().sessionScrollPositions['s1']).toBeUndefined();
      expect(useAppStore.getState().sessionInputDrafts['s1']).toBeUndefined();
    });

    it('should clear activeSessionId when removing active session', () => {
      const session = makeSession('s1');
      useAppStore.getState().addSession(session);
      useAppStore.getState().setActiveSession('s1');
      useAppStore.getState().removeSession('s1');
      expect(useAppStore.getState().activeSessionId).toBeNull();
    });
  });

  describe('input drafts', () => {
    it('stores unsent composer text independently for each session', () => {
      useAppStore.getState().setSessionInputDraft('s1', 'draft A');
      useAppStore.getState().setSessionInputDraft('s2', 'draft B');

      expect(useAppStore.getState().sessionInputDrafts).toEqual({ s1: 'draft A', s2: 'draft B' });
    });

    it('removes empty drafts instead of storing blank text', () => {
      useAppStore.getState().setSessionInputDraft('s1', 'keep me');
      useAppStore.getState().setSessionInputDraft('s1', '');

      expect(useAppStore.getState().sessionInputDrafts['s1']).toBeUndefined();
    });

    it('leaves the map unchanged when clearing a missing draft', () => {
      const before = useAppStore.getState().sessionInputDrafts;
      useAppStore.getState().setSessionInputDraft('s1', '');

      expect(useAppStore.getState().sessionInputDrafts).toBe(before);
    });

    it('leaves the map unchanged when writing the same draft twice', () => {
      useAppStore.getState().setSessionInputDraft('s1', 'same');
      const before = useAppStore.getState().sessionInputDrafts;
      useAppStore.getState().setSessionInputDraft('s1', 'same');

      expect(useAppStore.getState().sessionInputDrafts).toBe(before);
    });

    it('removes drafts with their sessions', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().addSession(makeSession('s2'));
      useAppStore.getState().setSessionInputDraft('s1', 'gone');
      useAppStore.getState().setSessionInputDraft('s2', 'kept');

      useAppStore.getState().removeSession('s1');

      expect(useAppStore.getState().sessionInputDrafts).toEqual({ s2: 'kept' });
    });

    it('removes drafts for batch-deleted sessions', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().addSession(makeSession('s2'));
      useAppStore.getState().addSession(makeSession('s3'));
      useAppStore.getState().setSessionInputDraft('s1', 'a');
      useAppStore.getState().setSessionInputDraft('s2', 'b');
      useAppStore.getState().setSessionInputDraft('s3', 'c');

      useAppStore.getState().removeSessions(['s1', 's3']);

      expect(useAppStore.getState().sessionInputDrafts).toEqual({ s2: 'b' });
    });
  });

  describe('scroll positions', () => {
    it('stores viewport positions independently for each session', () => {
      useAppStore.getState().setSessionScrollPosition('s1', 120);
      useAppStore.getState().setSessionScrollPosition('s2', 480);

      expect(useAppStore.getState().sessionScrollPositions).toEqual({ s1: 120, s2: 480 });
    });

    it('removes viewport positions with their sessions', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().setSessionScrollPosition('s1', 120);

      useAppStore.getState().removeSession('s1');

      expect(useAppStore.getState().sessionScrollPositions['s1']).toBeUndefined();
    });
  });

  describe('removeSessions (batch)', () => {
    it('should remove multiple sessions at once', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().addSession(makeSession('s2'));
      useAppStore.getState().addSession(makeSession('s3'));
      expect(Object.keys(useAppStore.getState().sessionStates)).toHaveLength(3);

      useAppStore.getState().removeSessions(['s1', 's3']);
      const state = useAppStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].id).toBe('s2');
      expect(state.sessionStates['s1']).toBeUndefined();
      expect(state.sessionStates['s2']).toBeDefined();
      expect(state.sessionStates['s3']).toBeUndefined();
    });
  });

  describe('messages', () => {
    it('should add user messages and track pending turns', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      const msg = {
        id: 'msg1',
        sessionId: 's1',
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'hello' }],
        timestamp: Date.now(),
      };
      useAppStore.getState().addMessage('s1', msg);

      const ss = useAppStore.getState().sessionStates['s1'];
      expect(ss.messages).toHaveLength(1);
      expect(ss.pendingTurns).toEqual(['msg1']);
    });

    it('should clear partials when adding assistant message', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().setPartialMessage('s1', 'chunk1');
      useAppStore.getState().setPartialThinking('s1', 'think1');

      const assistantMsg = {
        id: 'msg2',
        sessionId: 's1',
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'response' }],
        timestamp: Date.now(),
      };
      useAppStore.getState().addMessage('s1', assistantMsg);

      const ss = useAppStore.getState().sessionStates['s1'];
      expect(ss.messages).toHaveLength(1);
      expect(ss.partialMessage).toBe('');
      expect(ss.partialThinking).toBe('');
    });

    it('should set messages (bulk replace)', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      const msgs = [
        {
          id: 'a',
          sessionId: 's1',
          role: 'user' as const,
          content: [{ type: 'text' as const, text: 'hi' }],
          timestamp: 1,
        },
        {
          id: 'b',
          sessionId: 's1',
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'hello' }],
          timestamp: 2,
        },
      ];
      useAppStore.getState().setMessages('s1', msgs);
      expect(useAppStore.getState().sessionStates['s1'].messages).toHaveLength(2);
    });
  });

  describe('partials', () => {
    it('should accumulate partial message deltas', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().setPartialMessage('s1', 'Hello');
      useAppStore.getState().setPartialMessage('s1', ' world');
      expect(useAppStore.getState().sessionStates['s1'].partialMessage).toBe('Hello world');
    });

    it('should clear partial message', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().setPartialMessage('s1', 'data');
      useAppStore.getState().clearPartialMessage('s1');
      expect(useAppStore.getState().sessionStates['s1'].partialMessage).toBe('');
    });

    it('should accumulate partial thinking deltas', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().setPartialThinking('s1', 'think');
      useAppStore.getState().setPartialThinking('s1', 'ing');
      expect(useAppStore.getState().sessionStates['s1'].partialThinking).toBe('thinking');
    });

    it('should clear partial thinking', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().setPartialThinking('s1', 'data');
      useAppStore.getState().clearPartialThinking('s1');
      expect(useAppStore.getState().sessionStates['s1'].partialThinking).toBe('');
    });
  });

  describe('execution clock', () => {
    it('should start and finish execution clock', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().startExecutionClock('s1', 1000);
      expect(useAppStore.getState().sessionStates['s1'].executionClock).toEqual({
        startAt: 1000,
        endAt: null,
      });

      useAppStore.getState().finishExecutionClock('s1', 2000);
      expect(useAppStore.getState().sessionStates['s1'].executionClock).toEqual({
        startAt: 1000,
        endAt: 2000,
      });
    });

    it('should not finish clock if never started', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().finishExecutionClock('s1', 2000);
      expect(useAppStore.getState().sessionStates['s1'].executionClock).toEqual({
        startAt: null,
        endAt: null,
      });
    });

    it('should clear execution clock', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().startExecutionClock('s1', 1000);
      useAppStore.getState().clearExecutionClock('s1');
      expect(useAppStore.getState().sessionStates['s1'].executionClock).toEqual({
        startAt: null,
        endAt: null,
      });
    });
  });

  describe('turns', () => {
    it('should activate next turn from pending queue', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      // Add a user message to create pending turn
      useAppStore.getState().addMessage('s1', {
        id: 'msg1',
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'test' }],
        timestamp: Date.now(),
      });
      expect(useAppStore.getState().sessionStates['s1'].pendingTurns).toEqual(['msg1']);

      useAppStore.getState().activateNextTurn('s1', 'step1');
      const ss = useAppStore.getState().sessionStates['s1'];
      expect(ss.pendingTurns).toEqual([]);
      expect(ss.activeTurn).toEqual({ stepId: 'step1', userMessageId: 'msg1' });
    });

    it('should set activeTurn to null when no pending turns', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().activateNextTurn('s1', 'step1');
      expect(useAppStore.getState().sessionStates['s1'].activeTurn).toBeNull();
    });

    it('should update active turn step', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      // Setup an active turn first
      useAppStore.getState().addMessage('s1', {
        id: 'msg1',
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'test' }],
        timestamp: Date.now(),
      });
      useAppStore.getState().activateNextTurn('s1', 'step1');
      useAppStore.getState().updateActiveTurnStep('s1', 'step2');
      expect(useAppStore.getState().sessionStates['s1'].activeTurn).toEqual({
        stepId: 'step2',
        userMessageId: 'msg1',
      });
    });

    it('should clear active turn', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().addMessage('s1', {
        id: 'msg1',
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'test' }],
        timestamp: Date.now(),
      });
      useAppStore.getState().activateNextTurn('s1', 'step1');
      useAppStore.getState().clearActiveTurn('s1');
      expect(useAppStore.getState().sessionStates['s1'].activeTurn).toBeNull();
    });

    it('should only clear active turn when stepId matches', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().addMessage('s1', {
        id: 'msg1',
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'test' }],
        timestamp: Date.now(),
      });
      useAppStore.getState().activateNextTurn('s1', 'step1');
      // Try clearing with wrong stepId - should not clear
      useAppStore.getState().clearActiveTurn('s1', 'wrong-step');
      expect(useAppStore.getState().sessionStates['s1'].activeTurn).not.toBeNull();
      // Clear with correct stepId
      useAppStore.getState().clearActiveTurn('s1', 'step1');
      expect(useAppStore.getState().sessionStates['s1'].activeTurn).toBeNull();
    });

    it('should clear pending turns', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().addMessage('s1', {
        id: 'msg1',
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'test' }],
        timestamp: Date.now(),
      });
      expect(useAppStore.getState().sessionStates['s1'].pendingTurns).toHaveLength(1);
      useAppStore.getState().clearPendingTurns('s1');
      expect(useAppStore.getState().sessionStates['s1'].pendingTurns).toEqual([]);
    });
  });

  describe('queued messages', () => {
    it('should clear queued message status', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      // Manually set messages with queued status
      useAppStore.getState().setMessages('s1', [
        {
          id: 'msg1',
          sessionId: 's1',
          role: 'user',
          content: [{ type: 'text', text: 'a' }],
          timestamp: 1,
          localStatus: 'queued',
        },
        {
          id: 'msg2',
          sessionId: 's1',
          role: 'user',
          content: [{ type: 'text', text: 'b' }],
          timestamp: 2,
        },
      ]);
      useAppStore.getState().clearQueuedMessages('s1');
      const msgs = useAppStore.getState().sessionStates['s1'].messages;
      expect(msgs[0].localStatus).toBeUndefined();
      expect(msgs[1].localStatus).toBeUndefined();
    });

    it('should cancel queued messages', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().setMessages('s1', [
        {
          id: 'msg1',
          sessionId: 's1',
          role: 'user',
          content: [{ type: 'text', text: 'a' }],
          timestamp: 1,
          localStatus: 'queued',
        },
      ]);
      useAppStore.getState().cancelQueuedMessages('s1');
      expect(useAppStore.getState().sessionStates['s1'].messages[0].localStatus).toBe('cancelled');
    });
  });

  describe('trace steps', () => {
    it('should add and update trace steps', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      const step = {
        id: 'ts1',
        type: 'tool_call' as const,
        status: 'running' as const,
        title: 'read',
        toolName: 'read',
        timestamp: Date.now(),
      };
      useAppStore.getState().addTraceStep('s1', step);
      expect(useAppStore.getState().sessionStates['s1'].traceSteps).toHaveLength(1);

      useAppStore.getState().updateTraceStep('s1', 'ts1', { status: 'completed' as const });
      expect(useAppStore.getState().sessionStates['s1'].traceSteps[0].status).toBe('completed');
    });

    it('should set trace steps (bulk replace)', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      const steps = [
        {
          id: 'ts1',
          type: 'tool_call' as const,
          status: 'completed' as const,
          title: 'read',
          toolName: 'read',
          timestamp: 1,
        },
        {
          id: 'ts2',
          type: 'thinking' as const,
          status: 'completed' as const,
          title: 'thinking',
          timestamp: 2,
        },
      ];
      useAppStore.getState().setTraceSteps('s1', steps);
      expect(useAppStore.getState().sessionStates['s1'].traceSteps).toHaveLength(2);
    });
  });

  describe('context window', () => {
    it('should set session context window', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().setSessionContextWindow('s1', 200000);
      expect(useAppStore.getState().sessionStates['s1'].contextWindow).toBe(200000);
    });
  });

  describe('cross-session isolation', () => {
    it('should not affect other sessions when updating one', () => {
      useAppStore.getState().addSession(makeSession('s1'));
      useAppStore.getState().addSession(makeSession('s2'));

      useAppStore.getState().setPartialMessage('s1', 'hello');
      useAppStore.getState().setSessionContextWindow('s2', 100000);

      expect(useAppStore.getState().sessionStates['s1'].partialMessage).toBe('hello');
      expect(useAppStore.getState().sessionStates['s1'].contextWindow).toBe(0);
      expect(useAppStore.getState().sessionStates['s2'].partialMessage).toBe('');
      expect(useAppStore.getState().sessionStates['s2'].contextWindow).toBe(100000);
    });
  });
});
