import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import { SettingsPanel } from './SettingsPanel';
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  Sparkles,
  Moon,
  Sun,
  Settings,
  Trash,
} from 'lucide-react';

export function Sidebar() {
  const { t } = useTranslation();
  const {
    sessions,
    activeSessionId,
    settings,
    messagesBySession,
    traceStepsBySession,
    activeTurnsBySession,
    pendingTurnsBySession,
    setActiveSession,
    setMessages,
    setTraceSteps,
    updateSettings,
    isConfigured,
    sidebarCollapsed,
    toggleSidebar,
  } = useAppStore();
  const { deleteSession, getSessionMessages, getSessionTraceSteps, isElectron } = useIPC();
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Handle session click - load messages if needed
  const handleSessionClick = useCallback(async (sessionId: string) => {
    if (activeSessionId === sessionId) return;
    
    setActiveSession(sessionId);
    
    // Check if we already have messages loaded for this session
    const existingMessages = messagesBySession[sessionId];
    if (!existingMessages || existingMessages.length === 0) {
      // Load messages from persistent storage
      if (isElectron) {
        setLoadingSession(sessionId);
        try {
          const messages = await getSessionMessages(sessionId);
          if (messages && messages.length > 0) {
            setMessages(sessionId, messages);
            console.log('[Sidebar] Loaded', messages.length, 'messages for session:', sessionId);
          }
        } catch (error) {
          console.error('[Sidebar] Failed to load messages:', error);
        } finally {
          setLoadingSession(null);
        }
      }
    }

    const existingSteps = traceStepsBySession[sessionId];
    if ((!existingSteps || existingSteps.length === 0) && isElectron) {
      try {
        const steps = await getSessionTraceSteps(sessionId);
        setTraceSteps(sessionId, steps || []);
      } catch (error) {
        console.error('[Sidebar] Failed to load trace steps:', error);
      }
    }
  }, [
    activeSessionId,
    messagesBySession,
    traceStepsBySession,
    setActiveSession,
    setMessages,
    setTraceSteps,
    getSessionMessages,
    getSessionTraceSteps,
    isElectron,
  ]);

  const toggleTheme = () => {
    updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' });
  };

  const handleNewSession = () => {
    setActiveSession(null);
  };

  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    deleteSession(sessionId);
  };

  const handleDeleteAllSessions = () => {
    if (sessions.length === 0) return;
    
    const confirmed = window.confirm(`确定要删除所有 ${sessions.length} 个对话吗？此操作无法撤销。`);
    if (confirmed) {
      // Delete all sessions
      sessions.forEach(session => {
        deleteSession(session.id);
      });
      // Clear active session
      setActiveSession(null);
    }
  };

  return (
    <div
      className={`bg-surface border-r border-border flex flex-col overflow-hidden transition-all duration-200 ${
        sidebarCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Header with App Title and Dark Mode Toggle */}
      <div
        className={`border-b border-border ${
          sidebarCollapsed
            ? 'px-2 pt-3 pb-3 flex flex-col items-center gap-2'
            : 'px-4 pt-6 pb-4 flex items-center justify-between'
        }`}
      >
        {sidebarCollapsed ? (
          <>
            <button
              onClick={toggleSidebar}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
              title="Expand sidebar"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
              title={settings.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {settings.theme === 'dark' ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-accent-muted flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-accent" />
              </div>
              <h1 className="text-lg font-semibold text-text-primary whitespace-nowrap">Open Cowork</h1>
            </div>
            <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
          title={settings.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {settings.theme === 'dark' ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </button>
              <button
                onClick={toggleSidebar}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
                title="Collapse sidebar"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* New Task Button */}
      <div className="p-3">
        <button
          onClick={handleNewSession}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-hover transition-colors ${
            sidebarCollapsed ? 'justify-center' : ''
          }`}
          title={t('sidebar.newTask')}
        >
          <div className="w-8 h-8 rounded-lg bg-accent-muted flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-accent" />
          </div>
          {!sidebarCollapsed && (
            <span className="font-medium text-text-primary">{t('sidebar.newTask')}</span>
          )}
        </button>
      </div>
      
      {/* Sessions List */}
      <div className={`flex-1 overflow-y-auto ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
        {/* Sessions Header */}
        {!sidebarCollapsed && sessions.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 mb-1">
            <span className="text-xs font-medium text-text-muted tracking-wide">
              {t('sidebar.recents')} ({sessions.length})
            </span>
            <button
              onClick={handleDeleteAllSessions}
              className="w-6 h-6 rounded flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-error transition-colors"
              title={t('sidebar.deleteAll')}
            >
              <Trash className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="space-y-1">
          {sidebarCollapsed ? (
            <div className="text-center py-6 text-text-muted text-xs">
              <p>{t('sidebar.expandToView')}</p>
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-6 text-text-muted text-sm">
              <p>{t('sidebar.noTasks')}</p>
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => handleSessionClick(session.id)}
                onMouseEnter={() => setHoveredSession(session.id)}
                onMouseLeave={() => setHoveredSession(null)}
                className={`group relative px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
                  activeSessionId === session.id
                    ? 'bg-surface-active'
                    : 'hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    loadingSession === session.id ? 'bg-accent animate-pulse' :
                    (activeTurnsBySession[session.id] || (pendingTurnsBySession[session.id]?.length ?? 0) > 0) ? 'bg-accent' :
                    session.status === 'completed' ? 'bg-success' :
                    session.status === 'error' ? 'bg-error' : 'bg-border'
                  }`} />
                  <span className="text-sm text-text-primary truncate flex-1">
                    {session.title}
                  </span>
                </div>
                
                {/* Delete button */}
                {hoveredSession === session.id && (
                  <button
                    onClick={(e) => handleDeleteSession(e, session.id)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center hover:bg-surface-active text-text-muted hover:text-error transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Info text */}
        {!sidebarCollapsed && (
        <p className="text-xs text-text-muted px-3 py-4">
            {t('sidebar.localTasks')}
        </p>
        )}
      </div>
      
      {/* User Footer */}
      <div className="p-3 border-t border-border">
        {sidebarCollapsed ? (
          <button
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center justify-center px-3 py-2 rounded-xl hover:bg-surface-hover transition-colors"
            title="Settings"
          >
            <Settings className="w-4 h-4 text-text-muted" />
          </button>
        ) : (
          <button
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-surface-hover transition-colors group"
          >
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white text-sm font-medium flex-shrink-0">
              U
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{t('sidebar.user')}</span>
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${isConfigured ? 'bg-success' : 'bg-amber-500'}`}
                  title={isConfigured ? t('sidebar.apiConfigured') : t('sidebar.apiNotConfigured')}
                />
              </div>
              <p className="text-xs text-text-muted">
                {isConfigured ? t('sidebar.apiConfigured') : t('sidebar.apiNotConfigured')}
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-text-muted group-hover:text-text-primary transition-colors">
            <Settings className="w-4 h-4" />
            </div>
          </button>
        )}
      </div>
      
      {/* Settings Panel */}
      {showSettings && (
        <SettingsPanel
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
