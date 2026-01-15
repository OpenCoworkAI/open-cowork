import { create } from 'zustand';
import type { Session, Message, TraceStep, PermissionRequest, UserQuestionRequest, Settings, AppConfig } from '../types';

interface AppState {
  // Sessions
  sessions: Session[];
  activeSessionId: string | null;
  
  // Messages
  messagesBySession: Record<string, Message[]>;
  partialMessage: string;
  
  // Trace steps
  traceStepsBySession: Record<string, TraceStep[]>;
  
  // UI state
  isLoading: boolean;
  sidebarCollapsed: boolean;
  
  // Permission
  pendingPermission: PermissionRequest | null;
  
  // User Question (AskUserQuestion)
  pendingQuestion: UserQuestionRequest | null;
  
  // Settings
  settings: Settings;
  
  // App Config (API settings)
  appConfig: AppConfig | null;
  isConfigured: boolean;
  showConfigModal: boolean;
  
  // Actions
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  
  addMessage: (sessionId: string, message: Message) => void;
  setPartialMessage: (partial: string) => void;
  clearPartialMessage: () => void;
  
  addTraceStep: (sessionId: string, step: TraceStep) => void;
  updateTraceStep: (sessionId: string, stepId: string, updates: Partial<TraceStep>) => void;
  
  setLoading: (loading: boolean) => void;
  toggleSidebar: () => void;
  
  setPendingPermission: (permission: PermissionRequest | null) => void;
  setPendingQuestion: (question: UserQuestionRequest | null) => void;
  
  updateSettings: (updates: Partial<Settings>) => void;
  
  // Config actions
  setAppConfig: (config: AppConfig | null) => void;
  setIsConfigured: (configured: boolean) => void;
  setShowConfigModal: (show: boolean) => void;
}

const defaultSettings: Settings = {
  theme: 'dark',
  defaultTools: ['read', 'glob', 'grep'],
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
  partialMessage: '',
  traceStepsBySession: {},
  isLoading: false,
  sidebarCollapsed: false,
  pendingPermission: null,
  pendingQuestion: null,
  settings: defaultSettings,
  appConfig: null,
  isConfigured: false,
  showConfigModal: false,
  
  // Session actions
  setSessions: (sessions) => set({ sessions }),
  
  addSession: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions],
      messagesBySession: { ...state.messagesBySession, [session.id]: [] },
      traceStepsBySession: { ...state.traceStepsBySession, [session.id]: [] },
    })),
  
  updateSession: (sessionId, updates) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, ...updates } : s
      ),
    })),
  
  removeSession: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...restMessages } = state.messagesBySession;
      const { [sessionId]: __, ...restTraces } = state.traceStepsBySession;
      return {
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        messagesBySession: restMessages,
        traceStepsBySession: restTraces,
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
      };
    }),
  
  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),
  
  // Message actions
  addMessage: (sessionId, message) =>
    set((state) => ({
      messagesBySession: {
        ...state.messagesBySession,
        [sessionId]: [...(state.messagesBySession[sessionId] || []), message],
      },
      partialMessage: '', // Clear partial when full message arrives
    })),
  
  setPartialMessage: (partial) =>
    set((state) => ({ partialMessage: state.partialMessage + partial })),
  
  clearPartialMessage: () => set({ partialMessage: '' }),
  
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
  
  // UI actions
  setLoading: (loading) => set({ isLoading: loading }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  
  // Permission actions
  setPendingPermission: (permission) => set({ pendingPermission: permission }),
  
  // Question actions (AskUserQuestion)
  setPendingQuestion: (question) => set({ pendingQuestion: question }),
  
  // Settings actions
  updateSettings: (updates) =>
    set((state) => ({
      settings: { ...state.settings, ...updates },
    })),
  
  // Config actions
  setAppConfig: (config) => set({ appConfig: config }),
  setIsConfigured: (configured) => set({ isConfigured: configured }),
  setShowConfigModal: (show) => set({ showConfigModal: show }),
}));

