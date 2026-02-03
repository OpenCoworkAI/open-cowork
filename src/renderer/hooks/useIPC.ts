import { useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../store';
import type { ClientEvent, ServerEvent, PermissionResult, Session, Message, TraceStep, ContentBlock } from '../types';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

export function useIPC() {
  // Use refs to store stable references to store actions
  // This prevents useEffect from re-running when actions change
  const storeRef = useRef(useAppStore.getState());
  
  // Update ref on every render to always have latest actions
  useEffect(() => {
    storeRef.current = useAppStore.getState();
  });

  // Handle incoming server events - only setup once
  useEffect(() => {
    if (!isElectron) {
      console.log('[useIPC] Not in Electron, skipping IPC setup');
      return;
    }
    
    console.log('[useIPC] Setting up IPC listener (once)');
    
    const cleanup = window.electronAPI.on((event: ServerEvent) => {
      const store = storeRef.current;
      console.log('[useIPC] Received event:', event.type);
      
      switch (event.type) {
        case 'session.list':
          store.setSessions(event.payload.sessions);
          break;

        case 'session.status':
          store.updateSession(event.payload.sessionId, {
            status: event.payload.status,
          });
          if (event.payload.status !== 'running') {
            store.setLoading(false);
            store.clearActiveTurn(event.payload.sessionId);
            store.clearPendingTurns(event.payload.sessionId);
            store.clearQueuedMessages(event.payload.sessionId);
          }
          break;
        
        case 'session.update':
          store.updateSession(event.payload.sessionId, event.payload.updates);
          break;

        case 'stream.message':
          console.log('[useIPC] stream.message received:', event.payload.message.role, 'content:', JSON.stringify(event.payload.message.content));
          store.addMessage(event.payload.sessionId, event.payload.message);
          break;

        case 'stream.partial':
          store.setPartialMessage(event.payload.sessionId, event.payload.delta);
          break;

        case 'trace.step': {
          if (
            event.payload.step.type === 'thinking' &&
            event.payload.step.status === 'running'
          ) {
            const currentState = useAppStore.getState();
            const pending = currentState.pendingTurnsBySession[event.payload.sessionId] || [];
            const activeTurn = currentState.activeTurnsBySession[event.payload.sessionId];
            if (pending.length > 0) {
              store.activateNextTurn(event.payload.sessionId, event.payload.step.id);
            } else if (activeTurn) {
              // 绑定真实 stepId，避免 mock stepId 导致无法清理
              store.updateActiveTurnStep(event.payload.sessionId, event.payload.step.id);
            }
          }
          store.addTraceStep(event.payload.sessionId, event.payload.step);
          break;
        }

        case 'trace.update':
          if (
            event.payload.updates.status &&
            (event.payload.updates.status === 'completed' || event.payload.updates.status === 'error')
          ) {
            store.clearActiveTurn(event.payload.sessionId, event.payload.stepId);
          }
          store.updateTraceStep(event.payload.sessionId, event.payload.stepId, event.payload.updates);
          if (event.payload.updates.status && event.payload.updates.status !== 'running') {
            const steps = useAppStore.getState().traceStepsBySession[event.payload.sessionId] || [];
            const step = steps.find((item) => item.id === event.payload.stepId);
            if (step?.type === 'thinking') {
              // 兜底：若 session.status 丢失，仍能结束加载状态
              store.updateSession(event.payload.sessionId, { status: 'idle' });
              store.setLoading(false);
            }
          }
          break;

        case 'permission.request':
          store.setPendingPermission(event.payload);
          break;

        case 'question.request':
          console.log('[useIPC] question.request received:', event.payload);
          store.setPendingQuestion(event.payload);
          break;

        case 'config.status':
          console.log('[useIPC] config.status received:', event.payload.isConfigured);
          store.setIsConfigured(event.payload.isConfigured);
          store.setAppConfig(event.payload.config);
          if (!event.payload.isConfigured) {
            store.setShowConfigModal(true);
          }
          break;

        case 'sandbox.progress':
          console.log('[useIPC] sandbox.progress received:', event.payload.phase, event.payload.message);
          store.setSandboxSetupProgress(event.payload);
          break;

        case 'sandbox.sync':
          console.log('[useIPC] sandbox.sync received:', event.payload.phase, event.payload.message);
          store.setSandboxSyncStatus(event.payload);
          break;

        case 'workdir.changed':
          console.log('[useIPC] workdir.changed received:', event.payload.path);
          store.setWorkingDir(event.payload.path || null);
          break;

        case 'error':
          console.error('[useIPC] Server error:', event.payload.message);
          store.setLoading(false);
          break;

        default:
          console.log('[useIPC] Unknown server event:', event);
      }
    });

    // Cleanup on unmount only
    return () => {
      console.log('[useIPC] Cleaning up IPC listener');
      cleanup?.();
    };
  }, []); // Empty deps - setup listener only once!
  
  // Get actions for the rest of the hook
  const {
    addSession,
    updateSession,
    addMessage,
    setLoading,
    setPendingPermission,
    setPendingQuestion,
    clearActiveTurn,
    activateNextTurn,
    clearPendingTurns,
    cancelQueuedMessages,
  } = useAppStore();

  // Send event to main process
  const send = useCallback((event: ClientEvent) => {
    if (!isElectron) {
      console.log('[useIPC] Browser mode - would send:', event.type);
      return;
    }
    console.log('[useIPC] Sending:', event.type);
    window.electronAPI.send(event);
  }, []);

  // Invoke and wait for response
  const invoke = useCallback(async <T>(event: ClientEvent): Promise<T> => {
    if (!isElectron) {
      console.log('[useIPC] Browser mode - would invoke:', event.type);
      return null as T;
    }
    console.log('[useIPC] Invoking:', event.type);
    return window.electronAPI.invoke<T>(event);
  }, []);

  // Start a new session
  const startSession = useCallback(
    async (title: string, promptOrContent: string | ContentBlock[], cwd?: string) => {
      setLoading(true);
      console.log('[useIPC] Starting session:', title);

      // Normalize input to ContentBlock array
      const content: ContentBlock[] = typeof promptOrContent === 'string'
        ? [{ type: 'text', text: promptOrContent }]
        : promptOrContent;

      // Extract text for legacy backend and session title (if needed)
      const textContent = content.find(block => block.type === 'text');
      const prompt = textContent && 'text' in textContent ? textContent.text : '';

      // Browser mode mock
      if (!isElectron) {
        try {
          const sessionId = `mock-session-${Date.now()}`;
          const session: Session = {
            id: sessionId,
            title: title || 'New Session',
            status: 'running',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            cwd: cwd || '',
            mountedPaths: [],
            allowedTools: [
              'askuserquestion',
              'todowrite',
              'todoread',
              'webfetch',
              'websearch',
              'read',
              'write',
              'edit',
              'list_directory',
              'glob',
              'grep',
            ],
            memoryEnabled: false,
          };

          addSession(session);
          useAppStore.getState().setActiveSession(sessionId);

          const userMessage: Message = {
            id: `msg-user-${Date.now()}`,
            sessionId,
            role: 'user',
            content,
            timestamp: Date.now(),
          };
          addMessage(sessionId, userMessage);
          const mockStepId = `mock-step-${Date.now()}`;
          activateNextTurn(sessionId, mockStepId);

          await new Promise(resolve => setTimeout(resolve, 500));

          const assistantMessage: Message = {
            id: `msg-assistant-${Date.now()}`,
            sessionId,
            role: 'assistant',
            content: [{ type: 'text', text: `Mock response to: "${prompt}"` }],
            timestamp: Date.now(),
          };
          addMessage(sessionId, assistantMessage);

          updateSession(sessionId, { status: 'idle' });
          clearActiveTurn(sessionId, mockStepId);
          setLoading(false);

          return session;
        } catch (e) {
          throw e;
        }
      }

      // Electron mode
      try {
        const session = await invoke<Session>({
          type: 'session.start',
          payload: {
            title,
            prompt,
            cwd,
            content, // Send full content blocks including images
          },
        });
        if (session) {
          addSession(session);
          useAppStore.getState().setActiveSession(session.id);

          // Immediately add user message to UI
          const userMessage: Message = {
            id: `msg-user-${Date.now()}`,
            sessionId: session.id,
            role: 'user',
            content,
            timestamp: Date.now(),
          };
          addMessage(session.id, userMessage);

          // Immediately activate turn to show processing indicator while waiting for API
          const mockStepId = `pending-step-${Date.now()}`;
          activateNextTurn(session.id, mockStepId);
        }
        // Loading will be reset when we receive session.status event
        return session;
      } catch (e) {
        setLoading(false);
        throw e;
      }
    },
    [invoke, addSession, addMessage, updateSession, setLoading, activateNextTurn, clearActiveTurn]
  );

  // Continue an existing session
  const continueSession = useCallback(
    async (sessionId: string, promptOrContent: string | ContentBlock[]) => {
      setLoading(true);
      console.log('[useIPC] Continuing session:', sessionId);

      // Normalize input to ContentBlock array
      const content: ContentBlock[] = typeof promptOrContent === 'string'
        ? [{ type: 'text', text: promptOrContent }]
        : promptOrContent;

      // Extract text for legacy backend (if needed)
      const textContent = content.find(block => block.type === 'text');
      const prompt = textContent && 'text' in textContent ? textContent.text : '';

      // Immediately add user message to UI (for both modes)
      const store = useAppStore.getState();
      const isSessionRunning = store.sessions.find((session) => session.id === sessionId)?.status === 'running';
      const hasActiveTurn = Boolean(store.activeTurnsBySession[sessionId]);
      const hasPending = (store.pendingTurnsBySession[sessionId]?.length ?? 0) > 0;
      const shouldQueue = isSessionRunning || hasActiveTurn || hasPending;
      const userMessage: Message = {
        id: `msg-user-${Date.now()}`,
        sessionId,
        role: 'user',
        content,
        timestamp: Date.now(),
        localStatus: shouldQueue ? 'queued' : undefined,
      };
      addMessage(sessionId, userMessage);
      
      // Browser mode mock
      if (!isElectron) {
        try {
          updateSession(sessionId, { status: 'running' });
          const mockStepId = `mock-step-${Date.now()}`;
          activateNextTurn(sessionId, mockStepId);
          
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const assistantMessage: Message = {
            id: `msg-assistant-${Date.now()}`,
            sessionId,
            role: 'assistant',
            content: [{ type: 'text', text: `Mock response to: "${prompt}"` }],
            timestamp: Date.now(),
          };
          addMessage(sessionId, assistantMessage);
          
          updateSession(sessionId, { status: 'idle' });
          clearActiveTurn(sessionId, mockStepId);
          clearPendingTurns(sessionId);
          setLoading(false);
        } catch (e) {
          throw e;
        }
        return;
      }
      
      // Electron mode - send to backend (user message already added above)
      // Immediately activate turn to show processing indicator while waiting for API
      if (!shouldQueue) {
        const mockStepId = `pending-step-${Date.now()}`;
        activateNextTurn(sessionId, mockStepId);
      }

      send({
        type: 'session.continue',
        payload: {
          sessionId,
          prompt,
          content, // Send full content blocks including images
        },
      });
      // Loading will be reset when we receive session.status event
    },
    [send, addMessage, updateSession, setLoading, activateNextTurn, clearActiveTurn]
  );

  const stopSession = useCallback(
    (sessionId: string) => {
      cancelQueuedMessages(sessionId);
      clearPendingTurns(sessionId);
      clearActiveTurn(sessionId);
      if (!isElectron) {
        updateSession(sessionId, { status: 'idle' });
        setLoading(false);
        return;
      }
      send({ type: 'session.stop', payload: { sessionId } });
      setLoading(false);
    },
    [send, updateSession, setLoading, cancelQueuedMessages, clearPendingTurns, clearActiveTurn]
  );

  const deleteSession = useCallback(
    (sessionId: string) => {
      useAppStore.getState().removeSession(sessionId);
      if (isElectron) {
        send({ type: 'session.delete', payload: { sessionId } });
      }
    },
    [send]
  );

  const listSessions = useCallback(() => {
    if (!isElectron) return;
    send({ type: 'session.list', payload: {} });
  }, [send]);

  // Get messages for a session (from persistent storage)
  const getSessionMessages = useCallback(
    async (sessionId: string): Promise<Message[]> => {
      if (!isElectron) {
        console.log('[useIPC] Browser mode - no persistent messages');
        return [];
      }
      console.log('[useIPC] Getting messages for session:', sessionId);
      const messages = await invoke<Message[]>({
        type: 'session.getMessages',
        payload: { sessionId },
      });
      return messages || [];
    },
    [invoke]
  );

  const getSessionTraceSteps = useCallback(
    async (sessionId: string): Promise<TraceStep[]> => {
      if (!isElectron) {
        console.log('[useIPC] Browser mode - no persistent trace steps');
        return [];
      }
      return invoke<TraceStep[]>({ type: 'session.getTraceSteps', payload: { sessionId } });
    },
    [invoke]
  );

  const respondToPermission = useCallback(
    (toolUseId: string, result: PermissionResult) => {
      send({
        type: 'permission.response',
        payload: { toolUseId, result },
      });
      setPendingPermission(null);
    },
    [send, setPendingPermission]
  );

  const respondToQuestion = useCallback(
    (questionId: string, answer: string) => {
      console.log('[useIPC] Responding to question:', questionId, 'with:', answer);
      send({
        type: 'question.response',
        payload: { questionId, answer },
      });
      setPendingQuestion(null);
    },
    [send, setPendingQuestion]
  );

  const selectFolder = useCallback(async (): Promise<string | null> => {
    if (!isElectron) {
      return '/mock/folder/path';
    }
    return invoke<string | null>({ type: 'folder.select', payload: {} });
  }, [invoke]);

  const getWorkingDir = useCallback(async (): Promise<string | null> => {
    if (!isElectron) {
      return '/mock/working/dir';
    }
    return invoke<string | null>({ type: 'workdir.get', payload: {} });
  }, [invoke]);

  const changeWorkingDir = useCallback(async (sessionId?: string): Promise<{ success: boolean; path: string; error?: string }> => {
    if (!isElectron) {
      return { success: true, path: '/mock/working/dir' };
    }
    return invoke<{ success: boolean; path: string; error?: string }>({ type: 'workdir.select', payload: { sessionId } });
  }, [invoke]);

  const getMCPServers = useCallback(async () => {
    if (!isElectron) {
      return [];
    }
    // Use the exposed mcp.getServerStatus method
    return window.electronAPI.mcp.getServerStatus();
  }, []);

  return {
    send,
    invoke,
    startSession,
    continueSession,
    stopSession,
    deleteSession,
    listSessions,
    getSessionMessages,
    getSessionTraceSteps,
    respondToPermission,
    respondToQuestion,
    selectFolder,
    getWorkingDir,
    changeWorkingDir,
    getMCPServers,
    isElectron,
  };
}
