import { useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../store';
import type {
  AppConfig,
  ClientEvent,
  ServerEvent,
  PermissionResult,
  Session,
  Message,
  TraceStep,
  ContentBlock,
} from '../types';
import i18n from '../i18n/config';

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

    // --- RAF batching for high-frequency events ---
    const pendingPartials: Record<string, string[]> = {};
    let partialRafId: number | null = null;

    const pendingThinking: Record<string, string[]> = {};
    let thinkingRafId: number | null = null;

    const flushPartials = () => {
      partialRafId = null;
      const store = storeRef.current;
      for (const sessionId in pendingPartials) {
        const chunks = pendingPartials[sessionId];
        if (chunks.length > 0) {
          store.setPartialMessage(sessionId, chunks.join(''));
          pendingPartials[sessionId] = [];
        }
      }
    };

    const bufferPartial = (sessionId: string, delta: string) => {
      if (!pendingPartials[sessionId]) pendingPartials[sessionId] = [];
      pendingPartials[sessionId].push(delta);
      if (partialRafId === null) {
        partialRafId = requestAnimationFrame(flushPartials);
      }
    };

    const flushThinking = () => {
      thinkingRafId = null;
      const store = storeRef.current;
      for (const sessionId in pendingThinking) {
        const chunks = pendingThinking[sessionId];
        if (chunks.length > 0) {
          store.setPartialThinking(sessionId, chunks.join(''));
          pendingThinking[sessionId] = [];
        }
      }
    };

    const bufferThinking = (sessionId: string, delta: string) => {
      if (!pendingThinking[sessionId]) pendingThinking[sessionId] = [];
      pendingThinking[sessionId].push(delta);
      if (thinkingRafId === null) {
        thinkingRafId = requestAnimationFrame(flushThinking);
      }
    };

    type TraceAction =
      | { kind: 'add'; sessionId: string; step: TraceStep }
      | { kind: 'update'; sessionId: string; stepId: string; updates: Partial<TraceStep> };
    let pendingTraces: TraceAction[] = [];
    let traceRafId: number | null = null;

    const flushTraces = () => {
      traceRafId = null;
      const store = storeRef.current;
      for (const action of pendingTraces) {
        if (action.kind === 'add') {
          store.addTraceStep(action.sessionId, action.step);
        } else {
          store.updateTraceStep(action.sessionId, action.stepId, action.updates);
        }
      }
      pendingTraces = [];
    };

    const bufferTrace = (action: TraceAction) => {
      pendingTraces.push(action);
      if (traceRafId === null) {
        traceRafId = requestAnimationFrame(flushTraces);
      }
    };

    const applyConfigSnapshot = (config: AppConfig, isConfigured: boolean) => {
      const store = storeRef.current;
      const isInitialConfigStatus = !store.hasSeenInitialConfigStatus;
      store.setIsConfigured(isConfigured);
      store.setAppConfig(config);
      store.setSettings({ theme: config.theme || 'light' });
      if (isInitialConfigStatus) {
        store.markInitialConfigStatusSeen();
      }
    };

    const cleanup = window.electronAPI.on((event: ServerEvent) => {
      const store = storeRef.current;
      console.log('[useIPC] Received event:', event.type);

      try {
      switch (event.type) {
        case 'session.list':
          store.setSessions(event.payload.sessions);
          break;

        case 'session.status':
          store.updateSession(event.payload.sessionId, {
            status: event.payload.status,
          });
          if (event.payload.status !== 'running') {
            store.finishExecutionClock(event.payload.sessionId);
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
          console.log(
            '[useIPC] stream.message received:',
            event.payload.message.role,
            'content:',
            JSON.stringify(event.payload.message.content)
          );
          // Clear pending partial buffer to prevent RAF from appending stale chunks
          delete pendingPartials[event.payload.sessionId];
          // Clear thinking buffer too — final thinking is in the message content blocks
          delete pendingThinking[event.payload.sessionId];
          store.addMessage(event.payload.sessionId, event.payload.message);
          break;

        case 'stream.partial':
          bufferPartial(event.payload.sessionId, event.payload.delta);
          break;

        case 'stream.thinking':
          bufferThinking(event.payload.sessionId, event.payload.delta);
          break;

        case 'trace.step': {
          if (event.payload.step.type === 'thinking' && event.payload.step.status === 'running') {
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
          bufferTrace({
            kind: 'add',
            sessionId: event.payload.sessionId,
            step: event.payload.step,
          });
          break;
        }

        case 'trace.update':
          if (
            event.payload.updates.status &&
            (event.payload.updates.status === 'completed' ||
              event.payload.updates.status === 'error')
          ) {
            store.clearActiveTurn(event.payload.sessionId, event.payload.stepId);
          }
          bufferTrace({
            kind: 'update',
            sessionId: event.payload.sessionId,
            stepId: event.payload.stepId,
            updates: event.payload.updates,
          });
          break;

        case 'permission.request':
          store.setPendingPermission(event.payload);
          break;

        case 'sudo.password.request':
          store.setPendingSudoPassword(event.payload);
          break;

        case 'sudo.password.dismiss': {
          const currentSudo = useAppStore.getState().pendingSudoPassword;
          if (currentSudo?.toolUseId === event.payload.toolUseId) {
            store.setPendingSudoPassword(null);
          }
          break;
        }

        case 'config.status': {
          console.log('[useIPC] config.status received:', event.payload.isConfigured);
          applyConfigSnapshot(event.payload.config, event.payload.isConfigured);
          break;
        }

        case 'sandbox.progress':
          console.log(
            '[useIPC] sandbox.progress received:',
            event.payload.phase,
            event.payload.message
          );
          store.setSandboxSetupProgress(event.payload);
          break;

        case 'sandbox.sync':
          console.log(
            '[useIPC] sandbox.sync received:',
            event.payload.phase,
            event.payload.message
          );
          store.setSandboxSyncStatus(event.payload);
          break;

        case 'skills.storageChanged':
          console.log(
            '[useIPC] skills.storageChanged received:',
            event.payload.path,
            event.payload.reason
          );
          store.setSkillsStorageChangeEvent(event.payload);
          store.setSkillsStorageChangedAt(Date.now());
          break;

        case 'workdir.changed':
          console.log('[useIPC] workdir.changed received:', event.payload.path);
          store.setWorkingDir(event.payload.path || null);
          break;

        case 'session.contextInfo':
          store.setSessionContextWindow(event.payload.sessionId, event.payload.contextWindow);
          break;

        case 'error':
          console.error('[useIPC] Server error:', event.payload.message);
          store.setLoading(false);
          if (event.payload.code === 'CONFIG_REQUIRED_ACTIVE_SET') {
            store.setGlobalNotice({
              id: `notice-config-required-${Date.now()}`,
              type: 'warning',
              message: i18n.t('api.configRequiredActiveSet'),
              messageKey: 'api.configRequiredActiveSet',
              action:
                event.payload.action === 'open_api_settings' ? 'open_api_settings' : undefined,
            });
          } else {
            store.setGlobalNotice({
              id: `notice-error-${Date.now()}`,
              type: 'error',
              message: event.payload.message,
            });
          }
          break;

        case 'native-theme.changed':
          store.setSystemDarkMode(event.payload.shouldUseDarkColors);
          break;

        case 'new-session':
          store.setActiveSession(null);
          store.setShowSettings(false);
          break;

        case 'navigate':
          if (event.payload === 'settings') {
            store.setShowSettings(true);
          }
          break;

        default:
          console.log('[useIPC] Unknown server event:', event);
      }
      } catch (err) {
        console.error('[useIPC] Error handling server event:', event.type, err);
      }
    });

    let disposed = false;
    void (async () => {
      try {
        const [config, isConfigured, systemTheme] = await Promise.all([
          window.electronAPI.config.get(),
          window.electronAPI.config.isConfigured(),
          window.electronAPI.getSystemTheme(),
        ]);
        if (disposed) {
          return;
        }
        const store = storeRef.current;
        store.setSystemDarkMode(Boolean(systemTheme?.shouldUseDarkColors));
        applyConfigSnapshot(config, Boolean(isConfigured));
      } catch (error) {
        console.error('[useIPC] Failed to bootstrap config/theme state:', error);
      }
    })();

    // Cleanup on unmount only
    return () => {
      disposed = true;
      console.log('[useIPC] Cleaning up IPC listener');
      if (partialRafId !== null) cancelAnimationFrame(partialRafId);
      if (thinkingRafId !== null) cancelAnimationFrame(thinkingRafId);
      if (traceRafId !== null) cancelAnimationFrame(traceRafId);
      cleanup?.();
    };
  }, []); // Empty deps - setup listener only once!

  // Get actions for the rest of the hook
  const addSession = useAppStore((s) => s.addSession);
  const updateSession = useAppStore((s) => s.updateSession);
  const addMessage = useAppStore((s) => s.addMessage);
  const setLoading = useAppStore((s) => s.setLoading);
  const setPendingPermission = useAppStore((s) => s.setPendingPermission);
  const clearActiveTurn = useAppStore((s) => s.clearActiveTurn);
  const activateNextTurn = useAppStore((s) => s.activateNextTurn);
  const clearPendingTurns = useAppStore((s) => s.clearPendingTurns);
  const cancelQueuedMessages = useAppStore((s) => s.cancelQueuedMessages);
  const startExecutionClock = useAppStore((s) => s.startExecutionClock);
  const finishExecutionClock = useAppStore((s) => s.finishExecutionClock);

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
      const content: ContentBlock[] =
        typeof promptOrContent === 'string'
          ? [{ type: 'text', text: promptOrContent }]
          : promptOrContent;

      // Extract text for legacy backend and session title (if needed)
      const textContent = content.find((block) => block.type === 'text');
      const prompt = textContent && 'text' in textContent ? textContent.text : '';

      // Browser mode mock
      if (!isElectron) {
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
        startExecutionClock(sessionId, userMessage.timestamp);
        const mockStepId = `mock-step-${Date.now()}`;
        activateNextTurn(sessionId, mockStepId);

        await new Promise((resolve) => setTimeout(resolve, 500));

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
          startExecutionClock(session.id, userMessage.timestamp);

          // Immediately activate turn to show processing indicator while waiting for API
          const mockStepId = `pending-step-${Date.now()}`;
          activateNextTurn(session.id, mockStepId);
        }
        // Loading will be reset when we receive session.status event
        return session;
      } catch (e) {
        setLoading(false);
        useAppStore.getState().setGlobalNotice({
          id: `notice-session-start-${Date.now()}`,
          type: 'error',
          message: e instanceof Error ? e.message : i18n.t('chat.startFailed'),
          messageKey: e instanceof Error ? undefined : 'chat.startFailed',
        });
        return null;
      }
    },
    [invoke, addSession, addMessage, updateSession, setLoading, activateNextTurn, clearActiveTurn, startExecutionClock]
  );

  // Continue an existing session
  const continueSession = useCallback(
    async (sessionId: string, promptOrContent: string | ContentBlock[]) => {
      setLoading(true);
      console.log('[useIPC] Continuing session:', sessionId);

      // Normalize input to ContentBlock array
      const content: ContentBlock[] =
        typeof promptOrContent === 'string'
          ? [{ type: 'text', text: promptOrContent }]
          : promptOrContent;

      // Extract text for legacy backend (if needed)
      const textContent = content.find((block) => block.type === 'text');
      const prompt = textContent && 'text' in textContent ? textContent.text : '';

      // Immediately add user message to UI (for both modes)
      const store = useAppStore.getState();
      const isSessionRunning =
        store.sessions.find((session) => session.id === sessionId)?.status === 'running';
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
      startExecutionClock(sessionId, userMessage.timestamp);

      // Browser mode mock
      if (!isElectron) {
        updateSession(sessionId, { status: 'running' });
        const mockStepId = `mock-step-${Date.now()}`;
        activateNextTurn(sessionId, mockStepId);

        await new Promise((resolve) => setTimeout(resolve, 500));

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
    [
      send,
      addMessage,
      updateSession,
      setLoading,
      activateNextTurn,
      clearActiveTurn,
      clearPendingTurns,
      startExecutionClock,
    ]
  );

  const stopSession = useCallback(
    (sessionId: string) => {
      cancelQueuedMessages(sessionId);
      clearPendingTurns(sessionId);
      clearActiveTurn(sessionId);
      finishExecutionClock(sessionId);
      if (!isElectron) {
        updateSession(sessionId, { status: 'idle' });
        setLoading(false);
        return;
      }
      send({ type: 'session.stop', payload: { sessionId } });
      setLoading(false);
    },
    [send, updateSession, setLoading, cancelQueuedMessages, clearPendingTurns, clearActiveTurn, finishExecutionClock]
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

  const batchDeleteSessions = useCallback(
    (sessionIds: string[]) => {
      useAppStore.getState().removeSessions(sessionIds);
      if (isElectron) {
        send({ type: 'session.batchDelete', payload: { sessionIds } });
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

  const setPendingSudoPassword = useAppStore((s) => s.setPendingSudoPassword);

  const respondToSudoPassword = useCallback(
    (toolUseId: string, password: string | null) => {
      send({
        type: 'sudo.password.response',
        payload: { toolUseId, password },
      });
      setPendingSudoPassword(null);
    },
    [send, setPendingSudoPassword]
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

  const changeWorkingDir = useCallback(
    async (
      sessionId?: string,
      currentPath?: string
    ): Promise<{ success: boolean; path: string; error?: string }> => {
      if (!isElectron) {
        return { success: true, path: '/mock/working/dir' };
      }
      return invoke<{ success: boolean; path: string; error?: string }>({
        type: 'workdir.select',
        payload: { sessionId, currentPath },
      });
    },
    [invoke]
  );

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
    batchDeleteSessions,
    listSessions,
    getSessionMessages,
    getSessionTraceSteps,
    respondToPermission,
    respondToSudoPassword,
    selectFolder,
    getWorkingDir,
    changeWorkingDir,
    getMCPServers,
    isElectron,
  };
}
