import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History, ChevronDown, ChevronUp, Zap, Bot } from 'lucide-react';
import { useCompactionHistory } from '../hooks/useCompactionHistory';
import type { CompactionEvent } from '../hooks/useCompactionHistory';

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function CompactionEntry({ event }: { event: CompactionEvent }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const afterLabel = event.tokensAfter !== null ? formatTokens(event.tokensAfter) : '—';

  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-start gap-2 hover:bg-surface-hover transition-colors text-left"
      >
        {event.type === 'auto' ? (
          <Bot className="w-3.5 h-3.5 text-accent mt-0.5 shrink-0" />
        ) : (
          <Zap className="w-3.5 h-3.5 text-warning mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">{formatTime(event.timestamp)}</span>
            <span className="text-xs text-text-primary font-medium">
              {event.type === 'auto' ? t('compaction.autoCompact') : t('compaction.manualCompact')}
            </span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            {formatTokens(event.tokensBefore)} → {afterLabel} {t('compaction.tokens')}
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-2 pl-8 space-y-1.5">
          {event.summary && (
            <div>
              <p className="text-xs text-text-muted font-medium">{t('compaction.summary')}:</p>
              <p className="text-xs text-text-secondary mt-0.5 whitespace-pre-wrap line-clamp-4">
                {event.summary}
              </p>
            </div>
          )}
          {event.readFiles.length > 0 && (
            <div>
              <p className="text-xs text-text-muted font-medium">
                {t('compaction.filesReferenced')}:
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {event.readFiles.slice(0, 5).map((file) => (
                  <li key={file} className="text-xs text-text-secondary truncate">
                    {file}
                  </li>
                ))}
                {event.readFiles.length > 5 && (
                  <li className="text-xs text-text-muted">
                    +{event.readFiles.length - 5} {t('compaction.more')}
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CompactionHistory() {
  const { t } = useTranslation();
  const history = useCompactionHistory();
  const [isOpen, setIsOpen] = useState(false);

  if (history.length === 0) return null;

  return (
    <div className="border-b border-border-muted">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-surface-hover transition-colors"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-text-muted uppercase tracking-wider">
          <History className="w-3.5 h-3.5" />
          {t('compaction.history')}
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-surface-muted text-text-muted text-[10px]">
            {history.length}
          </span>
        </span>
        {isOpen ? (
          <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
        )}
      </button>

      {isOpen && (
        <div className="max-h-48 overflow-y-auto">
          {history.map((event) => (
            <CompactionEntry key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
