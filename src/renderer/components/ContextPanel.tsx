import { useState } from 'react';
import { useAppStore } from '../store';
import {
  ChevronDown,
  ChevronUp,
  FileText,
  FolderOpen,
  Globe,
  File,
  Check,
  Loader2,
  AlertCircle,
  Terminal,
  Search,
  Eye,
  Edit,
} from 'lucide-react';
import type { TraceStep } from '../types';

export function ContextPanel() {
  const { activeSessionId, sessions, traceStepsBySession } = useAppStore();
  const [progressOpen, setProgressOpen] = useState(true);
  const [artifactsOpen, setArtifactsOpen] = useState(true);
  const [contextOpen, setContextOpen] = useState(true);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const steps = activeSessionId ? traceStepsBySession[activeSessionId] || [] : [];

  return (
    <div className="w-80 bg-surface border-l border-border flex flex-col overflow-hidden">
      {/* Progress Section */}
      <div className="border-b border-border">
        <button
          onClick={() => setProgressOpen(!progressOpen)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-hover transition-colors"
        >
          <span className="text-sm font-medium text-text-primary">Progress</span>
          <div className="flex items-center gap-2">
            {steps.filter(s => s.status === 'running').length > 0 && (
              <Loader2 className="w-4 h-4 text-accent animate-spin" />
            )}
            {progressOpen ? (
              <ChevronUp className="w-4 h-4 text-text-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-text-muted" />
            )}
          </div>
        </button>
        
        {progressOpen && (
          <div className="px-4 pb-4 max-h-80 overflow-y-auto">
            {steps.length === 0 ? (
              <p className="text-xs text-text-muted">
                Steps will show as the task unfolds.
              </p>
            ) : (
              <div className="space-y-2">
                {steps.map((step) => (
                  <TraceStepItem key={step.id} step={step} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Artifacts Section */}
      <div className="border-b border-border">
        <button
          onClick={() => setArtifactsOpen(!artifactsOpen)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-hover transition-colors"
        >
          <span className="text-sm font-medium text-text-primary">Artifacts</span>
          {artifactsOpen ? (
            <ChevronUp className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          )}
        </button>
        
        {artifactsOpen && (
          <div className="px-4 pb-4 space-y-1">
            {/* Extract artifacts from trace steps */}
            {steps.filter(s => s.type === 'tool_result' && s.toolName === 'write_file').length === 0 ? (
              <p className="text-xs text-text-muted">No artifacts yet</p>
            ) : (
              steps
                .filter(s => s.type === 'tool_result' && s.toolName === 'write_file')
                .map((step, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-hover cursor-pointer transition-colors"
                  >
                    <FileText className="w-4 h-4 text-text-muted" />
                    <span className="text-sm text-text-primary truncate">
                      {step.toolOutput?.split(' ').pop() || 'File created'}
                    </span>
                  </div>
                ))
            )}
          </div>
        )}
      </div>

      {/* Context Section */}
      <div className="flex-1 overflow-y-auto">
        <button
          onClick={() => setContextOpen(!contextOpen)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-hover transition-colors"
        >
          <span className="text-sm font-medium text-text-primary">Context</span>
          {contextOpen ? (
            <ChevronUp className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          )}
        </button>
        
        {contextOpen && (
          <div className="px-4 pb-4 space-y-4">
            {/* Working Directory */}
            <div>
              <p className="text-xs text-text-muted mb-2">Working Directory</p>
              <div className="space-y-1">
                {activeSession?.cwd ? (
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface-muted">
                    <FolderOpen className="w-4 h-4 text-accent" />
                    <span className="text-sm text-text-primary truncate" title={activeSession.cwd}>
                      {activeSession.cwd}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted px-2">No folder selected</p>
                )}
              </div>
            </div>

            {/* Tools Used */}
            <div>
              <p className="text-xs text-text-muted mb-2">Tools Used</p>
              <div className="space-y-1">
                {getUniqueTools(steps).map((tool, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface-muted"
                  >
                    {getToolIcon(tool)}
                    <span className="text-sm text-text-primary">{tool}</span>
                    <span className="text-xs text-text-muted ml-auto">
                      {steps.filter(s => s.toolName === tool).length}x
                    </span>
                  </div>
                ))}
                {getUniqueTools(steps).length === 0 && (
                  <p className="text-xs text-text-muted px-2">No tools used yet</p>
                )}
              </div>
            </div>

            {/* Connectors */}
            <div>
              <p className="text-xs text-text-muted mb-2">Connectors</p>
              <div className="space-y-1">
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-hover cursor-pointer transition-colors opacity-50">
                  <Globe className="w-4 h-4 text-text-muted" />
                  <span className="text-sm text-text-muted">Web search (coming soon)</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TraceStepItem({ step }: { step: TraceStep }) {
  const [expanded, setExpanded] = useState(false);

  const getIcon = () => {
    if (step.status === 'running') {
      return <Loader2 className="w-4 h-4 text-accent animate-spin" />;
    }
    if (step.status === 'error') {
      return <AlertCircle className="w-4 h-4 text-error" />;
    }
    if (step.status === 'completed') {
      return <Check className="w-4 h-4 text-success" />;
    }
    return <div className="w-4 h-4 rounded-full border-2 border-border" />;
  };

  const getBgColor = () => {
    if (step.status === 'running') return 'bg-accent/10 border-accent/30';
    if (step.status === 'error') return 'bg-error/10 border-error/30';
    if (step.status === 'completed') return 'bg-success/10 border-success/30';
    return 'bg-surface-muted border-border';
  };

  return (
    <div className={`rounded-lg border ${getBgColor()} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left"
      >
        {getIcon()}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">
            {step.title}
          </p>
          {step.toolName && (
            <p className="text-xs text-text-muted">{step.toolName}</p>
          )}
        </div>
        {(step.toolInput || step.toolOutput) && (
          <ChevronDown className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
        )}
      </button>

      {expanded && (step.toolInput || step.toolOutput) && (
        <div className="px-3 pb-3 space-y-2">
          {step.toolInput && (
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">Input:</p>
              <pre className="text-xs bg-surface p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
                {JSON.stringify(step.toolInput, null, 2)}
              </pre>
            </div>
          )}
          {step.toolOutput && (
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">Output:</p>
              <pre className="text-xs bg-surface p-2 rounded overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                {step.toolOutput}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getUniqueTools(steps: TraceStep[]): string[] {
  const tools = new Set<string>();
  steps.forEach(step => {
    if (step.toolName) tools.add(step.toolName);
  });
  return Array.from(tools);
}

function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'read_file':
      return <Eye className="w-4 h-4 text-blue-500" />;
    case 'write_file':
      return <Edit className="w-4 h-4 text-green-500" />;
    case 'list_directory':
      return <FolderOpen className="w-4 h-4 text-yellow-500" />;
    case 'execute_command':
      return <Terminal className="w-4 h-4 text-purple-500" />;
    case 'search_files':
      return <Search className="w-4 h-4 text-orange-500" />;
    default:
      return <File className="w-4 h-4 text-text-muted" />;
  }
}
