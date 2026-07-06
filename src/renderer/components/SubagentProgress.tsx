// SubagentProgress — displays a subagent's lifecycle inline in the chat stream.
// Collapsible card-like UI consistent with ToolUseBlock and ThinkingBlock.
import { useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  Bot,
  CheckCircle2,
  XCircle,
  Loader2,
  Wrench,
} from 'lucide-react';
import type { SubagentState, SubagentToolActivity } from '../hooks/useSubagentProgress';

interface SubagentProgressProps {
  state: SubagentState;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

export const SubagentProgress = memo(function SubagentProgress({ state }: SubagentProgressProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(state.status === 'running');
  const [showResult, setShowResult] = useState(false);

  const isRunning = state.status === 'running';
  const isCompleted = state.status === 'completed';
  const isFailed = state.status === 'failed';

  // Truncate task description for collapsed view
  const taskPreview = state.task.length > 60 ? state.task.substring(0, 57) + '...' : state.task;

  return (
    <div
      className={`rounded-2xl border overflow-hidden transition-colors ${
        isFailed
          ? 'border-error/25 bg-error/5'
          : isRunning
            ? 'border-accent/15 bg-accent/5'
            : 'border-border-subtle bg-background/40'
      }`}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-hover/50 transition-colors"
      >
        {/* Status icon */}
        <div
          className={`flex-shrink-0 ${
            isFailed ? 'text-error' : isRunning ? 'text-accent' : 'text-success'
          }`}
        >
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : isFailed ? (
            <XCircle className="w-3.5 h-3.5" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" />
          )}
        </div>

        {/* Bot icon */}
        <Bot className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />

        {/* Label */}
        <span className="text-xs font-medium text-text-secondary truncate flex-1 min-w-0">
          {t('subagent.label')}: &ldquo;{expanded ? state.task : taskPreview}&rdquo;
        </span>

        {/* Duration */}
        {state.durationMs != null && (
          <span className="text-[10px] text-text-muted flex-shrink-0 tabular-nums">
            {formatDuration(state.durationMs)}
          </span>
        )}

        {/* Error preview in collapsed mode */}
        {isFailed && !expanded && state.error && (
          <span className="text-[11px] text-error truncate max-w-[180px] flex-shrink-0">
            {state.error.length > 40 ? state.error.substring(0, 37) + '...' : state.error}
          </span>
        )}

        {/* Chevron */}
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border/50 animate-fade-in">
          {/* Tool activity list */}
          {state.tools.length > 0 && (
            <div className="px-3 py-2 space-y-1">
              {state.tools.map((tool, index) => (
                <ToolActivityRow key={`${tool.toolName}-${index}`} tool={tool} />
              ))}
              {/* Currently running tool indicator */}
              {state.activeToolName && (
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <Loader2 className="w-3 h-3 animate-spin text-accent" />
                  <Wrench className="w-3 h-3" />
                  <span className="font-mono">{state.activeToolName}</span>
                </div>
              )}
            </div>
          )}

          {/* Error display */}
          {isFailed && state.error && (
            <div className="px-3 py-2 border-t border-border/50">
              <p className="text-xs text-error">{state.error}</p>
            </div>
          )}

          {/* Completion status */}
          {isCompleted && (
            <div className="px-3 py-2 border-t border-border/50">
              <div className="flex items-center gap-2 text-xs text-success">
                <CheckCircle2 className="w-3 h-3" />
                <span>
                  {t('subagent.completed')}
                  {state.durationMs != null &&
                    ` ${t('subagent.inDuration', { duration: formatDuration(state.durationMs) })}`}
                </span>
              </div>
            </div>
          )}

          {/* Accumulated text / result (collapsible) */}
          {state.accumulatedText && (
            <div className="px-3 py-2 border-t border-border/50">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowResult(!showResult);
                }}
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                {showResult ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                <span>{t('subagent.showResult')}</span>
              </button>
              {showResult && (
                <pre className="mt-2 text-xs font-mono text-text-secondary whitespace-pre-wrap break-all bg-surface-muted rounded-lg p-2.5 border border-border-subtle max-h-[200px] overflow-y-auto">
                  {state.accumulatedText}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// Sub-component: a single tool activity row
function ToolActivityRow({ tool }: { tool: SubagentToolActivity }) {
  return (
    <div className="flex items-center gap-2 text-xs text-text-muted">
      {tool.isError ? (
        <XCircle className="w-3 h-3 text-error flex-shrink-0" />
      ) : (
        <CheckCircle2 className="w-3 h-3 text-success flex-shrink-0" />
      )}
      <Wrench className="w-3 h-3 flex-shrink-0" />
      <span className="font-mono truncate">{tool.toolName}</span>
      {tool.durationMs != null && (
        <span className="text-[10px] tabular-nums flex-shrink-0">
          ({formatDuration(tool.durationMs)})
        </span>
      )}
    </div>
  );
}
