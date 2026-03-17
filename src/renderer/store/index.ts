import { create } from 'zustand';
import type {
  Session,
  Message,
  TraceStep,
  PermissionRequest,
  SudoPasswordRequest,
  Settings,
  AppConfig,
  SandboxSetupProgress,
  SandboxSyncStatus,
  SkillsStorageChangeEvent,
} from '../types';
import { applySessionUpdate } from '../utils/session-update';

export type GlobalNoticeType = 'info' | 'warning' | 'error' | 'success';
export type GlobalNoticeAction = 'open_api_settings';

export interface GlobalNotice {
  id: string;
  message: string;
  messageKey?: string;
  messageValues?: Record<string, string | number>;
  type: GlobalNoticeType;
  actionLabel?: string;
  action?: GlobalNoticeAction;
}

export interface SessionExecutionClock {
  startAt: number | null;
  endAt: number | null;
}

interface AppState {
  // Sessions
  sessions: Session[];
  activeSessionId: string | null;

  // Messages
  messagesBySession: Record<string, Message[]>;
  partialMessagesBySession: Record<string, string>;
  partialThinkingBySession: Record<string, string>;
  pendingTurnsBySession: Record<string, string[]>;
  activeTurnsBySession: Record<string, { stepId: string; userMessageId: string } | null>;
  executionClockBySession: Record<string, SessionExecutionClock>;

  // Trace steps
  traceStepsBySession: Record<string, TraceStep[]>;

  // UI state
  isLoading: boolean;
  sidebarCollapsed: boolean;
  contextPanelCollapsed: boolean;
  showSettings: boolean;
  settingsTab: string | null;

  // Permission
  pendingPermission: PermissionRequest | null;

  // Sudo password
  pendingSudoPassword: SudoPasswordRequest | null;

  // Settings
  settings: Settings;

  // App Config (API settings)
  appConfig: AppConfig | null;
  isConfigured: boolean;
  showConfigModal: boolean;
  hasSeenInitialConfigStatus: boolean;
  globalNotice: GlobalNotice | null;

  // Working directory
  workingDir: string | null;

  // Sandbox setup
  sandboxSetupProgress: SandboxSetupProgress | null;
  isSandboxSetupComplete: boolean;

  // Sandbox sync (per-session)
  sandboxSyncStatus: SandboxSyncStatus | null;
  skillsStorageChangedAt: number;
  skillsStorageChangeEvent: SkillsStorageChangeEvent | null;

  // Context window per session (from model resolution)
  contextWindowBySession: Record<string, number>;

  // System theme (from OS native theme)
  systemDarkMode: boolean;

  // Actions
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
  removeSession: (sessionId: string) => void;
  removeSessions: (sessionIds: string[]) => void;
  setActiveSession: (sessionId: string | null) => void;

  addMessage: (sessionId: string, message: Message) => void;
  startExecutionClock: (sessionId: string, startAt: number) => void;
  finishExecutionClock: (sessionId: string, endAt?: number) => void;
  clearExecutionClock: (sessionId: string) => void;
  setMessages: (sessionId: string, messages: Message[]) => void;
  setPartialMessage: (sessionId: string, partial: string) => void;
  clearPartialMessage: (sessionId: string) => void;
  setPartialThinking: (sessionId: string, delta: string) => void;
  clearPartialThinking: (sessionId: string) => void;
  activateNextTurn: (sessionId: string, stepId: string) => void;
  updateActiveTurnStep: (sessionId: string, stepId: string) => void;
  clearActiveTurn: (sessionId: string, stepId?: string) => void;
  clearPendingTurns: (sessionId: string) => void;
  clearQueuedMessages: (sessionId: string) => void;
  cancelQueuedMessages: (sessionId: string) => void;

  addTraceStep: (sessionId: string, step: TraceStep) => void;
  updateTraceStep: (sessionId: string, stepId: string, updates: Partial<TraceStep>) => void;
  setTraceSteps: (sessionId: string, steps: TraceStep[]) => void;

  setLoading: (loading: boolean) => void;
  toggleSidebar: () => void;
  toggleContextPanel: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setContextPanelCollapsed: (collapsed: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setSettingsTab: (tab: string | null) => void;

  setPendingPermission: (permission: PermissionRequest | null) => void;

  setPendingSudoPassword: (request: SudoPasswordRequest | null) => void;

  setSettings: (updates: Partial<Settings>) => void;
  updateSettings: (updates: Partial<Settings>) => void;

  // Config actions
  setAppConfig: (config: AppConfig | null) => void;
  setIsConfigured: (configured: boolean) => void;
  setShowConfigModal: (show: boolean) => void;
  markInitialConfigStatusSeen: () => void;
  setGlobalNotice: (notice: GlobalNotice | null) => void;
  clearGlobalNotice: () => void;

  // Working directory actions
  setWorkingDir: (path: string | null) => void;

  // Sandbox setup actions
  setSandboxSetupProgress: (progress: SandboxSetupProgress | null) => void;
  setSandboxSetupComplete: (complete: boolean) => void;

  // Sandbox sync actions
  setSandboxSyncStatus: (status: SandboxSyncStatus | null) => void;
  setSkillsStorageChangedAt: (timestamp: number) => void;
  setSkillsStorageChangeEvent: (event: SkillsStorageChangeEvent | null) => void;

  // Context window actions
  setSessionContextWindow: (sessionId: string, contextWindow: number) => void;

  // System theme actions
  setSystemDarkMode: (dark: boolean) => void;
}

const defaultSettings: Settings = {
  theme: 'light',
  defaultTools: [
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
  permissionRules: [
    { tool: 'read', action: 'allow' },
    { tool: 'glob', action: 'allow' },
    { tool: 'grep', action: 'allow' },
    { tool: 'write', action: 'ask' },
    { tool: 'edit', action: 'ask' },
    { tool: 'bash', action: 'ask' },
  ],
  globalSkillsPath: '',
  memoryStrategy: 'auto',
  maxContextTokens: 180000,
};

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  sessions: [],
  activeSessionId: null,
  messagesBySession: {},
  partialMessagesBySession: {},
  partialThinkingBySession: {},
  pendingTurnsBySession: {},
  activeTurnsBySession: {},
  executionClockBySession: {},
  traceStepsBySession: {},
  isLoading: false,
  sidebarCollapsed: false,
  contextPanelCollapsed: false,
  showSettings: false,
  settingsTab: null,
  pendingPermission: null,
  pendingSudoPassword: null,
  settings: defaultSettings,
  appConfig: null,
  isConfigured: false,
  showConfigModal: false,
  hasSeenInitialConfigStatus: false,
  globalNotice: null,
  workingDir: null,
  sandboxSetupProgress: null,
  isSandboxSetupComplete: false,
  sandboxSyncStatus: null,
  skillsStorageChangedAt: 0,
  skillsStorageChangeEvent: null,
  contextWindowBySession: {},
  systemDarkMode: false,

  // Session actions
  setSessions: (sessions) => set({ sessions }),

  addSession: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions],
      messagesBySession: { ...state.messagesBySession, [session.id]: [] },
      partialMessagesBySession: { ...state.partialMessagesBySession, [session.id]: '' },
      partialThinkingBySession: { ...state.partialThinkingBySession, [session.id]: '' },
      pendingTurnsBySession: { ...state.pendingTurnsBySession, [session.id]: [] },
      activeTurnsBySession: { ...state.activeTurnsBySession, [session.id]: null },
      executionClockBySession: {
        ...state.executionClockBySession,
        [session.id]: { startAt: null, endAt: null },
      },
      traceStepsBySession: { ...state.traceStepsBySession, [session.id]: [] },
    })),

  updateSession: (sessionId, updates) =>
    set((state) => ({
      sessions: applySessionUpdate(state.sessions, sessionId, updates),
    })),

  removeSession: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...restMessages } = state.messagesBySession;
      const { [sessionId]: __partials, ...restPartials } = state.partialMessagesBySession;
      const { [sessionId]: __thinkingPartials, ...restThinkingPartials } =
        state.partialThinkingBySession;
      const { [sessionId]: __pending, ...restPendingTurns } = state.pendingTurnsBySession;
      const { [sessionId]: __active, ...restActiveTurns } = state.activeTurnsBySession;
      const { [sessionId]: __clock, ...restExecutionClocks } = state.executionClockBySession;
      const { [sessionId]: __traces, ...restTraces } = state.traceStepsBySession;
      const { [sessionId]: __ctx, ...restContextWindows } = state.contextWindowBySession;
      return {
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        messagesBySession: restMessages,
        partialMessagesBySession: restPartials,
        partialThinkingBySession: restThinkingPartials,
        pendingTurnsBySession: restPendingTurns,
        activeTurnsBySession: restActiveTurns,
        executionClockBySession: restExecutionClocks,
        traceStepsBySession: restTraces,
        contextWindowBySession: restContextWindows,
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
      };
    }),

  removeSessions: (sessionIds) =>
    set((state) => {
      const idSet = new Set(sessionIds);
      const newMessages: Record<string, Message[]> = {};
      const newPartials: Record<string, string> = {};
      const newThinkingPartials: Record<string, string> = {};
      const newPendingTurns: Record<string, string[]> = {};
      const newActiveTurns: Record<string, { stepId: string; userMessageId: string } | null> = {};
      const newExecutionClocks: Record<string, SessionExecutionClock> = {};
      const newTraces: Record<string, TraceStep[]> = {};
      const newContextWindows: Record<string, number> = {};

      for (const key of Object.keys(state.messagesBySession)) {
        if (!idSet.has(key)) newMessages[key] = state.messagesBySession[key];
      }
      for (const key of Object.keys(state.partialMessagesBySession)) {
        if (!idSet.has(key)) newPartials[key] = state.partialMessagesBySession[key];
      }
      for (const key of Object.keys(state.partialThinkingBySession)) {
        if (!idSet.has(key)) newThinkingPartials[key] = state.partialThinkingBySession[key];
      }
      for (const key of Object.keys(state.pendingTurnsBySession)) {
        if (!idSet.has(key)) newPendingTurns[key] = state.pendingTurnsBySession[key];
      }
      for (const key of Object.keys(state.activeTurnsBySession)) {
        if (!idSet.has(key)) newActiveTurns[key] = state.activeTurnsBySession[key];
      }
      for (const key of Object.keys(state.executionClockBySession)) {
        if (!idSet.has(key)) newExecutionClocks[key] = state.executionClockBySession[key];
      }
      for (const key of Object.keys(state.traceStepsBySession)) {
        if (!idSet.has(key)) newTraces[key] = state.traceStepsBySession[key];
      }
      for (const key of Object.keys(state.contextWindowBySession)) {
        if (!idSet.has(key)) newContextWindows[key] = state.contextWindowBySession[key];
      }

      return {
        sessions: state.sessions.filter((s) => !idSet.has(s.id)),
        messagesBySession: newMessages,
        partialMessagesBySession: newPartials,
        partialThinkingBySession: newThinkingPartials,
        pendingTurnsBySession: newPendingTurns,
        activeTurnsBySession: newActiveTurns,
        executionClockBySession: newExecutionClocks,
        traceStepsBySession: newTraces,
        contextWindowBySession: newContextWindows,
        activeSessionId:
          state.activeSessionId && idSet.has(state.activeSessionId)
            ? null
            : state.activeSessionId,
      };
    }),

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  // Message actions
  addMessage: (sessionId, message) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId] || [];
      let updatedMessages = messages;
      let updatedPendingTurns = state.pendingTurnsBySession;

      if (message.role === 'user') {
        updatedMessages = [...messages, message];
        const pending = [...(state.pendingTurnsBySession[sessionId] || []), message.id];
        updatedPendingTurns = {
          ...state.pendingTurnsBySession,
          [sessionId]: pending,
        };
      } else {
        const activeTurn = state.activeTurnsBySession[sessionId];
        if (activeTurn?.userMessageId) {
          const anchorIndex = messages.findIndex((item) => item.id === activeTurn.userMessageId);
          if (anchorIndex >= 0) {
            let insertIndex = anchorIndex + 1;
            while (insertIndex < messages.length) {
              if (messages[insertIndex].role === 'user') break;
              insertIndex += 1;
            }
            updatedMessages = [
              ...messages.slice(0, insertIndex),
              message,
              ...messages.slice(insertIndex),
            ];
          } else {
            updatedMessages = [...messages, message];
          }
        } else {
          updatedMessages = [...messages, message];
        }
      }

      const shouldClearPartial = message.role === 'assistant';
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: updatedMessages,
        },
        pendingTurnsBySession: updatedPendingTurns,
        partialMessagesBySession: shouldClearPartial
          ? {
              ...state.partialMessagesBySession,
              [sessionId]: '',
            }
          : state.partialMessagesBySession,
        partialThinkingBySession: shouldClearPartial
          ? {
              ...state.partialThinkingBySession,
              [sessionId]: '',
            }
          : state.partialThinkingBySession,
      };
    }),

  startExecutionClock: (sessionId, startAt) =>
    set((state) => ({
      executionClockBySession: {
        ...state.executionClockBySession,
        [sessionId]: { startAt, endAt: null },
      },
    })),

  finishExecutionClock: (sessionId, endAt) =>
    set((state) => {
      const current = state.executionClockBySession[sessionId] ?? { startAt: null, endAt: null };
      if (current.startAt === null) return {};
      return {
        executionClockBySession: {
          ...state.executionClockBySession,
          [sessionId]: {
            startAt: current.startAt,
            endAt: endAt ?? Date.now(),
          },
        },
      };
    }),

  clearExecutionClock: (sessionId) =>
    set((state) => ({
      executionClockBySession: {
        ...state.executionClockBySession,
        [sessionId]: { startAt: null, endAt: null },
      },
    })),

  setMessages: (sessionId, messages) =>
    set((state) => ({
      messagesBySession: {
        ...state.messagesBySession,
        [sessionId]: messages,
      },
    })),

  setPartialMessage: (sessionId, partial) =>
    set((state) => ({
      partialMessagesBySession: {
        ...state.partialMessagesBySession,
        [sessionId]: (state.partialMessagesBySession[sessionId] || '') + partial,
      },
    })),

  clearPartialMessage: (sessionId) =>
    set((state) => ({
      partialMessagesBySession: {
        ...state.partialMessagesBySession,
        [sessionId]: '',
      },
    })),

  setPartialThinking: (sessionId, delta) =>
    set((state) => ({
      partialThinkingBySession: {
        ...state.partialThinkingBySession,
        [sessionId]: (state.partialThinkingBySession[sessionId] || '') + delta,
      },
    })),

  clearPartialThinking: (sessionId) =>
    set((state) => ({
      partialThinkingBySession: {
        ...state.partialThinkingBySession,
        [sessionId]: '',
      },
    })),

  activateNextTurn: (sessionId, stepId) =>
    set((state) => {
      const pending = state.pendingTurnsBySession[sessionId] || [];
      if (pending.length === 0) {
        return {
          activeTurnsBySession: {
            ...state.activeTurnsBySession,
            [sessionId]: null,
          },
        };
      }

      const [nextMessageId, ...rest] = pending;
      const messages = state.messagesBySession[sessionId] || [];
      const updatedMessages = messages.map((message) =>
        message.id === nextMessageId ? { ...message, localStatus: undefined } : message
      );

      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: updatedMessages,
        },
        pendingTurnsBySession: {
          ...state.pendingTurnsBySession,
          [sessionId]: rest,
        },
        activeTurnsBySession: {
          ...state.activeTurnsBySession,
          [sessionId]: { stepId, userMessageId: nextMessageId },
        },
      };
    }),

  updateActiveTurnStep: (sessionId, stepId) =>
    set((state) => {
      const activeTurn = state.activeTurnsBySession[sessionId];
      if (!activeTurn || activeTurn.stepId === stepId) return {};
      return {
        activeTurnsBySession: {
          ...state.activeTurnsBySession,
          [sessionId]: { ...activeTurn, stepId },
        },
      };
    }),

  clearActiveTurn: (sessionId, stepId) =>
    set((state) => {
      const activeTurn = state.activeTurnsBySession[sessionId];
      if (!activeTurn) return {};
      if (stepId && activeTurn.stepId !== stepId) return {};
      return {
        activeTurnsBySession: {
          ...state.activeTurnsBySession,
          [sessionId]: null,
        },
      };
    }),

  clearPendingTurns: (sessionId) =>
    set((state) => ({
      pendingTurnsBySession: {
        ...state.pendingTurnsBySession,
        [sessionId]: [],
      },
    })),

  clearQueuedMessages: (sessionId) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId] || [];
      let hasQueued = false;
      const updatedMessages = messages.map((message) => {
        if (message.localStatus === 'queued') {
          hasQueued = true;
          return { ...message, localStatus: undefined };
        }
        return message;
      });
      if (!hasQueued) return {};
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: updatedMessages,
        },
      };
    }),

  cancelQueuedMessages: (sessionId) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId] || [];
      let hasQueued = false;
      const updatedMessages = messages.map((message) => {
        if (message.localStatus === 'queued') {
          hasQueued = true;
          return { ...message, localStatus: 'cancelled' as const };
        }
        return message;
      });
      if (!hasQueued) return {};
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: updatedMessages,
        },
      };
    }),

  // Trace actions
  addTraceStep: (sessionId, step) =>
    set((state) => ({
      traceStepsBySession: {
        ...state.traceStepsBySession,
        [sessionId]: [...(state.traceStepsBySession[sessionId] || []), step],
      },
    })),

  updateTraceStep: (sessionId, stepId, updates) =>
    set((state) => ({
      traceStepsBySession: {
        ...state.traceStepsBySession,
        [sessionId]: (state.traceStepsBySession[sessionId] || []).map((step) =>
          step.id === stepId ? { ...step, ...updates } : step
        ),
      },
    })),

  setTraceSteps: (sessionId, steps) =>
    set((state) => ({
      traceStepsBySession: {
        ...state.traceStepsBySession,
        [sessionId]: steps,
      },
    })),

  // UI actions
  setLoading: (loading) => set({ isLoading: loading }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleContextPanel: () =>
    set((state) => ({ contextPanelCollapsed: !state.contextPanelCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setContextPanelCollapsed: (collapsed) => set({ contextPanelCollapsed: collapsed }),
  setShowSettings: (show) => set({ showSettings: show }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),

  // Permission actions
  setPendingPermission: (permission) => set({ pendingPermission: permission }),

  // Sudo password actions
  setPendingSudoPassword: (request) => set({ pendingSudoPassword: request }),

  // Settings actions
  setSettings: (updates) =>
    set((state) => ({
      settings: { ...state.settings, ...updates },
    })),
  updateSettings: (updates) =>
    set((state) => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        window.electronAPI.send({
          type: 'settings.update',
          payload: updates as Record<string, unknown>,
        });
      }
      return {
        settings: { ...state.settings, ...updates },
      };
    }),

  // Config actions
  setAppConfig: (config) => set({ appConfig: config }),
  setIsConfigured: (configured) => set({ isConfigured: configured }),
  setShowConfigModal: (show) => set({ showConfigModal: show }),
  markInitialConfigStatusSeen: () => set({ hasSeenInitialConfigStatus: true }),
  setGlobalNotice: (notice) => set({ globalNotice: notice }),
  clearGlobalNotice: () => set({ globalNotice: null }),

  // Working directory actions
  setWorkingDir: (path) => set({ workingDir: path }),

  // Sandbox setup actions
  setSandboxSetupProgress: (progress) => set({ sandboxSetupProgress: progress }),
  setSandboxSetupComplete: (complete) => set({ isSandboxSetupComplete: complete }),

  // Sandbox sync actions
  setSandboxSyncStatus: (status) => set({ sandboxSyncStatus: status }),
  setSkillsStorageChangedAt: (timestamp) => set({ skillsStorageChangedAt: timestamp }),
  setSkillsStorageChangeEvent: (event) => set({ skillsStorageChangeEvent: event }),

  // Context window actions
  setSessionContextWindow: (sessionId, contextWindow) =>
    set((state) => ({
      contextWindowBySession: {
        ...state.contextWindowBySession,
        [sessionId]: contextWindow,
      },
    })),

  // System theme actions
  setSystemDarkMode: (dark) => set({ systemDarkMode: dark }),
}));

// Expose helpers for nav-server (CLI-driven UI navigation via executeJavaScript)
if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;

  w.__getNavStatus = () => {
    const s = useAppStore.getState();
    return {
      showSettings: !!s.showSettings,
      activeSessionId: s.activeSessionId || null,
      sessionCount: (s.sessions || []).length,
    };
  };

  w.__navigate = (page: string, tab?: string, sessionId?: string) => {
    const store = useAppStore.getState();
    if (page === 'welcome') {
      store.setShowSettings(false);
      store.setActiveSession(null);
    } else if (page === 'settings') {
      store.setSettingsTab(tab || 'api');
      store.setShowSettings(true);
    } else if (page === 'session' && sessionId) {
      store.setShowSettings(false);
      store.setActiveSession(sessionId);
    }
    return true;
  };
}
