import { useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../store';
import type { ClientEvent, ServerEvent, PermissionResult, Session, Message } from '../types';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

// Global flags to prevent duplicate operations
let isProcessing = false;

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
            isProcessing = false;
          }
          break;

        case 'stream.message':
          console.log('[useIPC] stream.message received:', event.payload.message.role, 'content:', JSON.stringify(event.payload.message.content));
          store.addMessage(event.payload.sessionId, event.payload.message);
          break;

        case 'stream.partial':
          store.setPartialMessage(event.payload.delta);
          break;

        case 'trace.step':
          store.addTraceStep(event.payload.sessionId, event.payload.step);
          break;

        case 'trace.update':
          store.updateTraceStep(event.payload.sessionId, event.payload.stepId, event.payload.updates);
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

        case 'error':
          console.error('[useIPC] Server error:', event.payload.message);
          store.setLoading(false);
          isProcessing = false;
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
    async (title: string, prompt: string, cwd?: string) => {
      // Strict guard against duplicate calls
      if (isProcessing) {
        console.log('[useIPC] Already processing, ignoring startSession');
        return null;
      }
      
      isProcessing = true;
      setLoading(true);
      console.log('[useIPC] Starting session:', title);
      
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
            allowedTools: ['read', 'glob', 'grep'],
            memoryEnabled: false,
          };
          
          addSession(session);
          useAppStore.getState().setActiveSession(sessionId);
          
          const userMessage: Message = {
            id: `msg-user-${Date.now()}`,
            sessionId,
            role: 'user',
            content: [{ type: 'text', text: prompt }],
            timestamp: Date.now(),
          };
          addMessage(sessionId, userMessage);
          
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
          setLoading(false);
          isProcessing = false;
          
          return session;
        } catch (e) {
          isProcessing = false;
          throw e;
        }
      }
      
      // Electron mode
      try {
        const session = await invoke<Session>({
          type: 'session.start',
          payload: { title, prompt, cwd },
        });
        if (session) {
          addSession(session);
          useAppStore.getState().setActiveSession(session.id);
          
          // Immediately add user message to UI
          const userMessage: Message = {
            id: `msg-user-${Date.now()}`,
            sessionId: session.id,
            role: 'user',
            content: [{ type: 'text', text: prompt }],
            timestamp: Date.now(),
          };
          addMessage(session.id, userMessage);
        }
        // isProcessing will be reset when we receive session.status event
        return session;
      } catch (e) {
        isProcessing = false;
        setLoading(false);
        throw e;
      }
    },
    [invoke, addSession, addMessage, updateSession, setLoading]
  );

  // Continue an existing session
  const continueSession = useCallback(
    async (sessionId: string, prompt: string) => {
      if (isProcessing) {
        console.log('[useIPC] Already processing, ignoring continueSession');
        return;
      }
      
      isProcessing = true;
      setLoading(true);
      console.log('[useIPC] Continuing session:', sessionId);
      
      // Immediately add user message to UI (for both modes)
      const userMessage: Message = {
        id: `msg-user-${Date.now()}`,
        sessionId,
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        timestamp: Date.now(),
      };
      addMessage(sessionId, userMessage);
      
      // Browser mode mock
      if (!isElectron) {
        try {
          updateSession(sessionId, { status: 'running' });
          
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
          setLoading(false);
          isProcessing = false;
        } catch (e) {
          isProcessing = false;
          throw e;
        }
        return;
      }
      
      // Electron mode - send to backend (user message already added above)
      send({
        type: 'session.continue',
        payload: { sessionId, prompt },
      });
      // isProcessing will be reset when we receive session.status event
    },
    [send, addMessage, updateSession, setLoading]
  );

  const stopSession = useCallback(
    (sessionId: string) => {
      isProcessing = false;
      if (!isElectron) {
        updateSession(sessionId, { status: 'idle' });
        setLoading(false);
        return;
      }
      send({ type: 'session.stop', payload: { sessionId } });
      setLoading(false);
    },
    [send, updateSession, setLoading]
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
    respondToPermission,
    respondToQuestion,
    selectFolder,
    getMCPServers,
    isElectron,
  };
}
