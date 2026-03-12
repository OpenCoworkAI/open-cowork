import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  Moon,
  Sun,
  Settings,
  Search as SearchIcon,
  Plus,
} from 'lucide-react';
import type { Session } from '../types';

const sidebarLogoSrc = new URL('../../../resources/logo.png', import.meta.url).href;

type SessionGroup = {
  key: string;
  label: string;
  sessions: Session[];
};

export function Sidebar() {
  const { t } = useTranslation();
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const settings = useAppStore((s) => s.settings);
  const messagesBySession = useAppStore((s) => s.messagesBySession);
  const traceStepsBySession = useAppStore((s) => s.traceStepsBySession);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setMessages = useAppStore((s) => s.setMessages);
  const setTraceSteps = useAppStore((s) => s.setTraceSteps);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const isConfigured = useAppStore((s) => s.isConfigured);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const { deleteSession, getSessionMessages, getSessionTraceSteps, isElectron } = useIPC();
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredSessions = normalizedQuery
    ? sessions.filter((session) => session.title.toLowerCase().includes(normalizedQuery))
    : sessions;

  const groupedSessions = useMemo(
    () => groupSessionsByDate(filteredSessions, t),
    [filteredSessions, t]
  );

  const handleSessionClick = useCallback(async (sessionId: string) => {
    setShowSettings(false);

    if (activeSessionId === sessionId) return;

    setActiveSession(sessionId);

    const existingMessages = messagesBySession[sessionId];
    if ((!existingMessages || existingMessages.length === 0) && isElectron) {
      setLoadingSession(sessionId);
      try {
        const messages = await getSessionMessages(sessionId);
        if (messages && messages.length > 0) {
          setMessages(sessionId, messages);
        }
      } catch (error) {
        console.error('[Sidebar] Failed to load messages:', error);
      } finally {
        setLoadingSession(null);
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
    getSessionMessages,
    getSessionTraceSteps,
    isElectron,
    messagesBySession,
    setActiveSession,
    setMessages,
    setShowSettings,
    setTraceSteps,
    traceStepsBySession,
  ]);

  const handleNewSession = () => {
    setActiveSession(null);
    setShowSettings(false);
  };

  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    deleteSession(sessionId);
  };

  const toggleTheme = () => {
    updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' });
  };

  if (sidebarCollapsed) {
    return (
      <aside className="w-[4.5rem] bg-surface/96 border-r border-border-muted flex flex-col overflow-hidden">
        <div className="px-3 pt-4 pb-3 flex flex-col items-center gap-2 border-b border-border-muted">
          <button
            onClick={toggleSidebar}
            className="w-9 h-9 rounded-2xl flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
            title={t('context.expandPanel')}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={handleNewSession}
            className="w-9 h-9 rounded-2xl flex items-center justify-center bg-background hover:bg-surface-hover transition-colors text-text-primary border border-border-subtle"
            title={t('sidebar.newTask')}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-3 py-4">
          <button
            onClick={toggleSidebar}
            className="rounded-2xl px-2 py-3 text-[11px] leading-4 text-center text-text-muted hover:bg-surface-hover transition-colors"
            title={t('sidebar.expandToView')}
          >
            {t('sidebar.expandToView')}
          </button>
        </div>

        <div className="px-3 py-3 border-t border-border-muted flex flex-col items-center gap-2">
          <button
            onClick={toggleTheme}
            className="w-9 h-9 rounded-2xl flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
            title={t('sidebar.themeToggle')}
          >
            {settings.theme === 'dark' ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="w-9 h-9 rounded-2xl flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary relative"
            title={t('sidebar.settings')}
          >
            <Settings className="w-4 h-4" />
            {!isConfigured && (
              <span className="absolute right-2 top-2 w-1.5 h-1.5 rounded-full bg-accent" />
            )}
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-[17.5rem] bg-surface/96 border-r border-border-muted flex flex-col overflow-hidden">
      <div className="px-4 pt-5 pb-4 border-b border-border-muted">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <img
              src={sidebarLogoSrc}
              alt="Open Cowork logo"
              className="w-10 h-10 rounded-2xl object-cover border border-border-subtle bg-background/60 flex-shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-[1.34rem] leading-none font-semibold tracking-[-0.035em] text-text-primary">
                Open Cowork
              </h1>
            </div>
          </div>
          <button
            onClick={toggleSidebar}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary flex-shrink-0"
            title={t('context.collapsePanel')}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={handleNewSession}
          className="mt-4 w-full flex items-center gap-3 rounded-2xl border border-border-subtle bg-background/60 px-3.5 py-3 text-left text-text-primary hover:bg-surface-hover transition-colors"
        >
          <div className="w-8 h-8 rounded-xl bg-accent-muted text-accent flex items-center justify-center flex-shrink-0">
            <Plus className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium">{t('sidebar.newTask')}</div>
            <div className="text-[11px] text-text-muted mt-0.5">{t('sidebar.newTaskHint')}</div>
          </div>
        </button>

        {sessions.length > 0 && (
          <div className="mt-3 relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('sidebar.search')}
              className="w-full rounded-xl border border-transparent bg-background/50 pl-9 pr-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border focus:bg-background transition-colors"
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {groupedSessions.length === 0 ? (
          <div className="px-3 py-8">
            <p className="text-sm text-text-secondary">{t('sidebar.noTasks')}</p>
            <p className="mt-1 text-xs leading-5 text-text-muted">{t('sidebar.noTasksHint')}</p>
          </div>
        ) : (
          <div className="space-y-5">
            {groupedSessions.map((group) => (
              <section key={group.key}>
                <div className="px-3 pb-2 text-[11px] font-medium tracking-[0.04em] text-text-muted">
                  {group.label}
                </div>
                <div className="space-y-1">
                  {group.sessions.map((session) => {
                    const isActive = activeSessionId === session.id;
                    const isLoading = loadingSession === session.id;
                    return (
                      <div
                        key={session.id}
                        onClick={() => handleSessionClick(session.id)}
                        onMouseEnter={() => setHoveredSession(session.id)}
                        onMouseLeave={() => setHoveredSession(null)}
                        className={`group relative cursor-pointer rounded-2xl px-3 py-3 transition-colors ${
                          isActive
                            ? 'bg-background border border-border-subtle'
                            : 'hover:bg-surface-hover/80'
                        }`}
                      >
                        <div className="pr-8 min-w-0">
                          <div className="text-[13px] font-medium leading-5 text-text-primary truncate">
                            {session.title}
                          </div>
                          <div className="mt-1 text-[11px] leading-4 text-text-muted">
                            {isLoading ? t('common.loading') : formatRelativeTime(session.updatedAt || session.createdAt)}
                          </div>
                        </div>

                        {hoveredSession === session.id && (
                          <button
                            onClick={(e) => handleDeleteSession(e, session.id)}
                            className="absolute right-2 top-2 w-7 h-7 rounded-xl flex items-center justify-center text-text-muted hover:text-error hover:bg-surface-active transition-colors"
                            title={t('common.delete')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-3 border-t border-border-muted">
        <div className="flex items-center gap-2 rounded-2xl bg-background/50 px-3 py-2.5">
          <button
            onClick={() => setShowSettings(true)}
            className="flex-1 min-w-0 flex items-center gap-2 text-left text-text-secondary hover:text-text-primary transition-colors"
          >
            <Settings className="w-4 h-4 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-text-primary">{t('sidebar.settings')}</div>
              <div className="text-[11px] text-text-muted truncate">
                {isConfigured ? t('sidebar.apiConfigured') : t('sidebar.apiNotConfigured')}
              </div>
            </div>
          </button>

          <button
            onClick={toggleTheme}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors flex-shrink-0"
            title={t('sidebar.themeToggle')}
          >
            {settings.theme === 'dark' ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}

function groupSessionsByDate(
  sessions: Session[],
  t: (key: string) => string
): SessionGroup[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfPreviousWeek = startOfToday - 7 * 86_400_000;

  const buckets: SessionGroup[] = [
    { key: 'today', label: t('sidebar.today'), sessions: [] },
    { key: 'yesterday', label: t('sidebar.yesterday'), sessions: [] },
    { key: 'previousWeek', label: t('sidebar.previousWeek'), sessions: [] },
    { key: 'older', label: t('sidebar.older'), sessions: [] },
  ];

  const sortedSessions = [...sessions].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  for (const session of sortedSessions) {
    const timestamp = session.updatedAt || session.createdAt;
    if (timestamp >= startOfToday) {
      buckets[0].sessions.push(session);
    } else if (timestamp >= startOfYesterday) {
      buckets[1].sessions.push(session);
    } else if (timestamp >= startOfPreviousWeek) {
      buckets[2].sessions.push(session);
    } else {
      buckets[3].sessions.push(session);
    }
  }

  return buckets.filter((bucket) => bucket.sessions.length > 0);
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
