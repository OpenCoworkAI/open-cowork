import { useAppStore } from '../store';
import type { TraceStep } from '../types';
import {
  Brain,
  MessageSquare,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
} from 'lucide-react';

interface TracePanelProps {
  sessionId: string;
}

export function TracePanel({ sessionId }: TracePanelProps) {
  const { traceStepsBySession } = useAppStore();
  const steps = traceStepsBySession[sessionId] || [];

  return (
    <div className="w-80 border-l border-border bg-background-secondary flex flex-col">
      {/* Header */}
      <div className="h-14 border-b border-border flex items-center px-4">
        <h3 className="font-semibold text-text-primary">Execution Trace</h3>
      </div>

      {/* Steps */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {steps.length === 0 ? (
          <div className="text-center py-8 text-text-muted">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No trace steps yet</p>
            <p className="text-xs mt-1">Steps will appear as the agent executes</p>
          </div>
        ) : (
          steps.map((step, index) => (
            <TraceStepCard key={step.id} step={step} index={index} />
          ))
        )}
      </div>

      {/* Summary */}
      {steps.length > 0 && (
        <div className="p-4 border-t border-border">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-text-muted">Total Steps:</div>
            <div className="text-text-primary font-medium">{steps.length}</div>
            <div className="text-text-muted">Tool Calls:</div>
            <div className="text-text-primary font-medium">
              {steps.filter((s) => s.type === 'tool_call').length}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface TraceStepCardProps {
  step: TraceStep;
  index: number;
}

function TraceStepCard({ step, index }: TraceStepCardProps) {
  const getIcon = () => {
    switch (step.type) {
      case 'thinking':
        return <Brain className="w-4 h-4" />;
      case 'text':
        return <MessageSquare className="w-4 h-4" />;
      case 'tool_call':
      case 'tool_result':
        return <Wrench className="w-4 h-4" />;
    }
  };

  const getStatusIcon = () => {
    switch (step.status) {
      case 'pending':
        return <Clock className="w-3.5 h-3.5 text-text-muted" />;
      case 'running':
        return <Loader2 className="w-3.5 h-3.5 text-accent-cyan animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />;
      case 'error':
        return <XCircle className="w-3.5 h-3.5 text-accent-red" />;
    }
  };

  const getTypeColor = () => {
    switch (step.type) {
      case 'thinking':
        return 'text-accent-yellow bg-accent-yellow/10';
      case 'text':
        return 'text-accent-cyan bg-accent-cyan/10';
      case 'tool_call':
        return 'text-accent-orange bg-accent-orange/10';
      case 'tool_result':
        return step.isError
          ? 'text-accent-red bg-accent-red/10'
          : 'text-accent-green bg-accent-green/10';
    }
  };

  return (
    <div
      className={`card p-3 animate-slide-up ${
        step.status === 'running' ? 'border-accent-cyan/30' : ''
      }`}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${getTypeColor()}`}>
          {getIcon()}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-text-primary truncate">
              {step.title}
            </span>
            {getStatusIcon()}
          </div>

          {/* Tool name */}
          {step.toolName && (
            <div className="text-xs text-accent-orange font-mono mt-1">
              {step.toolName}
            </div>
          )}

          {/* Content preview */}
          {step.content && (
            <p className="text-xs text-text-muted mt-1 line-clamp-2">
              {step.content.slice(0, 100)}
              {step.content.length > 100 && '...'}
            </p>
          )}

          {/* Duration */}
          {step.duration !== undefined && (
            <div className="text-xs text-text-muted mt-1">
              {step.duration}ms
            </div>
          )}
        </div>
      </div>

      {/* Tool input preview */}
      {step.toolInput && (
        <details className="mt-2">
          <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
            View input
          </summary>
          <pre className="text-xs bg-background rounded p-2 mt-1 overflow-x-auto">
            {JSON.stringify(step.toolInput, null, 2).slice(0, 200)}
          </pre>
        </details>
      )}

      {/* Tool output preview */}
      {step.toolOutput && (
        <details className="mt-2">
          <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
            View output
          </summary>
          <pre className="text-xs bg-background rounded p-2 mt-1 overflow-x-auto whitespace-pre-wrap">
            {step.toolOutput.slice(0, 300)}
            {step.toolOutput.length > 300 && '...'}
          </pre>
        </details>
      )}
    </div>
  );
}

