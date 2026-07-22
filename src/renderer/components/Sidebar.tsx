import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Trash2,
  Moon,
  Sun,
  Monitor,
  Settings,
  Search as SearchIcon,
  Plus,
  ListChecks,
  Check,
  FolderClosed,
  FolderOpen,
  MoreHorizontal,
  Pin,
  X,
} from 'lucide-react';
import type { Session, SessionStatus } from '../types';
import {
  Button,
  IconButton,
  Input,
  cn,
  DialogOverlay,
  DialogPanel,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from './ui';
import { formatRelativeTime } from '../utils/i18n-format';

import sidebarLogoSrc from '../assets/logo.png';

type SessionGroup = {
  key: string;
  label: string;
  sessions: Session[];
  /** Absolute working directory — only set for project groups. */
  cwd?: string;
  pinned?: boolean;
};

const STATUS_DOT: Record<SessionStatus, string> = {
  running: 'bg-accent animate-pulse',
  error: 'bg-error',
  completed: 'bg-success/70',
  idle: 'bg-text-muted/30',
};

function cwdBasename(cwd?: string): string | null {
  if (!cwd) return null;
  const base = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return base || null;
}

export function Sidebar() {
  const { t } = useTranslation();
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const settings = useAppStore((s) => s.settings);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setMessages = useAppStore((s) => s.setMessages);
  const setTraceSteps = useAppStore((s) => s.setTraceSteps);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const isConfigured = useAppStore((s) => s.isConfigured);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const {
    deleteSession,
    batchDeleteSessions,
    getSessionMessages,
    getSessionTraceSteps,
    isElectron,
  } = useIPC();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const normalizedQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);
  const filteredSessions = useMemo(() => {
    return normalizedQuery
      ? sessions.filter((session) => session.title.toLowerCase().includes(normalizedQuery))
      : sessions;
  }, [sessions, normalizedQuery]);

  // Project-first: grouping by working folder is the default structure,
  // matching how the app organizes work; time grouping is the opt-out.
  const [groupMode, setGroupModeState] = useState<'time' | 'project'>(
    () => (localStorage.getItem('sidebar-group-mode') === 'time' ? 'time' : 'project')
  );
  const setGroupMode = useCallback((mode: 'time' | 'project') => {
    localStorage.setItem('sidebar-group-mode', mode);
    setGroupModeState(mode);
  }, []);

  const [sortMode, setSortModeState] = useState<'updated' | 'created'>(
    () => (localStorage.getItem('sidebar-sort-mode') === 'created' ? 'created' : 'updated')
  );
  const setSortMode = useCallback((mode: 'updated' | 'created') => {
    localStorage.setItem('sidebar-sort-mode', mode);
    setSortModeState(mode);
  }, []);

  const [organizeOpen, setOrganizeOpen] = useState(false);
  const organizeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!organizeOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (organizeRef.current && !organizeRef.current.contains(e.target as Node)) {
        setOrganizeOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [organizeOpen]);

  // Groups with more sessions than this stay clipped until "show more".
  const CLIP_AT = 6;
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const expandGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => new Set(prev).add(key));
  }, []);

  const [pinnedProjects, setPinnedProjects] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('sidebar-pinned-projects') || '[]');
      return Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : [];
    } catch {
      return [];
    }
  });
  const togglePinProject = useCallback((cwd: string) => {
    setPinnedProjects((prev) => {
      const next = prev.includes(cwd) ? prev.filter((p) => p !== cwd) : [...prev, cwd];
      localStorage.setItem('sidebar-pinned-projects', JSON.stringify(next));
      return next;
    });
  }, []);

  const [projectMenuKey, setProjectMenuKey] = useState<string | null>(null);
  // The menu floats to the RIGHT of the sidebar (over the main content) via a
  // body portal — a dropdown inside the scroll container would be clipped and
  // cover the rows below.
  const [projectMenuPos, setProjectMenuPos] = useState<{ top: number; left: number } | null>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const projectMenuTriggerRef = useRef<HTMLElement | null>(null);
  const openProjectMenu = useCallback((key: string, trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    projectMenuTriggerRef.current = trigger;
    // Clamp so the menu never runs off the bottom of the window.
    setProjectMenuPos({
      top: Math.min(rect.top - 4, window.innerHeight - 170),
      left: rect.right + 8,
    });
    setProjectMenuKey(key);
  }, []);
  const closeProjectMenu = useCallback(() => {
    setProjectMenuKey(null);
    setProjectMenuPos(null);
    projectMenuTriggerRef.current = null;
  }, []);
  useEffect(() => {
    if (!projectMenuKey) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (projectMenuRef.current?.contains(target)) return;
      if (projectMenuTriggerRef.current?.contains(target)) return;
      closeProjectMenu();
    };
    const onScrollOrResize = () => closeProjectMenu();
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onScrollOrResize);
    document.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onScrollOrResize);
      document.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [projectMenuKey, closeProjectMenu]);

  // Remove = delete this project's session records from the list only;
  // the folder on disk is never touched. Confirmed via dialog.
  const [removeTarget, setRemoveTarget] = useState<SessionGroup | null>(null);
  const confirmRemoveProject = useCallback(() => {
    if (!removeTarget) return;
    batchDeleteSessions(removeTarget.sessions.map((s) => s.id));
    setRemoveTarget(null);
  }, [removeTarget, batchDeleteSessions]);

  const showProjectInFolder = useCallback((cwd: string) => {
    void window.electronAPI?.showItemInFolder?.(cwd);
  }, []);

  const groupedSessions = useMemo(
    () =>
      groupMode === 'project'
        ? groupSessionsByProject(filteredSessions, t, sortMode, pinnedProjects)
        : groupSessionsByDate(filteredSessions, t, sortMode),
    [filteredSessions, groupMode, sortMode, pinnedProjects, t]
  );

  // Exit select mode when sidebar collapses
  useEffect(() => {
    if (sidebarCollapsed && isSelectMode) {
      setIsSelectMode(false);
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
    }
  }, [sidebarCollapsed, isSelectMode]);

  // Escape key exits select mode
  useEffect(() => {
    if (!isSelectMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSelectMode(false);
        setSelectedIds(new Set());
        setShowDeleteConfirm(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelectMode]);

  // Reset selection when search query changes to avoid deleting hidden sessions
  useEffect(() => {
    if (isSelectMode) {
      setSelectedIds(new Set());
    }
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
    setShowDeleteConfirm(false);
  }, []);

  const toggleSelectSession = useCallback((sessionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const visibleSessionIds = useMemo(() => filteredSessions.map((s) => s.id), [filteredSessions]);

  const allVisibleSelected =
    visibleSessionIds.length > 0 && visibleSessionIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = useCallback(() => {
    if (allVisibleSelected) {
      // Deselect all visible, keep others
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of visibleSessionIds) {
          next.delete(id);
        }
        return next;
      });
    } else {
      // Select all visible, keep existing selections
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of visibleSessionIds) {
          next.add(id);
        }
        return next;
      });
    }
  }, [allVisibleSelected, visibleSessionIds]);

  const handleBatchDelete = useCallback(() => {
    const visibleSet = new Set(visibleSessionIds);
    const ids = Array.from(selectedIds).filter((id) => visibleSet.has(id));
    if (ids.length === 0) return;
    batchDeleteSessions(ids);
    exitSelectMode();
  }, [selectedIds, visibleSessionIds, batchDeleteSessions, exitSelectMode]);

  const handleSessionClick = useCallback(
    async (sessionId: string) => {
      setShowSettings(false);

      if (activeSessionId === sessionId) return;

      setActiveSession(sessionId);

      // Read sessionStates at call-time from the store rather than closing over
      // the selector value. The selector returns a new object reference every
      // time any session's state changes (patchSession spreads the whole map),
      // so including it in deps would rebuild this callback on every streaming
      // tick and cause a React #185 "Maximum update depth exceeded" loop when
      // rapidly switching sessions on slow renderers (e.g. Windows).
      const currentSessionStates = useAppStore.getState().sessionStates;

      const existingMessages = currentSessionStates[sessionId]?.messages;
      if ((!existingMessages || existingMessages.length === 0) && isElectron) {
        try {
          const messages = await getSessionMessages(sessionId);
          if (messages && messages.length > 0) {
            setMessages(sessionId, messages);
          }
        } catch (error) {
          console.error('[Sidebar] Failed to load messages:', error);
        }
      }

      const existingSteps = currentSessionStates[sessionId]?.traceSteps;
      if ((!existingSteps || existingSteps.length === 0) && isElectron) {
        try {
          const steps = await getSessionTraceSteps(sessionId);
          setTraceSteps(sessionId, steps || []);
        } catch (error) {
          console.error('[Sidebar] Failed to load trace steps:', error);
        }
      }
    },
    [
      activeSessionId,
      getSessionMessages,
      getSessionTraceSteps,
      isElectron,
      setActiveSession,
      setMessages,
      setShowSettings,
      setTraceSteps,
    ]
  );

  const handleNewSession = () => {
    setActiveSession(null);
    setShowSettings(false);
  };

  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    deleteSession(sessionId);
  };

  const toggleTheme = () => {
    const next =
      settings.theme === 'dark' ? 'light' : settings.theme === 'light' ? 'system' : 'dark';
    updateSettings({ theme: next });
  };

  const themeIcon =
    settings.theme === 'dark' ? (
      <Sun className="w-4 h-4" />
    ) : settings.theme === 'light' ? (
      <Moon className="w-4 h-4" />
    ) : (
      <Monitor className="w-4 h-4" />
    );

  if (sidebarCollapsed) {
    return (
      <aside className="w-[4.5rem] bg-surface/96 border-r border-border-muted flex flex-col overflow-hidden">
        <div className="px-3 pt-4 pb-3 flex flex-col items-center gap-2 border-b border-border-muted">
          <IconButton onClick={toggleSidebar} title={t('context.expandPanel')}>
            <ChevronRight className="w-4 h-4" />
          </IconButton>
          <IconButton variant="solid" onClick={handleNewSession} title={t('sidebar.newTask')}>
            <Plus className="w-4 h-4" />
          </IconButton>
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
          <IconButton onClick={toggleTheme} title={t('sidebar.themeToggle')}>
            {themeIcon}
          </IconButton>
          <IconButton
            onClick={() => setShowSettings(true)}
            title={t('sidebar.settings')}
            className="relative"
          >
            <Settings className="w-4 h-4" />
            {!isConfigured && (
              <span className="absolute right-2 top-2 w-1.5 h-1.5 rounded-full bg-accent" />
            )}
          </IconButton>
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
              alt={t('common.appLogoAlt')}
              className="w-10 h-10 rounded-2xl object-cover border border-border-subtle bg-background/60 flex-shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-[1.34rem] leading-none font-semibold tracking-[-0.035em] text-text-primary">
                Open Cowork
              </h1>
            </div>
          </div>
          <IconButton
            size="sm"
            onClick={toggleSidebar}
            title={t('context.collapsePanel')}
            className="rounded-xl"
          >
            <ChevronLeft className="w-4 h-4" />
          </IconButton>
        </div>

        <button
          onClick={handleNewSession}
          className="mt-4 w-full flex items-center gap-2 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-left text-text-primary shadow-soft hover:bg-surface-hover active:bg-surface-active transition-colors"
        >
          <Plus className="w-4 h-4 text-accent flex-shrink-0" />
          <span className="text-[13px] font-medium">{t('sidebar.newTask')}</span>
        </button>

        {sessions.length > 0 && (
          <div className="mt-2.5 flex items-center gap-2">
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('sidebar.search')}
              leftIcon={<SearchIcon className="w-3.5 h-3.5" />}
              className="bg-background/50 border-transparent focus:bg-background text-[13px]"
            />
            <div className="relative" ref={organizeRef}>
              <IconButton
                size="sm"
                variant={organizeOpen ? 'solid' : 'ghost'}
                onClick={() => setOrganizeOpen((open) => !open)}
                title={t('sidebar.organize')}
                className="rounded-xl"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </IconButton>
              {organizeOpen && (
                <div className="absolute right-0 top-full mt-1 z-30 w-44 rounded-xl border border-border bg-surface shadow-elevated py-1.5 animate-fade-in">
                  <p className="px-3 pt-1 pb-1 text-[11px] text-text-muted">
                    {t('sidebar.grouping')}
                  </p>
                  <OrganizeItem checked={groupMode === 'time'} onClick={() => setGroupMode('time')}>
                    {t('sidebar.byTime')}
                  </OrganizeItem>
                  <OrganizeItem
                    checked={groupMode === 'project'}
                    onClick={() => setGroupMode('project')}
                  >
                    {t('sidebar.byProject')}
                  </OrganizeItem>
                  <div className="my-1.5 h-px bg-border-muted" />
                  <p className="px-3 pt-0.5 pb-1 text-[11px] text-text-muted">
                    {t('sidebar.sortBy')}
                  </p>
                  <OrganizeItem
                    checked={sortMode === 'updated'}
                    onClick={() => setSortMode('updated')}
                  >
                    {t('sidebar.sortRecent')}
                  </OrganizeItem>
                  <OrganizeItem
                    checked={sortMode === 'created'}
                    onClick={() => setSortMode('created')}
                  >
                    {t('sidebar.sortCreated')}
                  </OrganizeItem>
                </div>
              )}
            </div>
            <IconButton
              size="sm"
              variant={isSelectMode ? 'accent' : 'ghost'}
              onClick={() => {
                if (isSelectMode) {
                  exitSelectMode();
                } else {
                  setIsSelectMode(true);
                }
              }}
              title={t('sidebar.manage')}
              className="rounded-xl"
            >
              <ListChecks className="w-3.5 h-3.5" />
            </IconButton>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {groupedSessions.length === 0 ? (
          <div className="px-3 py-6">
            <p className="text-sm text-text-secondary">{t('sidebar.noTasks')}</p>
            <p className="mt-1 text-xs leading-5 text-text-muted">{t('sidebar.noTasksHint')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groupedSessions.map((group) => {
              const isCollapsed = collapsedGroups.has(group.key);
              const isProjectGroup = groupMode === 'project';
              const isClipped = !expandedGroups.has(group.key) && group.sessions.length > CLIP_AT;
              const visibleSessions = isClipped
                ? group.sessions.slice(0, CLIP_AT - 1)
                : group.sessions;
              return (
                <section key={group.key}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleGroup(group.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleGroup(group.key);
                      }
                    }}
                    className={cn(
                      'group/header w-full flex items-center cursor-pointer transition-colors',
                      isProjectGroup
                        ? 'gap-2 rounded-lg px-2.5 h-8 text-[13px] font-medium text-text-primary hover:bg-surface-hover'
                        : 'gap-1.5 px-3 pb-1.5 pt-1 text-[11px] tracking-[0.04em] font-medium text-text-muted hover:text-text-secondary'
                    )}
                  >
                    {isProjectGroup && (
                      <FolderClosed className="w-4 h-4 flex-shrink-0 text-text-secondary" />
                    )}
                    <span className="truncate">{group.label}</span>
                    {group.pinned && (
                      <Pin className="w-3 h-3 flex-shrink-0 text-text-muted rotate-45" />
                    )}
                    <span
                      className={cn(
                        'tabular-nums',
                        isProjectGroup ? 'text-[11px] text-text-muted' : 'text-text-muted/60'
                      )}
                    >
                      {group.sessions.length}
                    </span>
                    <span className="ml-auto flex items-center gap-0.5">
                      {isProjectGroup && group.cwd && (
                        <>
                          <IconButton
                            size="xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (projectMenuKey === group.key) {
                                closeProjectMenu();
                              } else {
                                openProjectMenu(group.key, e.currentTarget);
                              }
                            }}
                            title={t('sidebar.projectActions')}
                            className={cn(
                              'transition-opacity',
                              projectMenuKey === group.key
                                ? 'opacity-100'
                                : 'opacity-0 group-hover/header:opacity-100'
                            )}
                          >
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </IconButton>
                          {projectMenuKey === group.key &&
                            projectMenuPos &&
                            createPortal(
                              <div
                                ref={projectMenuRef}
                                onClick={(e) => e.stopPropagation()}
                                style={{ top: projectMenuPos.top, left: projectMenuPos.left }}
                                className="fixed z-50 w-48 rounded-xl border border-border bg-surface shadow-elevated py-1.5 animate-fade-in cursor-default"
                              >
                                <ProjectMenuItem
                                  icon={<Pin className="w-3.5 h-3.5" />}
                                  onClick={() => {
                                    togglePinProject(group.cwd!);
                                    closeProjectMenu();
                                  }}
                                >
                                  {group.pinned
                                    ? t('sidebar.unpinProject')
                                    : t('sidebar.pinProject')}
                                </ProjectMenuItem>
                                <ProjectMenuItem
                                  icon={<FolderOpen className="w-3.5 h-3.5" />}
                                  onClick={() => {
                                    showProjectInFolder(group.cwd!);
                                    closeProjectMenu();
                                  }}
                                >
                                  {t('sidebar.showInFolder')}
                                </ProjectMenuItem>
                                <div className="my-1.5 h-px bg-border-muted" />
                                <ProjectMenuItem
                                  icon={<X className="w-3.5 h-3.5" />}
                                  danger
                                  onClick={() => {
                                    setRemoveTarget(group);
                                    closeProjectMenu();
                                  }}
                                >
                                  {t('sidebar.removeProject')}
                                </ProjectMenuItem>
                              </div>,
                              document.body
                            )}
                        </>
                      )}
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3 flex-shrink-0 text-text-muted" />
                      ) : (
                        <ChevronDown
                          className={cn(
                            'w-3 h-3 flex-shrink-0 text-text-muted',
                            isProjectGroup &&
                              'opacity-0 group-hover/header:opacity-100 transition-opacity'
                          )}
                        />
                      )}
                    </span>
                  </div>
                  {!isCollapsed && (
                    <div
                      className={cn(
                        'space-y-1',
                        isProjectGroup && 'mt-1 ml-[1.15rem] pl-2 border-l border-border-muted/70'
                      )}
                    >
                      {visibleSessions.map((session) => {
                        const isActive = activeSessionId === session.id;
                        const isSelected = selectedIds.has(session.id);
                        const project = cwdBasename(session.cwd);
                        return (
                          <div
                            key={session.id}
                            onClick={() => {
                              if (isSelectMode) {
                                toggleSelectSession(session.id);
                              } else {
                                handleSessionClick(session.id);
                              }
                            }}
                            className={cn(
                              'group relative cursor-pointer rounded-lg px-2.5 py-2 transition-colors',
                              isSelectMode && isSelected
                                ? 'bg-accent-muted/50'
                                : isActive && !isSelectMode
                                  ? 'bg-surface-active'
                                  : 'hover:bg-surface-hover'
                            )}
                          >
                            <div className="flex items-center gap-2">
                              {isSelectMode && (
                                <div
                                  className={cn(
                                    'w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors',
                                    isSelected
                                      ? 'bg-accent text-white'
                                      : 'border border-border-muted bg-background'
                                  )}
                                >
                                  {isSelected && <Check className="w-2.5 h-2.5" />}
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div
                                  className={cn(
                                    'text-[13px] leading-5 truncate',
                                    isActive && !isSelectMode
                                      ? 'font-medium text-text-primary'
                                      : 'font-normal text-text-primary/85'
                                  )}
                                >
                                  {session.title}
                                </div>
                                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-4 text-text-muted truncate">
                                  <span className="flex-shrink-0">
                                    {formatRelativeTime(session.updatedAt)}
                                  </span>
                                  {project && groupMode !== 'project' && (
                                    <>
                                      <span className="text-text-muted/50 flex-shrink-0">·</span>
                                      <span className="truncate">{project}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              {!isSelectMode && (
                                <span
                                  className={cn(
                                    'w-1.5 h-1.5 rounded-full flex-shrink-0 group-hover:invisible',
                                    STATUS_DOT[session.status]
                                  )}
                                />
                              )}
                            </div>

                            {/* CSS-driven hover reveal — no React state, so mouse
                                movement over the list costs zero re-renders. */}
                            {!isSelectMode && (
                              <IconButton
                                size="xs"
                                variant="danger"
                                onClick={(e) => handleDeleteSession(e, session.id)}
                                title={t('common.delete')}
                                tabIndex={-1}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
                              >
                                <Trash2 className="w-3 h-3" />
                              </IconButton>
                            )}
                          </div>
                        );
                      })}
                      {isClipped && (
                        <button
                          onClick={() => expandGroup(group.key)}
                          className="w-full text-left px-2.5 py-1 text-[11px] leading-5 text-text-muted hover:text-text-secondary transition-colors"
                        >
                          {t('sidebar.showMore')} · {group.sessions.length - (CLIP_AT - 1)}
                        </button>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {isSelectMode ? (
        <div className="px-3 py-3 border-t border-border-muted">
          {showDeleteConfirm ? (
            <div className="border border-error/30 bg-error/10 rounded-lg px-3 py-3">
              <p className="text-[13px] text-text-primary mb-3">
                {t('sidebar.batchDeleteConfirm', { count: selectedIds.size })}
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" fullWidth onClick={() => setShowDeleteConfirm(false)}>
                  {t('sidebar.cancel')}
                </Button>
                <Button
                  size="sm"
                  fullWidth
                  onClick={handleBatchDelete}
                  className="bg-error text-white hover:bg-error/90"
                >
                  {t('sidebar.confirmDelete')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <button
                  onClick={toggleSelectAll}
                  className="text-[12px] font-medium text-accent hover:text-accent/80 transition-colors"
                >
                  {allVisibleSelected ? t('sidebar.deselectAll') : t('sidebar.selectAll')}
                </button>
                <span className="text-[12px] text-text-muted">
                  {t('sidebar.nSelected', { count: selectedIds.size })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" fullWidth onClick={exitSelectMode}>
                  {t('sidebar.cancel')}
                </Button>
                <Button
                  fullWidth
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={selectedIds.size === 0}
                  className="bg-error text-white hover:bg-error/90"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t('common.delete')}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="px-3 py-3 border-t border-border-muted">
          <div className="flex items-center gap-2 rounded-2xl bg-background/50 px-3 py-2.5">
            <button
              onClick={() => setShowSettings(true)}
              className="flex-1 min-w-0 flex items-center gap-2 text-left text-text-secondary hover:text-text-primary transition-colors"
            >
              <Settings className="w-4 h-4 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-text-primary">
                  {t('sidebar.settings')}
                </div>
                <div className="text-[11px] text-text-muted truncate">
                  {isConfigured ? t('sidebar.apiConfigured') : t('sidebar.apiNotConfigured')}
                </div>
              </div>
            </button>

            <IconButton
              size="sm"
              onClick={toggleTheme}
              title={t('sidebar.themeToggle')}
              className="rounded-xl"
            >
              {themeIcon}
            </IconButton>
          </div>
        </div>
      )}

      {removeTarget && (
        <DialogOverlay onClose={() => setRemoveTarget(null)}>
          <DialogPanel size="sm">
            <DialogHeader>
              <DialogTitle>{t('sidebar.removeProjectTitle')}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <p className="text-sm leading-6 text-text-secondary">
                {t('sidebar.removeProjectBody', {
                  name: removeTarget.label,
                  count: removeTarget.sessions.length,
                })}
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
                {t('sidebar.cancel')}
              </Button>
              <Button
                onClick={confirmRemoveProject}
                className="bg-error text-white hover:bg-error/90"
              >
                {t('sidebar.removeProject')}
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogOverlay>
      )}
    </aside>
  );
}

function ProjectMenuItem({
  icon,
  danger,
  onClick,
  children,
}: {
  icon: ReactNode;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-left transition-colors',
        danger
          ? 'text-error hover:bg-error/10'
          : 'text-text-primary hover:bg-surface-hover'
      )}
    >
      <span className="flex-shrink-0 text-current">{icon}</span>
      {children}
    </button>
  );
}

function OrganizeItem({
  checked,
  onClick,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-text-primary hover:bg-surface-hover text-left transition-colors"
    >
      <span className="w-3.5 flex-shrink-0">
        {checked && <Check className="w-3.5 h-3.5 text-accent" />}
      </span>
      {children}
    </button>
  );
}

function sessionSortValue(session: Session, sortKey: 'updated' | 'created'): number {
  return sortKey === 'created' ? session.createdAt : session.updatedAt || session.createdAt;
}

function groupSessionsByProject(
  sessions: Session[],
  t: (key: string) => string,
  sortKey: 'updated' | 'created',
  pinnedCwds: string[]
): SessionGroup[] {
  const sortedSessions = [...sessions].sort(
    (a, b) => sessionSortValue(b, sortKey) - sessionSortValue(a, sortKey)
  );
  const groups = new Map<string, SessionGroup>();
  for (const session of sortedSessions) {
    const project = cwdBasename(session.cwd);
    const key = project ? `project:${session.cwd}` : 'project:none';
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: project ?? t('sidebar.noProject'),
        sessions: [],
        cwd: project ? session.cwd : undefined,
        pinned: project ? pinnedCwds.includes(session.cwd!) : false,
      };
      groups.set(key, group);
    }
    group.sessions.push(session);
  }
  // Pinned projects first (keeping recency order among them), then the rest;
  // the "no project" bucket stays last regardless of recency.
  const all = [...groups.values()];
  const pinned = all.filter((g) => g.pinned);
  const rest = all.filter((g) => !g.pinned && g.key !== 'project:none');
  const none = all.filter((g) => g.key === 'project:none');
  return [...pinned, ...rest, ...none];
}

function groupSessionsByDate(
  sessions: Session[],
  t: (key: string) => string,
  sortKey: 'updated' | 'created'
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

  const sortedSessions = [...sessions].sort(
    (a, b) => sessionSortValue(b, sortKey) - sessionSortValue(a, sortKey)
  );
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
