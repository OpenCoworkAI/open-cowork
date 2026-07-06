import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Gauge, Zap, AlertTriangle } from 'lucide-react';
import { useContextUsage } from '../hooks/useContextUsage';
import { useIPC } from '../hooks/useIPC';
import { useActiveSessionId } from '../store/selectors';
import { useActiveCompactionHistory } from '../store/selectors';

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function ContextUsageBar() {
  const { t } = useTranslation();
  const usage = useContextUsage();
  const activeSessionId = useActiveSessionId();
  const { send } = useIPC();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const compactionHistory = useActiveCompactionHistory();
  const lastHistoryLengthRef = useRef(compactionHistory.length);
  const compactTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset compacting state when a new compaction event arrives
  useEffect(() => {
    if (compactionHistory.length > lastHistoryLengthRef.current && isCompacting) {
      setIsCompacting(false);
      if (compactTimeoutRef.current) {
        clearTimeout(compactTimeoutRef.current);
        compactTimeoutRef.current = null;
      }
    }
    lastHistoryLengthRef.current = compactionHistory.length;
  }, [compactionHistory.length, isCompacting]);

  // Reset dialog state when session changes
  useEffect(() => {
    setShowConfirm(false);
    setIsCompacting(false);
  }, [activeSessionId]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (compactTimeoutRef.current) clearTimeout(compactTimeoutRef.current);
    };
  }, []);

  const handleCompact = useCallback(() => {
    if (!activeSessionId) return;
    setIsCompacting(true);
    setShowConfirm(false);
    send({
      type: 'session.compact',
      payload: { sessionId: activeSessionId },
    });
    // Safety timeout: if no compaction.result arrives within 30s, reset state
    compactTimeoutRef.current = setTimeout(() => setIsCompacting(false), 30000);
  }, [activeSessionId, send]);

  if (!usage) return null;

  const { tokens, contextWindow, percent, projectedTurnsRemaining } = usage;
  const showCompactButton = percent > 50;
  const isUrgent = percent > 80;

  const barColor = percent > 80 ? 'bg-error' : percent > 50 ? 'bg-warning' : 'bg-accent';

  const textColor = percent > 80 ? 'text-error' : percent > 50 ? 'text-warning' : 'text-text-muted';

  return (
    <div className="relative px-5 lg:px-8 py-1.5 border-b border-border-muted bg-background/60">
      <div className="max-w-[920px] mx-auto flex items-center gap-3">
        {isUrgent ? (
          <AlertTriangle className="w-3.5 h-3.5 text-error shrink-0" />
        ) : (
          <Gauge className="w-3.5 h-3.5 text-text-muted shrink-0" />
        )}

        <div className="flex-1 h-1.5 bg-surface-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${barColor}`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>

        <span className={`text-xs whitespace-nowrap ${textColor}`}>
          {Math.round(percent)}% · {formatTokens(tokens)}/{formatTokens(contextWindow)}
          {projectedTurnsRemaining !== null && (
            <span className="text-text-muted ml-1">
              · ~{projectedTurnsRemaining} {t('compaction.turnsLeft')}
            </span>
          )}
        </span>

        {showCompactButton && !isCompacting && (
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
              isUrgent
                ? 'bg-error/10 text-error hover:bg-error/20 border border-error/20'
                : 'bg-surface-muted text-text-muted hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <Zap className="w-3 h-3" />
            {t('compaction.compactNow')}
          </button>
        )}

        {isCompacting && (
          <span className="text-xs text-accent animate-pulse">{t('compaction.compacting')}</span>
        )}
      </div>

      {/* Confirmation dialog — rendered as portal to avoid overflow clipping */}
      {showConfirm &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999]"
            onClick={() => setShowConfirm(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowConfirm(false);
            }}
          >
            <div
              className="absolute top-12 left-0 right-0 px-5 lg:px-8 py-3 bg-background border-b border-border-muted shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="max-w-[920px] mx-auto flex items-center justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm text-text-primary font-medium">
                    {t('compaction.confirmTitle')}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {t('compaction.confirmDescription')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowConfirm(false)}
                    className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:bg-surface-hover transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleCompact}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-background hover:bg-accent-hover transition-colors"
                  >
                    {t('compaction.confirm')}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
