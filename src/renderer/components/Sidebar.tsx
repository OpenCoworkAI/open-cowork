import { useState, useCallback, useEffect } from 'react';
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
  Monitor,
  MessageSquare,
  AlertTriangle,
  Cpu,
  GraduationCap,
} from 'lucide-react';
import CoeadaptIcon from '../assets/icon-color.png';
import CoeadaptLogo from '../assets/logo-full-1.png';

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
    activeView,
    setActiveView,
    coraChatOpen,
    setCoraChatOpen,
    activeCoworkVM,
    showCareerBox,
    setShowCareerBox,
  } = useAppStore();
  const { deleteSession, getSessionMessages, getSessionTraceSteps, isElectron } = useIPC();
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [focusedSessionIndex, setFocusedSessionIndex] = useState(-1);

  // Handle session click - load messages if needed
  const handleSessionClick = useCallback(async (sessionId: string) => {
    if (activeSessionId === sessionId && activeView === 'chat') return;

    setActiveView('chat');
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
    setActiveView('chat');
    setActiveSession(null);
  };

  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    deleteSession(sessionId);
  };

  const handleSessionKeyDown = useCallback((e: React.KeyboardEvent, sessionId: string, index: number) => {
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        handleSessionClick(sessionId);
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (index < sessions.length - 1) {
          setFocusedSessionIndex(index + 1);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (index > 0) {
          setFocusedSessionIndex(index - 1);
        }
        break;
      case 'Delete':
        e.preventDefault();
        deleteSession(sessionId);
        break;
    }
  }, [handleSessionClick, sessions.length, deleteSession]);

  // Focus the session element when focusedSessionIndex changes
  useEffect(() => {
    if (focusedSessionIndex >= 0) {
      const el = document.querySelector(`[data-session-index="${focusedSessionIndex}"]`) as HTMLElement;
      el?.focus();
    }
  }, [focusedSessionIndex]);

  const handleDeleteAllSessions = () => {
    if (sessions.length === 0) return;
    setShowDeleteAllConfirm(true);
  };

  const confirmDeleteAll = () => {
    sessions.forEach(session => {
      deleteSession(session.id);
    });
    setActiveSession(null);
    setShowDeleteAllConfirm(false);
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
            <img src={CoeadaptIcon} alt="Coeadapt Icon" className="w-8 h-8 object-contain mb-2 drop-shadow-md" />
            <button
              onClick={toggleSidebar}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent focus:ring-opacity-30"
              title="Expand sidebar"
              aria-label="Expand sidebar"
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
              <img 
                src={CoeadaptLogo} 
                alt="Coeadapt Logo" 
                className="h-8 w-auto object-contain transition-all duration-300 drop-shadow-sm dark:brightness-0 dark:invert" 
              />
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
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent focus:ring-opacity-30"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Main Navigation */}
      <div className="p-3 space-y-1">
        {!sidebarCollapsed && (
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Navigation
          </p>
        )}
        <button
          onClick={() => { setActiveView('careerbox'); setShowCareerBox(false); }}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
            sidebarCollapsed ? 'justify-center' : ''
          } ${
            activeView === 'careerbox' && !showCareerBox
              ? 'bg-accent-muted text-accent'
              : 'hover:bg-surface-hover text-text-secondary'
          }`}
          title="CareerBox"
        >
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            activeView === 'careerbox' && !showCareerBox ? 'bg-accent/20' : 'bg-surface-hover'
          }`}>
            <Monitor className={`w-4 h-4 ${activeView === 'careerbox' && !showCareerBox ? 'text-accent' : 'text-text-secondary'}`} />
          </div>
          {!sidebarCollapsed && (
            <span className={`font-medium ${activeView === 'careerbox' && !showCareerBox ? 'text-accent' : 'text-text-primary'}`}>CareerBox</span>
          )}
        </button>

        {/* Navi Labs Button */}
        <button
          onClick={() => { setActiveView('careerbox'); setShowCareerBox(true); setActiveSession(null); }}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
            sidebarCollapsed ? 'justify-center' : ''
          } ${
            showCareerBox
              ? 'bg-violet-500/10 text-violet-400'
              : 'hover:bg-surface-hover text-text-secondary'
          }`}
          title={t('sidebar.careerBox')}
        >
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            showCareerBox ? 'bg-violet-500/20' : 'bg-surface-hover'
          }`}>
            <GraduationCap className={`w-4 h-4 ${showCareerBox ? 'text-violet-400' : 'text-text-muted'}`} />
          </div>
          {!sidebarCollapsed && (
            <span className={`font-medium ${showCareerBox ? 'text-violet-400' : 'text-text-primary'}`}>{t('sidebar.careerBox')}</span>
          )}
        </button>

        <button
          onClick={() => setActiveView('vm')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
            sidebarCollapsed ? 'justify-center' : ''
          } ${
            activeView === 'vm'
              ? 'bg-accent-muted text-accent'
              : 'hover:bg-surface-hover text-text-secondary'
          }`}
          title="Virtual Machines"
        >
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            activeView === 'vm' ? 'bg-accent/20' : 'bg-surface-hover'
          }`}>
            <Cpu className={`w-4 h-4 ${activeView === 'vm' ? 'text-accent' : 'text-text-secondary'}`} />
          </div>
          {!sidebarCollapsed && (
            <span className={`font-medium ${activeView === 'vm' ? 'text-accent' : 'text-text-primary'}`}>Virtual Machines</span>
          )}
        </button>

        <button
          onClick={() => setActiveView('cowork-desktop')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
            sidebarCollapsed ? 'justify-center' : ''
          } ${
            activeView === 'cowork-desktop'
              ? 'bg-accent-muted text-accent'
              : 'hover:bg-surface-hover text-text-secondary'
          }`}
          title="Cowork Desktop"
        >
          <div className="relative">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              activeView === 'cowork-desktop' ? 'bg-accent/20' : 'bg-surface-hover'
            }`}>
              <Monitor className={`w-4 h-4 ${activeView === 'cowork-desktop' ? 'text-accent' : 'text-text-secondary'}`} />
            </div>
            {activeCoworkVM && (
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-surface" />
            )}
          </div>
          {!sidebarCollapsed && (
            <span className={`font-medium ${activeView === 'cowork-desktop' ? 'text-accent' : 'text-text-primary'}`}>Cowork Desktop</span>
          )}
        </button>

        <button
          onClick={() => setCoraChatOpen(!coraChatOpen)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
            sidebarCollapsed ? 'justify-center' : ''
          } ${
            coraChatOpen
              ? 'bg-accent-muted text-accent'
              : 'hover:bg-surface-hover text-text-secondary'
          }`}
          title="Cora AI"
        >
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            coraChatOpen ? 'bg-accent/20' : 'bg-surface-hover'
          }`}>
            <MessageSquare className={`w-4 h-4 ${coraChatOpen ? 'text-accent' : 'text-text-secondary'}`} />
          </div>
          {!sidebarCollapsed && (
            <span className={`font-medium ${coraChatOpen ? 'text-accent' : 'text-text-primary'}`}>Cora</span>
          )}
        </button>

        <button
          onClick={handleNewSession}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
            sidebarCollapsed ? 'justify-center' : ''
          } ${activeView === 'chat' && !activeSessionId ? 'bg-accent-muted text-accent' : 'hover:bg-surface-hover'}`}
          title={t('sidebar.newTask')}
        >
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            activeView === 'chat' && !activeSessionId ? 'bg-accent/20' : 'bg-accent-muted'
          }`}>
            <Sparkles className="w-4 h-4 text-accent" />
          </div>
          {!sidebarCollapsed && (
            <span className={`font-medium ${activeView === 'chat' && !activeSessionId ? 'text-accent' : 'text-text-primary'}`}>
              {t('sidebar.newTask')}
            </span>
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
              className="w-6 h-6 rounded flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-error transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-opacity-30"
              title={t('sidebar.deleteAll')}
              aria-label={t('sidebar.deleteAll')}
            >
              <Trash className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="space-y-1" role="listbox" aria-label={t('sidebar.recents')}>
          {sidebarCollapsed ? (
            <div className="text-center py-6 text-text-muted text-xs">
              <p>{t('sidebar.expandToView')}</p>
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-6 text-text-muted text-sm">
              <p>{t('sidebar.noTasks')}</p>
            </div>
          ) : (
            sessions.map((session, index) => (
              <div
                key={session.id}
                role="option"
                aria-selected={activeSessionId === session.id}
                tabIndex={0}
                data-session-index={index}
                onClick={() => handleSessionClick(session.id)}
                onKeyDown={(e) => handleSessionKeyDown(e, session.id, index)}
                onMouseEnter={() => setHoveredSession(session.id)}
                onMouseLeave={() => setHoveredSession(null)}
                className={`group relative px-3 py-2.5 rounded-xl cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-accent focus:ring-opacity-30 ${
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
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center hover:bg-surface-active text-text-muted hover:text-error transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-opacity-30"
                    aria-label={t('sidebar.deleteSession', { title: session.title })}
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
            className="w-full flex items-center justify-center px-3 py-2 rounded-xl hover:bg-surface-hover transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-opacity-30"
            title="Settings"
            aria-label="Settings"
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

      {/* Delete All Confirmation Dialog */}
      {showDeleteAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="card p-6 max-w-sm mx-4 space-y-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-error/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-error" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary">{t('sidebar.deleteAll')}</h3>
            </div>
            <p className="text-sm text-text-secondary">
              {t('sidebar.deleteAllConfirm', { count: sessions.length })}
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowDeleteAllConfirm(false)}
                className="btn btn-secondary px-4 py-2 text-sm"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmDeleteAll}
                className="btn bg-error text-white hover:bg-error/90 px-4 py-2 text-sm"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
