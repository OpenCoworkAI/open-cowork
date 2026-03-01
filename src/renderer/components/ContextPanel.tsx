import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { resolveArtifactPath } from '../utils/artifact-path';
import { extractFilePathFromToolOutput } from '../utils/tool-output-path';
import { getArtifactLabel, getArtifactIconComponent, getArtifactSteps } from '../utils/artifact-steps';
import { useIPC } from '../hooks/useIPC';
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  FileText,
  FileSpreadsheet,
  FilePieChart,
  FileCode2,
  FileArchive,
  FileAudio2,
  FileVideo,
  Image as ImageIcon,
  FolderOpen,
  FolderSync,
  Globe,
  File,
  Check,
  Loader2,
  AlertCircle,
  Terminal,
  Search,
  Eye,
  Edit,
  Plug,
  Wrench,
} from 'lucide-react';
import type { TraceStep, TraceStepStatus, MCPServerInfo } from '../types';

export function ContextPanel() {
  const { t } = useTranslation();
  const {
    activeSessionId,
    sessions,
    traceStepsBySession,
    activeTurnsBySession,
    pendingTurnsBySession,
    contextPanelCollapsed,
    toggleContextPanel,
    workingDir,
  } = useAppStore();
  const { getMCPServers, changeWorkingDir } = useIPC();
  const [progressOpen, setProgressOpen] = useState(true);
  const [artifactsOpen, setArtifactsOpen] = useState(true);
  const [contextOpen, setContextOpen] = useState(true);
  const [expandedConnector, setExpandedConnector] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<MCPServerInfo[]>([]);
  const [copiedPath, setCopiedPath] = useState(false);
  const [isChangingDir, setIsChangingDir] = useState(false);

  const handleCopyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    } catch (err) {
      console.error('Failed to copy path:', err);
    }
  };

  const steps = activeSessionId ? traceStepsBySession[activeSessionId] || [] : [];
  const activeTurn = activeSessionId ? activeTurnsBySession[activeSessionId] : null;
  const pendingCount = activeSessionId ? pendingTurnsBySession[activeSessionId]?.length ?? 0 : 0;
  const isRunning = Boolean(activeTurn || pendingCount > 0);
  const activeSession = activeSessionId ? sessions.find(s => s.id === activeSessionId) : null;
  const currentWorkingDir = activeSession?.cwd || workingDir;
  const { artifactSteps, displayArtifactSteps } = getArtifactSteps(steps);
  const canShowItemInFolder = typeof window !== 'undefined' && !!window.electronAPI?.showItemInFolder;

  // Load MCP servers on mount
  useEffect(() => {
    const loadMCPServers = async () => {
      try {
        const servers = await getMCPServers();
        setMcpServers(servers || []);
      } catch (error) {
        console.error('Failed to load MCP servers:', error);
      }
    };
    loadMCPServers();
    // Refresh every 5 seconds
    const interval = setInterval(loadMCPServers, 5000);
    return () => clearInterval(interval);
  }, [getMCPServers]);

  if (contextPanelCollapsed) {
    return (
      <div className="w-10 bg-surface border-l border-border flex items-start justify-center py-3">
        <button
          onClick={toggleContextPanel}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          title={t('context.expandPanel')}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-80 bg-surface border-l border-border flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center justify-start">
        <button
          onClick={toggleContextPanel}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          title={t('context.collapsePanel')}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      {/* Progress Section */}
      <div className="border-b border-border">
        <button
          onClick={() => setProgressOpen(!progressOpen)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-hover transition-colors"
        >
          <span className="text-sm font-medium text-text-primary">{t('context.progress')}</span>
          <div className="flex items-center gap-2">
            {steps.filter(s => s.status === 'running').length > 0 && (
              <Loader2 className="w-4 h-4 text-accent animate-spin" />
            )}
            {steps.filter(s => s.status === 'running').length === 0 && isRunning && (
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
                {pendingCount > 0 ? t('context.queuedMessages', { count: pendingCount }) : t('context.stepsWillShow')}
              </p>
            ) : (
              <div className="space-y-2">
                {getGroupedSteps(steps).map((group) => (
                  <TraceStepGroupItem key={group.id} group={group} />
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
          <span className="text-sm font-medium text-text-primary">{t('context.artifacts')}</span>
          {artifactsOpen ? (
            <ChevronUp className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          )}
        </button>
        
        {artifactsOpen && (
          <div className="px-4 pb-4 space-y-1">
            {/* Extract artifacts from trace steps */}
            {displayArtifactSteps.length === 0 ? (
              <p className="text-xs text-text-muted">{t('context.noArtifactsYet')}</p>
            ) : (
              displayArtifactSteps.map((step, index) => {
                const artifactInfo = parseArtifactOutput(step.toolOutput);
                const fallbackPath = extractFilePathFromToolOutput(step.toolOutput);
                const resolvedFallbackPath = fallbackPath
                  ? resolveArtifactPath(fallbackPath, currentWorkingDir)
                  : '';
                const label = artifactSteps.length > 0
                  ? getArtifactLabel(artifactInfo?.path || '', artifactInfo?.name)
                  : (fallbackPath ? getArtifactLabel(fallbackPath) : t('context.fileCreated'));
                const artifactPath = artifactSteps.length > 0
                  ? resolveArtifactPath(artifactInfo?.path || '', currentWorkingDir)
                  : resolvedFallbackPath;
                const canClick = Boolean(artifactPath && canShowItemInFolder);
                const iconComponent = getArtifactIconComponent(label);
                const IconComponent =
                  iconComponent === 'presentation' ? FilePieChart
                  : iconComponent === 'table' ? FileSpreadsheet
                  : iconComponent === 'document' ? FileText
                  : iconComponent === 'code' ? FileCode2
                  : iconComponent === 'image' ? ImageIcon
                  : iconComponent === 'audio' ? FileAudio2
                  : iconComponent === 'video' ? FileVideo
                  : iconComponent === 'archive' ? FileArchive
                  : iconComponent === 'text' ? File
                  : File;

                return (
                  <div
                    key={index}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${canClick ? 'cursor-pointer hover:bg-surface-hover' : ''}`}
                    onClick={() => {
                      if (!canClick) return;
                      void window.electronAPI.showItemInFolder(artifactPath);
                    }}
                    title={canClick ? artifactPath : undefined}
                  >
                    <IconComponent className="w-4 h-4 text-text-muted" />
                    <span className="text-sm text-text-primary truncate">
                      {label}
                    </span>
                  </div>
                );
              })
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
          <span className="text-sm font-medium text-text-primary">{t('context.context')}</span>
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
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-text-muted">{t('context.workingDirectory')}</p>
                <button
                  onClick={async () => {
                    setIsChangingDir(true);
                    try {
                      await changeWorkingDir(activeSessionId || undefined);
                    } finally {
                      setIsChangingDir(false);
                    }
                  }}
                  disabled={isChangingDir}
                  className="text-xs text-accent hover:text-accent-hover disabled:opacity-50 flex items-center gap-1 transition-colors"
                  title={t('context.workingDirectory')}
                >
                  {isChangingDir ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <FolderSync className="w-3 h-3" />
                  )}
                  <span>{t('common.edit')}</span>
                </button>
              </div>
              <div className="space-y-1">
                {currentWorkingDir ? (
                  <div 
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                      copiedPath ? 'bg-success/10' : 'bg-surface-muted hover:bg-surface-active'
                    }`}
                    title={copiedPath ? t('context.copied') : `${currentWorkingDir}\nClick to copy`}
                    onClick={() => handleCopyPath(currentWorkingDir)}
                  >
                    {copiedPath ? (
                      <Check className="w-4 h-4 text-success flex-shrink-0" />
                    ) : (
                      <FolderOpen className="w-4 h-4 text-accent flex-shrink-0" />
                    )}
                    <span className={`text-sm break-all leading-relaxed ${copiedPath ? 'text-success' : 'text-text-primary'}`}>
                      {copiedPath ? t('context.copied') : formatPath(currentWorkingDir)}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted px-2">{t('context.noFolderSelected')}</p>
                )}
              </div>
            </div>

            {/* Tools Used - Only show non-MCP tools */}
            <div>
              <p className="text-xs text-text-muted mb-2">{t('context.toolsUsed')}</p>
              <div className="space-y-1">
                {getUniqueNonMCPTools(steps).map((tool, index) => (
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
                {getUniqueNonMCPTools(steps).length === 0 && (
                  <p className="text-xs text-text-muted px-2">{t('context.noToolsUsedYet')}</p>
                )}
              </div>
            </div>

            {/* Connectors - Inside Context */}
            <div>
              <p className="text-xs text-text-muted mb-2">{t('context.mcpConnectors')}</p>
              <div className="space-y-1">
                {mcpServers.length === 0 ? (
                  <p className="text-xs text-text-muted px-2">{t('mcp.noConnectors')}</p>
                ) : (
                  mcpServers.map((server) => (
                    <ConnectorItem
                      key={server.id}
                      server={server}
                      steps={steps}
                      expanded={expandedConnector === server.id}
                      onToggle={() => setExpandedConnector(expandedConnector === server.id ? null : server.id)}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectorItem({ 
  server, 
  steps, 
  expanded, 
  onToggle 
}: { 
  server: MCPServerInfo; 
  steps: TraceStep[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  // Get MCP tools used from this server
  // Tool names are in format: mcp__ServerName__toolname (with double underscores)
  // Server name preserves original case and spaces are replaced with underscores
  const serverNamePattern = server.name.replace(/\s+/g, '_');
  
  const mcpToolsUsed = steps
    .filter(s => s.toolName?.startsWith('mcp__'))
    .map(s => s.toolName!)
    .filter((name, index, self) => self.indexOf(name) === index)
    .filter(name => {
      // Check if this tool belongs to this server
      // Format: mcp__ServerName__toolname
      const match = name.match(/^mcp__(.+?)__(.+)$/);
      if (match) {
        const toolServerName = match[1];
        return toolServerName === serverNamePattern;
      }
      return false;
    });

  const usageCount = steps.filter(s => 
    s.toolName?.startsWith('mcp__') && mcpToolsUsed.includes(s.toolName)
  ).length;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        onClick={onToggle}
        className={`w-full px-3 py-2 flex items-center gap-2 transition-colors ${
          server.connected 
            ? 'bg-purple-500/10 hover:bg-purple-500/20' 
            : 'bg-surface-muted hover:bg-surface-hover'
        }`}
      >
        <div className={`w-6 h-6 rounded flex items-center justify-center ${
          server.connected ? 'bg-purple-500/20' : 'bg-surface-muted'
        }`}>
          <Plug className={`w-3.5 h-3.5 ${server.connected ? 'text-purple-500' : 'text-text-muted'}`} />
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary truncate">
              {server.name}
            </span>
            {!server.connected && (
              <span className="text-xs text-text-muted">({t('mcp.notConnected')})</span>
            )}
          </div>
          {server.connected && (
            <p className="text-xs text-text-muted">
              {server.toolCount} tools
              {usageCount > 0 && ` • ${usageCount} calls`}
            </p>
          )}
        </div>
        {server.connected && (
          expanded ? (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-muted" />
          )
        )}
      </button>

      {expanded && server.connected && (
        <div className="px-3 pb-2 space-y-1 bg-surface">
          {mcpToolsUsed.length > 0 ? (
            <>
              <p className="text-xs text-text-muted px-2 py-1">{t('context.toolsUsedLabel')}</p>
              {mcpToolsUsed.map((toolName, index) => {
                const count = steps.filter(s => s.toolName === toolName).length;
                // Extract readable tool name - remove mcp__ServerName__ prefix
                const match = toolName.match(/^mcp__(.+?)__(.+)$/);
                const readableName = match ? match[2] : toolName;
                
                return (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-purple-500/5 hover:bg-purple-500/10 transition-colors"
                  >
                    <Wrench className="w-3.5 h-3.5 text-purple-500" />
                    <span className="text-xs text-text-primary flex-1">{readableName}</span>
                    <span className="text-xs text-text-muted">{count}x</span>
                  </div>
                );
              })}
            </>
          ) : (
            <p className="text-xs text-text-muted px-2 py-1">{t('context.noToolsUsedYet')}</p>
          )}
        </div>
      )}
    </div>
  );
}

// Group consecutive steps with the same tool name
interface StepGroup {
  id: string;
  toolName: string | undefined;
  displayName: string;
  steps: TraceStep[];
  status: TraceStepStatus;
  hasError: boolean;
}

function getGroupedSteps(steps: TraceStep[]): StepGroup[] {
  const groups: StepGroup[] = [];
  
  for (const step of steps) {
    const formatToolName = (toolName?: string) => {
      if (!toolName) return undefined;
      const match = toolName.match(/^mcp__(.+?)__(.+)$/);
      if (match) {
        return `${match[1]}: ${match[2]}`;
      }
      return toolName;
    };
    
    const displayName = formatToolName(step.toolName) || step.title;
    const lastGroup = groups[groups.length - 1];
    
    // Check if we can merge with the last group
    if (lastGroup && 
        lastGroup.toolName === step.toolName && 
        lastGroup.displayName === displayName &&
        step.type === 'tool_call') {
      // Merge into existing group
      lastGroup.steps.push(step);
      // Update status to the latest step's status
      lastGroup.status = step.status;
      if (step.status === 'error') {
        lastGroup.hasError = true;
      }
    } else {
      // Create new group
      groups.push({
        id: step.id,
        toolName: step.toolName,
        displayName,
        steps: [step],
        status: step.status,
        hasError: step.status === 'error',
      });
    }
  }
  
  return groups;
}

function TraceStepGroupItem({ group }: { group: StepGroup }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const count = group.steps.length;

  const getIcon = () => {
    if (group.status === 'running') {
      return <Loader2 className="w-4 h-4 text-accent animate-spin" />;
    }
    if (group.hasError) {
      return <AlertCircle className="w-4 h-4 text-error" />;
    }
    if (group.status === 'completed') {
      return <Check className="w-4 h-4 text-success" />;
    }
    return <div className="w-4 h-4 rounded-full border-2 border-border" />;
  };

  const getBgColor = () => {
    if (group.status === 'running') return 'bg-accent/10 border-accent/30';
    if (group.hasError) return 'bg-error/10 border-error/30';
    if (group.status === 'completed') return 'bg-success/10 border-success/30';
    return 'bg-surface-muted border-border';
  };

  const hasDetails = group.steps.some(s => s.toolInput || s.toolOutput);

  return (
    <div className={`rounded-lg border ${getBgColor()} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left"
      >
        {getIcon()}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">
            {group.displayName}
            {count > 1 && (
              <span className="ml-2 text-xs text-text-muted">×{count}</span>
            )}
          </p>
        </div>
        {hasDetails && (
          <ChevronDown className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
        )}
      </button>

      {expanded && hasDetails && (
        <div className="px-3 pb-3 space-y-3">
          {group.steps.map((step, index) => (
            <div key={step.id} className="space-y-2">
              {count > 1 && (
                <p className="text-xs font-medium text-text-muted">{t('context.callNumber', { number: index + 1 })}</p>
              )}
          {step.toolInput && (
            <div>
                  <p className="text-xs font-medium text-text-muted mb-1">{t('context.input')}</p>
              <pre className="text-xs bg-surface p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
                {JSON.stringify(step.toolInput, null, 2)}
              </pre>
            </div>
          )}
          {step.toolOutput && (
            <div>
                  <p className="text-xs font-medium text-text-muted mb-1">{t('context.output')}</p>
              <pre className="text-xs bg-surface p-2 rounded overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                {step.toolOutput}
              </pre>
            </div>
          )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getUniqueNonMCPTools(steps: TraceStep[]): string[] {
  const tools = new Set<string>();
  steps.forEach(step => {
    // Only include non-MCP tools (MCP tools start with mcp__)
    if (step.toolName && !step.toolName.startsWith('mcp__')) {
      tools.add(step.toolName);
    }
  });
  return Array.from(tools);
}

function parseArtifactOutput(toolOutput?: string): { path?: string; name?: string; type?: string } | null {
  if (!toolOutput) {
    return null;
  }
  try {
    const parsed = JSON.parse(toolOutput);
    if (parsed && typeof parsed === 'object') {
      return parsed as { path?: string; name?: string; type?: string };
    }
  } catch {
    return null;
  }
  return null;
}


// Format long paths to show abbreviated version
function formatPath(path: string): string {
  if (!path) return '';
  
  // Windows: Replace C:\Users\username with ~
  const winHome = /^[A-Z]:\\Users\\[^\\]+/i;
  const winMatch = path.match(winHome);
  if (winMatch) {
    return '~' + path.slice(winMatch[0].length).replace(/\\/g, '/');
  }
  
  // macOS/Linux: Replace /Users/username or /home/username with ~
  const unixHome = /^\/(?:Users|home)\/[^/]+/;
  const unixMatch = path.match(unixHome);
  if (unixMatch) {
    return '~' + path.slice(unixMatch[0].length);
  }
  
  return path;
}

function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'read_file':
      return <Eye className="w-4 h-4 text-blue-500" />;
    case 'write_file':
      return <Edit className="w-4 h-4 text-green-500" />;
    case 'edit_file':
      return <Edit className="w-4 h-4 text-orange-500" />;
    case 'list_directory':
      return <FolderOpen className="w-4 h-4 text-yellow-500" />;
    case 'execute_command':
      return <Terminal className="w-4 h-4 text-purple-500" />;
    case 'glob':
      return <Search className="w-4 h-4 text-orange-500" />;
    case 'grep':
      return <Search className="w-4 h-4 text-orange-500" />;
    case 'search_files':
      return <Search className="w-4 h-4 text-orange-500" />;
    case 'WebFetch':
    case 'webFetch':
    case 'WebSearch':
    case 'webSearch':
      return <Globe className="w-4 h-4 text-blue-500" />;
    default:
      return <File className="w-4 h-4 text-text-muted" />;
  }
}
