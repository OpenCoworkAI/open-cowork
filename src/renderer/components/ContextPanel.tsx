import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { resolveArtifactPath } from '../utils/artifact-path';
import { extractFilePathFromToolInput, extractFilePathFromToolOutput } from '../utils/tool-output-path';
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
  File,
  Check,
  Loader2,
  Plug,
  Wrench,
  MessageSquare,
  Cpu,
  Copy,
} from 'lucide-react';
import type { TraceStep, MCPServerInfo } from '../types';

export function ContextPanel() {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const traceStepsBySession = useAppStore((s) => s.traceStepsBySession);
  const messagesBySession = useAppStore((s) => s.messagesBySession);
  const appConfig = useAppStore((s) => s.appConfig);
  const contextPanelCollapsed = useAppStore((s) => s.contextPanelCollapsed);
  const toggleContextPanel = useAppStore((s) => s.toggleContextPanel);
  const workingDir = useAppStore((s) => s.workingDir);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const { getMCPServers, changeWorkingDir } = useIPC();
  const [artifactsOpen, setArtifactsOpen] = useState(true);
  const [expandedConnector, setExpandedConnector] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<MCPServerInfo[]>([]);
  const [copiedPath, setCopiedPath] = useState(false);
  const [isChangingDir, setIsChangingDir] = useState(false);
  const [recentWorkspaceFiles, setRecentWorkspaceFiles] = useState<Array<{
    path: string;
    modifiedAt: number;
    size: number;
  }>>([]);

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
  const activeSession = activeSessionId ? sessions.find(s => s.id === activeSessionId) : null;
  const currentWorkingDir = activeSession?.cwd || workingDir;
  const { displayArtifactSteps } = getArtifactSteps(steps);
  const canShowItemInFolder = typeof window !== 'undefined' && !!window.electronAPI?.showItemInFolder;

  // Session info computations
  const messages = useMemo(
    () => (activeSessionId ? messagesBySession[activeSessionId] || [] : []),
    [activeSessionId, messagesBySession]
  );
  const messageCount = messages.length;
  const toolCallCount = steps.filter((s) => s.type === 'tool_call').length;
  const modelName = activeSession?.model || appConfig?.model || '—';

  // Token usage aggregation
  const tokenUsage = useMemo(() => {
    let input = 0;
    let output = 0;
    for (const msg of messages) {
      if (msg.tokenUsage) {
        input += msg.tokenUsage.input || 0;
        output += msg.tokenUsage.output || 0;
      }
    }
    return { input, output, total: input + output };
  }, [messages]);

  useEffect(() => {
    if (
      typeof window === 'undefined'
      || !window.electronAPI?.artifacts?.listRecentFiles
      || !currentWorkingDir
      || !activeSession?.createdAt
    ) {
      setRecentWorkspaceFiles([]);
      return;
    }

    let cancelled = false;
    const loadRecentWorkspaceFiles = async () => {
      try {
        const files = await window.electronAPI.artifacts.listRecentFiles(
          currentWorkingDir,
          activeSession.createdAt,
          50
        );
        if (!cancelled) {
          setRecentWorkspaceFiles(files || []);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load recent workspace files:', error);
          setRecentWorkspaceFiles([]);
        }
      }
    };

    void loadRecentWorkspaceFiles();
    return () => {
      cancelled = true;
    };
  }, [activeSession?.createdAt, activeSessionId, currentWorkingDir, steps.length]);

  const displayArtifacts = useMemo(() => {
    const seenPaths = new Set<string>();
    const items: Array<{ label: string; path: string }> = [];

    for (const step of displayArtifactSteps) {
      const fallbackPath = extractFilePathFromToolOutput(step.toolOutput)
        || extractFilePathFromToolInput(step.toolInput);
      if (!fallbackPath) {
        continue;
      }

      const resolvedPath = resolveArtifactPath(fallbackPath, currentWorkingDir);
      const key = resolvedPath.trim();
      if (!key || seenPaths.has(key)) {
        continue;
      }

      seenPaths.add(key);
      items.push({
        label: getArtifactLabel(fallbackPath),
        path: resolvedPath,
      });
    }

    for (const file of recentWorkspaceFiles) {
      const resolvedPath = resolveArtifactPath(file.path, currentWorkingDir);
      const key = resolvedPath.trim();
      if (!key || seenPaths.has(key)) {
        continue;
      }

      seenPaths.add(key);
      items.push({
        label: getArtifactLabel(file.path),
        path: resolvedPath,
      });
    }

    return items;
  }, [currentWorkingDir, displayArtifactSteps, recentWorkspaceFiles]);

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
    const interval = setInterval(loadMCPServers, 30000);
    return () => clearInterval(interval);
  }, [getMCPServers]);

  if (contextPanelCollapsed) {
    return (
      <div className="w-11 bg-background-secondary/88 border-l border-border-muted flex items-start justify-center py-3">
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
    <div className="w-[18.5rem] bg-background-secondary/88 border-l border-border-muted flex flex-col overflow-hidden">
      <div className="px-3 py-3 border-b border-border-muted flex items-center justify-start">
        <button
          onClick={toggleContextPanel}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          title={t('context.collapsePanel')}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Session Info Card */}
      {activeSession && (
        <div className="px-4 py-4 border-b border-border-muted">
          <div className="rounded-2xl border border-border-subtle bg-background/50 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-accent flex-shrink-0" />
            <span className="text-sm font-medium text-text-primary truncate">{modelName}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <MessageSquare className="w-3 h-3" />
              {messageCount}
            </span>
            <span className="flex items-center gap-1">
              <Wrench className="w-3 h-3" />
              {toolCallCount}
            </span>
          </div>
          </div>
        </div>
      )}

      {/* Token Usage */}
      {tokenUsage.total > 0 && (
        <div className="px-4 pb-4 border-b border-border-muted">
          <div className="rounded-2xl border border-border-subtle bg-background/50 px-4 py-2.5 flex items-center justify-between text-xs text-text-muted">
            <span>{t('context.inputTokens')}: {formatTokenCount(tokenUsage.input)}</span>
            <span>{t('context.outputTokens')}: {formatTokenCount(tokenUsage.output)}</span>
          </div>
        </div>
      )}

      {/* Artifacts Section */}
      <div className="border-b border-border-muted">
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
          <div className="px-4 pb-4 max-h-80 overflow-y-auto">
            {/* Extract artifacts from trace steps */}
            {displayArtifacts.length === 0 ? (
              <p className="text-xs text-text-muted">{t('context.noArtifactsYet')}</p>
            ) : (
              <div className="space-y-1">
                {displayArtifacts.map((artifact, index) => {
                  const label = artifact.label || t('context.fileCreated');
                  const artifactPath = artifact.path;
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
                      onClick={async () => {
                        if (!canClick) return;
                        const revealed = await window.electronAPI.showItemInFolder(artifactPath, currentWorkingDir ?? undefined);
                        if (!revealed) {
                          setGlobalNotice({
                            id: `artifact-reveal-failed-${Date.now()}`,
                            type: 'warning',
                            message: t('context.revealFailed'),
                          });
                        }
                      }}
                      title={canClick ? artifactPath : undefined}
                    >
                      <IconComponent className="w-4 h-4 text-text-muted" />
                      <span className="text-sm text-text-primary truncate">
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Working Directory */}
      <div className="px-4 py-4 border-b border-border-muted">
        <div className="rounded-2xl border border-border-subtle bg-background/50 px-4 py-3 flex items-center gap-2 min-w-0">
          <FolderOpen className="w-3.5 h-3.5 text-accent flex-shrink-0" />
          <span className="text-sm text-text-primary truncate flex-1" title={currentWorkingDir || ''}>
            {currentWorkingDir ? formatPath(currentWorkingDir) : t('context.noFolderSelected')}
          </span>
          {currentWorkingDir && (
            <button
              onClick={() => handleCopyPath(currentWorkingDir)}
              className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
              title={t('context.copyPath')}
            >
              {copiedPath ? (
                <Check className="w-3.5 h-3.5 text-success" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}
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
            className="text-text-muted hover:text-text-primary disabled:opacity-50 transition-colors flex-shrink-0"
            title={t('context.changeDir')}
          >
            {isChangingDir ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FolderSync className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* MCP Connectors */}
      {mcpServers.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-4 space-y-2">
            <p className="text-xs text-text-muted mb-2">{t('context.mcpConnectors')}</p>
            {mcpServers.map((server) => (
              <ConnectorItem
                key={server.id}
                server={server}
                steps={steps}
                expanded={expandedConnector === server.id}
                onToggle={() =>
                  setExpandedConnector(expandedConnector === server.id ? null : server.id)
                }
              />
            ))}
          </div>
        </div>
      )}
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
            ? 'bg-mcp/10 hover:bg-mcp/20' 
            : 'bg-surface-muted hover:bg-surface-hover'
        }`}
      >
        <div className={`w-6 h-6 rounded flex items-center justify-center ${
          server.connected ? 'bg-mcp/20' : 'bg-surface-muted'
        }`}>
          <Plug className={`w-3.5 h-3.5 ${server.connected ? 'text-mcp' : 'text-text-muted'}`} />
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
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-mcp/5 hover:bg-mcp/10 transition-colors"
                  >
                    <Wrench className="w-3.5 h-3.5 text-mcp" />
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

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
