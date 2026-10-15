import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useAppStore } from '../store';
import type { MemoryUsedItem, TraceStep } from '../types';
import { latestMemoryStep, splitMemoryItems } from '../utils/memory-used';

const EMPTY_STEPS: TraceStep[] = [];

interface MemoryUsedListProps {
  items: MemoryUsedItem[];
  /** Whether a conversation can still be opened; deleted ones have no link. */
  canOpenSession: (sessionId: string) => boolean;
  onOpenSession: (sessionId: string) => void;
}

export function MemoryUsedList({ items, canOpenSession, onOpenSession }: MemoryUsedListProps) {
  const { t } = useTranslation();
  const { core, experience } = splitMemoryItems(items);

  return (
    <div className="px-4 pb-2 space-y-2 max-h-64 overflow-y-auto">
      {core.length > 0 && (
        <div>
          <p className="text-xs text-text-muted font-medium mb-1">{t('context.memoryCore')}</p>
          <ul className="space-y-1">
            {core.map((item) => (
              <li
                key={`${item.category ?? ''}:${item.key}`}
                className="text-xs text-text-secondary"
              >
                <span className="text-text-primary">{item.key}</span>: {item.value}
                {item.userWritten && (
                  <span className="ml-1 text-text-muted">({t('context.memoryUserWritten')})</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {experience.length > 0 && (
        <div>
          <p className="text-xs text-text-muted font-medium mb-1">
            {t('context.memoryExperience')}
          </p>
          <ul className="space-y-1.5">
            {experience.map((item, index) => (
              <li key={`${item.kind}:${item.sessionId}:${index}`} className="text-xs">
                <p className="text-text-secondary line-clamp-3">{item.summary}</p>
                <div className="flex items-center gap-2 text-text-muted">
                  <span className="truncate">
                    {item.sessionTitle || t('context.memoryUntitled')}
                  </span>
                  {item.expanded && <span>{t('context.memoryExpanded')}</span>}
                  {canOpenSession(item.sessionId) && (
                    <button
                      type="button"
                      onClick={() => onOpenSession(item.sessionId)}
                      className="flex items-center gap-0.5 text-accent hover:underline shrink-0"
                    >
                      <ExternalLink className="w-3 h-3" />
                      {t('context.memoryOpenSource')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The saved memory the latest run received, shown in the context panel. */
export function MemoryUsed() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const steps = useAppStore((s) =>
    activeSessionId ? (s.sessionStates[activeSessionId]?.traceSteps ?? EMPTY_STEPS) : EMPTY_STEPS
  );

  const items = latestMemoryStep(steps)?.memoryItems;
  if (!items?.length) {
    return null;
  }
  const { core, experience } = splitMemoryItems(items);

  return (
    <div className="border-b border-border-muted">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-surface-hover transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-medium text-text-muted uppercase tracking-wider">
          <Brain className="w-3.5 h-3.5" />
          {t('context.memoryUsed')}
          <span className="normal-case tracking-normal">
            {t('context.memoryUsedCount', { core: core.length, experience: experience.length })}
          </span>
        </span>
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
        )}
      </button>
      {open && (
        <MemoryUsedList
          items={items}
          canOpenSession={(sessionId) =>
            sessionId !== activeSessionId && sessions.some((session) => session.id === sessionId)
          }
          onOpenSession={setActiveSession}
        />
      )}
    </div>
  );
}
