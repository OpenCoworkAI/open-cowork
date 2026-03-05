import { useState, useEffect, useCallback } from 'react';
import type { VMProgressUpdate, VMScreenshotUpdate, VMTaskStepInfo, VMTaskStatus } from '../types';
import {
  Monitor,
  Play,
  Pause,
  Square,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  MousePointer,
  Keyboard,
  Image,
  Terminal,
  ChevronDown,
  ChevronRight,
  Activity,
} from 'lucide-react';

interface VMProgressPanelProps {
  sessionId: string;
}

interface VMTaskState {
  taskId: string;
  title: string;
  status: VMTaskStatus;
  progress: number;
  currentStep?: string;
  stepsCompleted: number;
  stepsTotal: number;
  steps: VMTaskStepInfo[];
  latestScreenshot?: string;
  error?: string;
  startedAt?: number;
}

export function VMProgressPanel({ sessionId }: VMProgressPanelProps) {
  const [tasks, setTasks] = useState<Map<string, VMTaskState>>(new Map());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [showScreenshot, setShowScreenshot] = useState<string | null>(null);

  // Listen for VM progress events via IPC
  useEffect(() => {
    const handleVMProgress = (_event: unknown, data: VMProgressUpdate) => {
      if (data.sessionId !== sessionId) return;

      setTasks(prev => {
        const next = new Map(prev);
        const existing = next.get(data.taskId);

        next.set(data.taskId, {
          ...existing,
          taskId: data.taskId,
          title: data.title,
          status: data.status,
          progress: data.progress,
          currentStep: data.currentStep,
          stepsCompleted: data.stepsCompleted,
          stepsTotal: data.stepsTotal,
          steps: existing?.steps || [],
          latestScreenshot: existing?.latestScreenshot,
          error: data.error,
          startedAt: existing?.startedAt ?? Date.now(),
        });

        return next;
      });
    };

    const handleVMScreenshot = (_event: unknown, data: VMScreenshotUpdate) => {
      if (data.sessionId !== sessionId) return;

      setTasks(prev => {
        const next = new Map(prev);
        const existing = next.get(data.taskId);
        if (existing) {
          next.set(data.taskId, {
            ...existing,
            latestScreenshot: data.screenshotBase64,
          });
        }
        return next;
      });
    };

    // Register IPC listeners (these will be wired up by the preload bridge)
    const api = (window as any).electronAPI;
    if (api?.onVMProgress) {
      api.onVMProgress(handleVMProgress);
    }
    if (api?.onVMScreenshot) {
      api.onVMScreenshot(handleVMScreenshot);
    }

    return () => {
      if (api?.offVMProgress) api.offVMProgress(handleVMProgress);
      if (api?.offVMScreenshot) api.offVMScreenshot(handleVMScreenshot);
    };
  }, [sessionId]);

  const toggleTask = useCallback((taskId: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  const taskList = Array.from(tasks.values()).sort((a, b) =>
    (b.startedAt || 0) - (a.startedAt || 0)
  );

  const activeTasks = taskList.filter(t =>
    t.status === 'running' || t.status === 'initializing' || t.status === 'paused'
  );

  if (taskList.length === 0) {
    return (
      <div className="p-4">
        <div className="text-center py-6 text-text-muted">
          <Monitor className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No VM tasks</p>
          <p className="text-xs mt-1">Tasks will appear when the career agent starts</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Active task summary bar */}
      {activeTasks.length > 0 && (
        <div className="card p-3 border-accent-cyan/30 bg-accent-cyan/5">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-accent-cyan" />
            <span className="text-sm font-medium text-text-primary">
              {activeTasks.length} active task{activeTasks.length !== 1 ? 's' : ''}
            </span>
          </div>
          {activeTasks.map(task => (
            <div key={task.taskId} className="mb-2 last:mb-0">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-text-secondary truncate">{task.title}</span>
                <span className="text-text-muted">{task.progress}%</span>
              </div>
              <div className="w-full bg-background rounded-full h-1.5">
                <div
                  className="bg-accent-cyan h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${task.progress}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Task list */}
      {taskList.map(task => (
        <VMTaskCard
          key={task.taskId}
          task={task}
          expanded={expandedTasks.has(task.taskId)}
          onToggle={() => toggleTask(task.taskId)}
          onShowScreenshot={() => setShowScreenshot(task.latestScreenshot || null)}
        />
      ))}

      {/* Screenshot modal */}
      {showScreenshot && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setShowScreenshot(null)}
        >
          <div className="max-w-4xl max-h-[90vh] overflow-auto">
            <img
              src={`data:image/png;base64,${showScreenshot}`}
              alt="VM Screenshot"
              className="rounded-lg shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Task Card Component
// ============================================================================

interface VMTaskCardProps {
  task: VMTaskState;
  expanded: boolean;
  onToggle: () => void;
  onShowScreenshot: () => void;
}

function VMTaskCard({ task, expanded, onToggle, onShowScreenshot }: VMTaskCardProps) {
  const statusConfig = getStatusConfig(task.status);

  return (
    <div className={`card overflow-hidden ${
      task.status === 'running' ? 'border-accent-cyan/30' : ''
    }`}>
      {/* Header */}
      <div
        className="p-3 flex items-center gap-3 cursor-pointer hover:bg-background/50"
        onClick={onToggle}
      >
        {/* Expand chevron */}
        <div className="text-text-muted">
          {expanded
            ? <ChevronDown className="w-4 h-4" />
            : <ChevronRight className="w-4 h-4" />
          }
        </div>

        {/* Status icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${statusConfig.bgColor}`}>
          {statusConfig.icon}
        </div>

        {/* Title & info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-text-primary truncate">
              {task.title}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${statusConfig.badgeColor}`}>
              {statusConfig.label}
            </span>
          </div>
          {task.currentStep && (
            <p className="text-xs text-text-muted mt-0.5 truncate">
              {task.currentStep}
            </p>
          )}
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-text-muted">
            {task.stepsCompleted}/{task.stepsTotal}
          </span>
          <div className="w-16 bg-background rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all duration-300 ${statusConfig.progressColor}`}
              style={{ width: `${task.progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border">
          {/* Steps list */}
          {task.steps.length > 0 && (
            <div className="p-3 space-y-2">
              {task.steps.map((step, idx) => (
                <VMStepRow key={step.id} step={step} index={idx} />
              ))}
            </div>
          )}

          {/* Screenshot preview */}
          {task.latestScreenshot && (
            <div className="p-3 border-t border-border">
              <div className="flex items-center gap-2 mb-2">
                <Image className="w-3.5 h-3.5 text-text-muted" />
                <span className="text-xs text-text-muted">Latest screenshot</span>
              </div>
              <img
                src={`data:image/png;base64,${task.latestScreenshot}`}
                alt="VM screen"
                className="rounded border border-border cursor-pointer hover:opacity-80 transition-opacity max-h-40 object-contain"
                onClick={(e) => {
                  e.stopPropagation();
                  onShowScreenshot();
                }}
              />
            </div>
          )}

          {/* Error display */}
          {task.error && (
            <div className="p-3 border-t border-border bg-accent-red/5">
              <div className="flex items-start gap-2">
                <XCircle className="w-4 h-4 text-accent-red flex-shrink-0 mt-0.5" />
                <p className="text-xs text-accent-red">{task.error}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Step Row Component
// ============================================================================

interface VMStepRowProps {
  step: VMTaskStepInfo;
  index: number;
}

function VMStepRow({ step, index }: VMStepRowProps) {
  const stepIcon = getStepActionIcon(step.action);
  const stepStatus = getStepStatusConfig(step.status);

  return (
    <div className="flex items-center gap-2 text-xs">
      {/* Step number */}
      <span className="text-text-muted w-4 text-right flex-shrink-0">
        {index + 1}
      </span>

      {/* Status indicator */}
      <div className="flex-shrink-0">{stepStatus.icon}</div>

      {/* Action icon */}
      <div className="text-text-muted flex-shrink-0">{stepIcon}</div>

      {/* Title */}
      <span className={`truncate ${
        step.status === 'running' ? 'text-text-primary font-medium' :
        step.status === 'completed' ? 'text-text-secondary' :
        step.status === 'failed' ? 'text-accent-red' :
        'text-text-muted'
      }`}>
        {step.title}
      </span>

      {/* Duration */}
      {step.duration !== undefined && (
        <span className="text-text-muted ml-auto flex-shrink-0">
          {step.duration}ms
        </span>
      )}

      {/* Error indicator */}
      {step.error && (
        <span className="text-accent-red flex-shrink-0" title={step.error}>
          !
        </span>
      )}
    </div>
  );
}

// ============================================================================
// Status Helpers
// ============================================================================

function getStatusConfig(status: VMTaskStatus) {
  switch (status) {
    case 'queued':
      return {
        icon: <Clock className="w-4 h-4 text-text-muted" />,
        bgColor: 'bg-background',
        badgeColor: 'bg-background text-text-muted',
        progressColor: 'bg-text-muted',
        label: 'Queued',
      };
    case 'initializing':
      return {
        icon: <Loader2 className="w-4 h-4 text-accent-yellow animate-spin" />,
        bgColor: 'bg-accent-yellow/10',
        badgeColor: 'bg-accent-yellow/10 text-accent-yellow',
        progressColor: 'bg-accent-yellow',
        label: 'Starting',
      };
    case 'running':
      return {
        icon: <Loader2 className="w-4 h-4 text-accent-cyan animate-spin" />,
        bgColor: 'bg-accent-cyan/10',
        badgeColor: 'bg-accent-cyan/10 text-accent-cyan',
        progressColor: 'bg-accent-cyan',
        label: 'Running',
      };
    case 'paused':
      return {
        icon: <Pause className="w-4 h-4 text-accent-orange" />,
        bgColor: 'bg-accent-orange/10',
        badgeColor: 'bg-accent-orange/10 text-accent-orange',
        progressColor: 'bg-accent-orange',
        label: 'Paused',
      };
    case 'completed':
      return {
        icon: <CheckCircle2 className="w-4 h-4 text-accent-green" />,
        bgColor: 'bg-accent-green/10',
        badgeColor: 'bg-accent-green/10 text-accent-green',
        progressColor: 'bg-accent-green',
        label: 'Done',
      };
    case 'failed':
      return {
        icon: <XCircle className="w-4 h-4 text-accent-red" />,
        bgColor: 'bg-accent-red/10',
        badgeColor: 'bg-accent-red/10 text-accent-red',
        progressColor: 'bg-accent-red',
        label: 'Failed',
      };
    case 'cancelled':
      return {
        icon: <Square className="w-4 h-4 text-text-muted" />,
        bgColor: 'bg-background',
        badgeColor: 'bg-background text-text-muted',
        progressColor: 'bg-text-muted',
        label: 'Cancelled',
      };
  }
}

function getStepStatusConfig(status: VMTaskStepInfo['status']) {
  switch (status) {
    case 'pending':
      return { icon: <div className="w-2 h-2 rounded-full bg-text-muted" /> };
    case 'running':
      return { icon: <Loader2 className="w-3 h-3 text-accent-cyan animate-spin" /> };
    case 'completed':
      return { icon: <CheckCircle2 className="w-3 h-3 text-accent-green" /> };
    case 'failed':
      return { icon: <XCircle className="w-3 h-3 text-accent-red" /> };
    case 'skipped':
      return { icon: <div className="w-2 h-2 rounded-full bg-text-muted/50" /> };
  }
}

function getStepActionIcon(action?: string) {
  switch (action) {
    case 'screenshot':
      return <Image className="w-3 h-3" />;
    case 'click':
    case 'double_click':
    case 'right_click':
    case 'move':
    case 'drag':
    case 'scroll':
      return <MousePointer className="w-3 h-3" />;
    case 'type':
    case 'key':
      return <Keyboard className="w-3 h-3" />;
    case 'bash':
      return <Terminal className="w-3 h-3" />;
    default:
      return <Play className="w-3 h-3" />;
  }
}
