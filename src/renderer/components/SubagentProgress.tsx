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
  const [expanded, setExpanded] = useState(false);

  const isRunning = state.status === 'running';
  const isCompleted = state.status === 'completed';
  const isFailed = state.status === 'failed';

  // Truncate task description for the header summary (collapsed + expanded alike)
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

        {/* Label + task summary */}
        <span className="text-xs font-medium text-text-secondary truncate flex-1 min-w-0">
          {t('subagent.label')}: &ldquo;{taskPreview}&rdquo;
        </span>

        {/* Duration */}
        {state.durationMs != null && (
          <span className="text-[10px] text-text-muted flex-shrink-0 tabular-nums">
            {formatDuration(state.durationMs)}
          </span>
        )}

        {/* Chevron */}
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        )}
      </button>

      {/* Expanded content — full task + tools + full text, single click like the main blocks */}
      {expanded && (
        <div className="border-t border-border/50">
          {/* Full task (the "input") */}
          <div className="px-3 py-2 border-b border-border/50">
            <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">
              {t('subagent.taskLabel')}
            </div>
            <p className="text-xs text-text-secondary whitespace-pre-wrap break-words">
              {state.task}
            </p>
          </div>

          {/* Tool activity list */}
          {state.tools.length > 0 && (
            <div className="px-3 py-2 space-y-1 border-b border-border/50">
              {state.tools.map((tool, index) => (
                <ToolActivityRow key={`${tool.toolName}-${index}`} tool={tool} />
              ))}
              {state.activeToolName && (
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <Loader2 className="w-3 h-3 animate-spin text-accent" />
                  <Wrench className="w-3 h-3" />
                  <span className="font-mono">{state.activeToolName}</span>
                </div>
              )}
            </div>
          )}

          {/* Full accumulated text (the "output") — no second click needed */}
          {state.accumulatedText && (
            <div className="px-3 py-2 border-b border-border/50">
              <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">
                {t('subagent.outputLabel')}
              </div>
              <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-all bg-surface-muted rounded-lg p-2.5 border border-border-subtle max-h-[300px] overflow-y-auto">
                {state.accumulatedText}
              </pre>
            </div>
          )}

          {/* Error display */}
          {isFailed && state.error && (
            <div className="px-3 py-2 border-b border-border/50">
              <div className="text-[10px] uppercase tracking-wide text-error mb-1">
                {t('subagent.errorLabel')}
              </div>
              <p className="text-xs text-error whitespace-pre-wrap break-words">{state.error}</p>
            </div>
          )}

          {/* Completion status */}
          {isCompleted && (
            <div className="px-3 py-2">
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
