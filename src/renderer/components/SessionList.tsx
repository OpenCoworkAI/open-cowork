import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Download, Pencil, Trash2 } from 'lucide-react';
import type { Session } from '../types';

type Props = {
  sessions: Session[];
  activeSessionId: string | null;
  selectedIds: Set<string>;
  isSelectMode: boolean;
  exportingSessionId: string | null;
  isElectron: boolean;
  onSessionClick: (sessionId: string) => void;
  onExport: (event: MouseEvent, session: Session) => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (event: MouseEvent, sessionId: string) => void;
};

type SessionGroup = { key: string; label: string; sessions: Session[] };

export function SessionList({
  sessions,
  activeSessionId,
  selectedIds,
  isSelectMode,
  exportingSessionId,
  isElectron,
  onSessionClick,
  onExport,
  onRename,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupSessionsByDate(sessions, t), [sessions, t]);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);

  const finishRename = (session: Session, value: string) => {
    setRenamingSessionId(null);
    const title = value.trim();
    if (title && title !== session.title) {
      onRename(session.id, title);
    }
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>, session: Session) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.currentTarget.value = session.title;
    }
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.currentTarget.blur();
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-3 py-4">
      {groups.length === 0 ? (
        <div className="px-3 py-6">
          <p className="text-sm text-text-secondary">{t('sidebar.noTasks')}</p>
          <p className="mt-1 text-xs leading-5 text-text-muted">{t('sidebar.noTasksHint')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="px-3 pb-2 text-[11px] font-medium tracking-[0.04em] text-text-muted">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.sessions.map((session) => {
                  const isActive = activeSessionId === session.id;
                  const isSelected = selectedIds.has(session.id);
                  const isRenaming = renamingSessionId === session.id;
                  return (
                    <div
                      key={session.id}
                      onClick={() => onSessionClick(session.id)}
                      className={`group relative cursor-pointer rounded-lg px-2.5 py-1.5 transition-colors ${
                        isSelectMode && isSelected
                          ? 'bg-accent-muted/20'
                          : isActive && !isSelectMode
                            ? 'bg-surface-hover/80'
                            : 'hover:bg-surface-hover/60'
                      }`}
                    >
                      <div className={`flex items-center gap-2 ${!isSelectMode ? 'pr-20' : ''}`}>
                        {isSelectMode && (
                          <div
                            className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                              isSelected
                                ? 'bg-accent text-white'
                                : 'border border-border-muted bg-background'
                            }`}
                          >
                            {isSelected && <Check className="w-2.5 h-2.5" />}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          {isRenaming ? (
                            <input
                              autoFocus
                              defaultValue={session.title}
                              aria-label={t('sidebar.renameSession')}
                              onClick={(event) => event.stopPropagation()}
                              onFocus={(event) => event.currentTarget.select()}
                              onKeyDown={(event) => handleRenameKeyDown(event, session)}
                              onBlur={(event) => finishRename(session, event.currentTarget.value)}
                              className="w-full rounded border border-accent bg-background px-1 text-[13px] font-medium leading-5 text-text-primary outline-none"
                            />
                          ) : (
                            <div className="text-[13px] font-medium leading-5 text-text-primary truncate">
                              {session.title}
                            </div>
                          )}
                        </div>
                      </div>

                      {!isSelectMode && !isRenaming && (
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setRenamingSessionId(session.id);
                            }}
                            className="w-6 h-6 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors"
                            title={t('sidebar.renameSession')}
                            aria-label={t('sidebar.renameSession')}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(event) => onExport(event, session)}
                            disabled={
                              exportingSessionId !== null ||
                              (isElectron && session.status === 'running')
                            }
                            className="w-6 h-6 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors disabled:opacity-40"
                            title={t(
                              isElectron && session.status === 'running'
                                ? 'sidebar.exportPending'
                                : 'sidebar.exportSession'
                            )}
                            aria-label={t(
                              isElectron && session.status === 'running'
                                ? 'sidebar.exportPending'
                                : 'sidebar.exportSession'
                            )}
                          >
                            <Download className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(event) => onDelete(event, session.id)}
                            className="w-6 h-6 rounded-lg flex items-center justify-center text-text-muted hover:text-error hover:bg-surface-active transition-colors"
                            title={t('common.delete')}
                            aria-label={t('common.delete')}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
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
  );
}

function groupSessionsByDate(sessions: Session[], t: (key: string) => string) {
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
    (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)
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
