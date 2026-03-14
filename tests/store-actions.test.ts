import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../src/renderer/store';
import type { Session, Message, TraceStep } from '../src/renderer/types';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `session-${Date.now()}`,
    title: 'Test Session',
    status: 'idle',
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${Date.now()}-${Math.random()}`,
    sessionId: 'session-1',
    role: 'user',
    content: [{ type: 'text', text: 'Hello' }],
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeTraceStep(overrides: Partial<TraceStep> = {}): TraceStep {
  return {
    id: `step-${Date.now()}`,
    type: 'tool_call',
    status: 'running',
    title: 'Test Step',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('AppStore', () => {
  beforeEach(() => {
    const state = useAppStore.getState();
    // Reset state
    useAppStore.setState({
      sessions: [],
      activeSessionId: null,
      messagesBySession: {},
      partialMessagesBySession: {},
      pendingTurnsBySession: {},
      activeTurnsBySession: {},
      traceStepsBySession: {},
      isLoading: false,
      pendingPermission: null,
      pendingQuestion: null,
      appConfig: null,
      isConfigured: false,
      workingDir: null,
      sandboxSetupProgress: null,
      isSandboxSetupComplete: false,
      sandboxSyncStatus: null,
    });
  });

  describe('session actions', () => {
    it('adds a session', () => {
      const session = makeSession({ id: 'sess-1' });
      useAppStore.getState().addSession(session);

      const state = useAppStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].id).toBe('sess-1');
      expect(state.messagesBySession['sess-1']).toEqual([]);
      expect(state.traceStepsBySession['sess-1']).toEqual([]);
    });

    it('sets sessions', () => {
      const sessions = [makeSession({ id: 'a' }), makeSession({ id: 'b' })];
      useAppStore.getState().setSessions(sessions);
      expect(useAppStore.getState().sessions).toHaveLength(2);
    });

    it('updates a session', () => {
      const session = makeSession({ id: 'sess-1', title: 'Old Title' });
      useAppStore.getState().addSession(session);
      useAppStore.getState().updateSession('sess-1', { title: 'New Title' });

      const updated = useAppStore.getState().sessions.find(s => s.id === 'sess-1');
      expect(updated?.title).toBe('New Title');
    });

    it('removes a session and cleans up related data', () => {
      const session = makeSession({ id: 'sess-1' });
      useAppStore.getState().addSession(session);
      useAppStore.getState().setActiveSession('sess-1');

      useAppStore.getState().removeSession('sess-1');

      const state = useAppStore.getState();
      expect(state.sessions).toHaveLength(0);
      expect(state.messagesBySession['sess-1']).toBeUndefined();
      expect(state.traceStepsBySession['sess-1']).toBeUndefined();
      expect(state.activeSessionId).toBeNull();
    });

    it('preserves activeSessionId when removing different session', () => {
      useAppStore.getState().addSession(makeSession({ id: 'a' }));
      useAppStore.getState().addSession(makeSession({ id: 'b' }));
      useAppStore.getState().setActiveSession('a');

      useAppStore.getState().removeSession('b');
      expect(useAppStore.getState().activeSessionId).toBe('a');
    });
  });

  describe('message actions', () => {
    it('adds a user message and queues pending turn', () => {
      const msg = makeMessage({ id: 'msg-1', sessionId: 'sess-1', role: 'user' });
      useAppStore.getState().addMessage('sess-1', msg);

      const state = useAppStore.getState();
      expect(state.messagesBySession['sess-1']).toHaveLength(1);
      expect(state.pendingTurnsBySession['sess-1']).toContain('msg-1');
    });

    it('adds assistant message after user message', () => {
      useAppStore.getState().addMessage('sess-1', makeMessage({ id: 'u1', role: 'user', sessionId: 'sess-1' }));
      useAppStore.getState().addMessage('sess-1', makeMessage({ id: 'a1', role: 'assistant', sessionId: 'sess-1' }));

      const messages = useAppStore.getState().messagesBySession['sess-1'];
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
    });

    it('sets messages for a session', () => {
      const msgs = [makeMessage({ id: 'm1' }), makeMessage({ id: 'm2' })];
      useAppStore.getState().setMessages('sess-1', msgs);
      expect(useAppStore.getState().messagesBySession['sess-1']).toHaveLength(2);
    });

    it('clears partial message on assistant message', () => {
      useAppStore.getState().setPartialMessage('sess-1', 'partial text');
      useAppStore.getState().addMessage('sess-1', makeMessage({ role: 'assistant', sessionId: 'sess-1' }));
      expect(useAppStore.getState().partialMessagesBySession['sess-1']).toBe('');
    });
  });

  describe('partial message actions', () => {
    it('appends partial messages', () => {
      useAppStore.getState().setPartialMessage('sess-1', 'Hello');
      useAppStore.getState().setPartialMessage('sess-1', ' World');
      expect(useAppStore.getState().partialMessagesBySession['sess-1']).toBe('Hello World');
    });

    it('clears partial message', () => {
      useAppStore.getState().setPartialMessage('sess-1', 'Hello');
      useAppStore.getState().clearPartialMessage('sess-1');
      expect(useAppStore.getState().partialMessagesBySession['sess-1']).toBe('');
    });
  });

  describe('trace step actions', () => {
    it('adds a trace step', () => {
      const step = makeTraceStep({ id: 'step-1' });
      useAppStore.getState().addTraceStep('sess-1', step);
      expect(useAppStore.getState().traceStepsBySession['sess-1']).toHaveLength(1);
    });

    it('updates a trace step', () => {
      const step = makeTraceStep({ id: 'step-1', status: 'running' });
      useAppStore.getState().addTraceStep('sess-1', step);
      useAppStore.getState().updateTraceStep('sess-1', 'step-1', { status: 'completed' });

      const updated = useAppStore.getState().traceStepsBySession['sess-1']?.[0];
      expect(updated?.status).toBe('completed');
    });

    it('sets trace steps', () => {
      const steps = [makeTraceStep({ id: 's1' }), makeTraceStep({ id: 's2' })];
      useAppStore.getState().setTraceSteps('sess-1', steps);
      expect(useAppStore.getState().traceStepsBySession['sess-1']).toHaveLength(2);
    });
  });

  describe('turn management', () => {
    it('activates next turn from pending queue', () => {
      useAppStore.getState().addMessage('sess-1', makeMessage({ id: 'u1', role: 'user', sessionId: 'sess-1' }));
      useAppStore.getState().activateNextTurn('sess-1', 'step-1');

      const state = useAppStore.getState();
      expect(state.activeTurnsBySession['sess-1']).toEqual({ stepId: 'step-1', userMessageId: 'u1' });
      expect(state.pendingTurnsBySession['sess-1']).toHaveLength(0);
    });

    it('clears active turn', () => {
      useAppStore.getState().addMessage('sess-1', makeMessage({ id: 'u1', role: 'user', sessionId: 'sess-1' }));
      useAppStore.getState().activateNextTurn('sess-1', 'step-1');
      useAppStore.getState().clearActiveTurn('sess-1');

      expect(useAppStore.getState().activeTurnsBySession['sess-1']).toBeNull();
    });

    it('clears active turn only if stepId matches', () => {
      useAppStore.getState().addMessage('sess-1', makeMessage({ id: 'u1', role: 'user', sessionId: 'sess-1' }));
      useAppStore.getState().activateNextTurn('sess-1', 'step-1');
      useAppStore.getState().clearActiveTurn('sess-1', 'wrong-step');

      expect(useAppStore.getState().activeTurnsBySession['sess-1']).not.toBeNull();
    });

    it('cancels queued messages', () => {
      useAppStore.getState().addMessage('sess-1', makeMessage({
        id: 'u1',
        role: 'user',
        sessionId: 'sess-1',
        localStatus: 'queued',
      }));
      useAppStore.getState().cancelQueuedMessages('sess-1');

      const msg = useAppStore.getState().messagesBySession['sess-1']?.[0];
      expect(msg?.localStatus).toBe('cancelled');
    });
  });

  describe('UI state', () => {
    it('toggles sidebar', () => {
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);
      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });

    it('toggles context panel', () => {
      expect(useAppStore.getState().contextPanelCollapsed).toBe(false);
      useAppStore.getState().toggleContextPanel();
      expect(useAppStore.getState().contextPanelCollapsed).toBe(true);
    });

    it('sets loading state', () => {
      useAppStore.getState().setLoading(true);
      expect(useAppStore.getState().isLoading).toBe(true);
    });
  });

  describe('config actions', () => {
    it('sets app config', () => {
      const config = {
        provider: 'anthropic' as const,
        apiKey: 'test',
        model: 'claude-sonnet-4-5',
        isConfigured: true,
      };
      useAppStore.getState().setAppConfig(config);
      expect(useAppStore.getState().appConfig).toEqual(config);
    });

    it('sets configured state', () => {
      useAppStore.getState().setIsConfigured(true);
      expect(useAppStore.getState().isConfigured).toBe(true);
    });
  });

  describe('working directory', () => {
    it('sets working directory', () => {
      useAppStore.getState().setWorkingDir('/tmp/workspace');
      expect(useAppStore.getState().workingDir).toBe('/tmp/workspace');
    });

    it('clears working directory', () => {
      useAppStore.getState().setWorkingDir('/tmp/workspace');
      useAppStore.getState().setWorkingDir(null);
      expect(useAppStore.getState().workingDir).toBeNull();
    });
  });

  describe('sandbox state', () => {
    it('sets sandbox setup progress', () => {
      useAppStore.getState().setSandboxSetupProgress({ phase: 'checking', message: 'Checking...' });
      expect(useAppStore.getState().sandboxSetupProgress?.phase).toBe('checking');
    });

    it('sets sandbox setup complete', () => {
      useAppStore.getState().setSandboxSetupComplete(true);
      expect(useAppStore.getState().isSandboxSetupComplete).toBe(true);
    });
  });

  describe('permission and question actions', () => {
    it('sets and clears pending permission', () => {
      const perm = { toolUseId: 't1', toolName: 'write', input: {}, sessionId: 's1' };
      useAppStore.getState().setPendingPermission(perm);
      expect(useAppStore.getState().pendingPermission).toEqual(perm);

      useAppStore.getState().setPendingPermission(null);
      expect(useAppStore.getState().pendingPermission).toBeNull();
    });

    it('sets and clears pending question', () => {
      const q = { questionId: 'q1', sessionId: 's1', toolUseId: 't1', questions: [{ question: 'test?' }] };
      useAppStore.getState().setPendingQuestion(q);
      expect(useAppStore.getState().pendingQuestion).toEqual(q);
    });
  });

  describe('settings', () => {
    it('updates settings partially', () => {
      useAppStore.getState().updateSettings({ theme: 'dark' });
      expect(useAppStore.getState().settings.theme).toBe('dark');
      // Other settings should remain
      expect(useAppStore.getState().settings.defaultTools.length).toBeGreaterThan(0);
    });
  });
});
