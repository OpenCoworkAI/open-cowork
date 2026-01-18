import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Power, PowerOff, Plug, CheckCircle, AlertCircle, Loader2, Edit3, ChevronDown, ChevronRight } from 'lucide-react';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

export interface MCPServerConfig {
  id: string;
  name: string;
  type: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface MCPServerStatus {
  id: string;
  name: string;
  connected: boolean;
  toolCount: number;
}

interface MCPConnectorsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MCPConnectorsModal({ isOpen, onClose }: MCPConnectorsModalProps) {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [statuses, setStatuses] = useState<MCPServerStatus[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [presets, setPresets] = useState<Record<string, any>>({});
  const [showPresets, setShowPresets] = useState(false);
  
  // Auto-refresh tools periodically
  useEffect(() => {
    if (isOpen && isElectron) {
      const interval = setInterval(() => {
        loadTools();
        loadStatuses();
      }, 3000); // Refresh every 3 seconds
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && isElectron) {
      // Load with a small delay to ensure IPC is ready
      const timer = setTimeout(() => {
        loadServers();
        loadStatuses();
        loadTools();
        loadPresets();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  async function loadPresets() {
    if (!isElectron) return;
    try {
      const loaded = await window.electronAPI.mcp.getPresets();
      setPresets(loaded || {});
    } catch (err) {
      console.error('Failed to load presets:', err);
    }
  }

  async function handleAddPreset(presetKey: string) {
    if (!isElectron) return;
    const preset = presets[presetKey];
    if (!preset) return;

    // Check if this preset is already added
    const existing = servers.find(s => 
      s.name === preset.name && 
      s.type === preset.type &&
      s.command === preset.command
    );

    if (existing) {
      setError(`Server "${preset.name}" is already configured`);
      return;
    }

    // Create server config from preset
    const serverConfig: MCPServerConfig = {
      id: `mcp-${presetKey}-${Date.now()}`,
      name: preset.name,
      type: preset.type,
      command: preset.command,
      args: preset.args,
      env: preset.env,
      enabled: false, // Add disabled by default, user can enable it
    };

    await handleSaveServer(serverConfig);
    setShowPresets(false);
  }

  async function loadServers() {
    if (!isElectron) return;
    try {
      const loaded = await window.electronAPI.mcp.getServers();
      setServers(loaded || []);
      setError(''); // Clear any previous errors
    } catch (err) {
      console.error('Failed to load MCP servers:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load servers';
      setError(`Failed to load servers: ${errorMessage}`);
    }
  }

  async function loadStatuses() {
    if (!isElectron) return;
    try {
      const statuses = await window.electronAPI.mcp.getServerStatus();
      setStatuses(statuses || []);
    } catch (err) {
      console.error('Failed to load server statuses:', err);
    }
  }

  async function loadTools() {
    if (!isElectron) return;
    try {
      const tools = await window.electronAPI.mcp.getTools();
      setTools(tools || []);
    } catch (err) {
      console.error('Failed to load tools:', err);
    }
  }

  async function handleSaveServer(server: MCPServerConfig) {
    if (!isElectron) return;
    setIsLoading(true);
    setError('');
    try {
      await window.electronAPI.mcp.saveServer(server);
      await loadServers();
      await loadStatuses();
      await loadTools();
      setEditingServer(null);
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save server');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteServer(serverId: string) {
    if (!isElectron) return;
    if (!confirm('Are you sure you want to delete this connector?')) return;
    
    setIsLoading(true);
    setError('');
    try {
      await window.electronAPI.mcp.deleteServer(serverId);
      await loadServers();
      await loadStatuses();
      await loadTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete server');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleToggleEnabled(server: MCPServerConfig) {
    if (!isElectron) return;
    const updated = { ...server, enabled: !server.enabled };
    await handleSaveServer(updated);
  }

  function getServerStatus(serverId: string): MCPServerStatus | undefined {
    return statuses.find(s => s.id === serverId);
  }

  function getServerTools(serverId: string) {
    return tools.filter(t => t.serverId === serverId);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden border border-border flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <Plug className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">MCP Connectors</h2>
              <p className="text-sm text-text-secondary">Manage Model Context Protocol servers</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-error/10 text-error text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Add/Edit Form */}
          {(showAddForm || editingServer) && (
            <ServerForm
              server={editingServer || undefined}
              onSave={handleSaveServer}
              onCancel={() => {
                setShowAddForm(false);
                setEditingServer(null);
              }}
              isLoading={isLoading}
            />
          )}

          {/* Server List */}
          <div className="space-y-3">
            {servers.length === 0 ? (
              <div className="text-center py-12 text-text-muted">
                <Plug className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No connectors configured</p>
                <p className="text-sm mt-2">Add a connector to enable MCP tools</p>
              </div>
            ) : (
              servers.map((server) => {
                const status = getServerStatus(server.id);
                const serverTools = getServerTools(server.id);
                
                return (
                  <ServerCard
                    key={server.id}
                    server={server}
                    status={status}
                    toolCount={serverTools.length}
                    onEdit={() => setEditingServer(server)}
                    onDelete={() => handleDeleteServer(server.id)}
                    onToggleEnabled={() => handleToggleEnabled(server)}
                    isLoading={isLoading}
                    tools={tools}
                  />
                );
              })
            )}
          </div>

          {/* Preset Servers */}
          {!showAddForm && !editingServer && Object.keys(presets).length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-text-primary">Quick Add Presets</h3>
                <button
                  onClick={() => setShowPresets(!showPresets)}
                  className="text-xs text-text-muted hover:text-accent transition-colors"
                >
                  {showPresets ? 'Hide' : 'Show'} Presets
                </button>
              </div>
              {showPresets && (
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(presets).map(([key, preset]) => {
                    const isAdded = servers.some(s => 
                      s.name === preset.name && 
                      s.type === preset.type &&
                      s.command === preset.command
                    );
                    return (
                      <button
                        key={key}
                        onClick={() => handleAddPreset(key)}
                        disabled={isAdded || isLoading}
                        className={`p-3 rounded-lg border text-left transition-all ${
                          isAdded
                            ? 'border-border bg-surface-muted opacity-50 cursor-not-allowed'
                            : 'border-border hover:border-accent hover:bg-accent/5'
                        }`}
                      >
                        <div className="font-medium text-sm text-text-primary">{preset.name}</div>
                        <div className="text-xs text-text-muted mt-1">
                          {preset.type === 'stdio' 
                            ? `${preset.command} ${preset.args?.join(' ') || ''}`
                            : preset.url || 'Remote server'
                          }
                        </div>
                        {isAdded && (
                          <div className="text-xs text-success mt-1">Already added</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Add Button */}
          {!showAddForm && !editingServer && (
            <div className="space-y-2">
              <button
                onClick={() => setShowAddForm(true)}
                className="w-full py-3 px-4 rounded-xl border-2 border-dashed border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent"
              >
                <Plus className="w-5 h-5" />
                Add Custom Connector
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-surface-hover border-t border-border">
          <div className="flex items-center justify-between text-sm text-text-muted">
            <span>
              {tools.length} tool{tools.length !== 1 ? 's' : ''} available
            </span>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-surface hover:bg-surface-active transition-colors text-text-primary"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ServerCard({
  server,
  status,
  toolCount,
  onEdit,
  onDelete,
  onToggleEnabled,
  isLoading,
  tools,
}: {
  server: MCPServerConfig;
  status?: MCPServerStatus;
  toolCount: number;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  isLoading: boolean;
  tools?: any[];
}) {
  const isConnected = status?.connected || false;
  const [showTools, setShowTools] = useState(false);
  const serverTools = tools?.filter(t => t.serverId === server.id) || [];

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-success' : 'bg-text-muted'}`} />
              <h3 className="font-medium text-text-primary">{server.name}</h3>
              <span className="px-2 py-0.5 text-xs rounded bg-surface-muted text-text-muted">
                {server.type.toUpperCase()}
              </span>
            </div>
            <div className="text-sm text-text-muted space-y-1 ml-6">
              {server.type === 'stdio' && (
                <div className="font-mono text-xs">
                  {server.command} {server.args?.join(' ') || ''}
                </div>
              )}
              {server.type === 'sse' && (
                <div className="font-mono text-xs">{server.url}</div>
              )}
              {/* Connection status message for Chrome */}
              {server.name.toLowerCase().includes('chrome') && (
                <div className={`text-xs px-2 py-1.5 rounded-lg mb-2 ${
                  isConnected 
                    ? 'bg-success/10 text-success' 
                    : server.enabled
                      ? 'bg-amber-500/10 text-amber-600'
                      : 'bg-blue-500/10 text-blue-600'
                }`}>
                  {isConnected 
                    ? '✓ Connected to Chrome debug port (9222)' 
                    : server.enabled
                      ? '⏳ Connecting...'
                      : '💡 A new Chrome debug window will open automatically if port is unavailable'
                  }
                </div>
              )}
              <div className="flex items-center gap-4 mt-2">
                <button
                  onClick={() => setShowTools(!showTools)}
                  className="flex items-center gap-1 hover:text-accent transition-colors"
                >
                  <Plug className="w-3 h-3" />
                  <span>{toolCount} tool{toolCount !== 1 ? 's' : ''}</span>
                  {showTools ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                </button>
                {isConnected && (
                  <span className="flex items-center gap-1 text-success">
                    <CheckCircle className="w-3 h-3" />
                    Connected
                  </span>
                )}
              </div>
              
              {/* Tools List */}
              {showTools && serverTools.length > 0 && (
                <div className="mt-3 ml-6 p-3 rounded-lg bg-surface-muted border border-border">
                  <div className="text-xs font-medium text-text-primary mb-2">Available Tools:</div>
                  <div className="grid grid-cols-2 gap-2">
                    {serverTools.map((tool, idx) => (
                      <div
                        key={idx}
                        className="px-2 py-1 rounded bg-background border border-border text-xs text-text-secondary"
                        title={tool.description || tool.name}
                      >
                        <div className="font-mono text-accent">{tool.name.replace(/^mcp_[^_]+_/, '')}</div>
                        {tool.description && (
                          <div className="text-text-muted mt-0.5 truncate">{tool.description}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {showTools && serverTools.length === 0 && (
                <div className="mt-3 ml-6 p-3 rounded-lg bg-surface-muted text-xs text-text-muted">
                  No tools available. Make sure the server is connected.
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleEnabled}
              disabled={isLoading}
              className={`p-2 rounded-lg transition-colors ${
                server.enabled
                  ? 'bg-success/10 text-success hover:bg-success/20'
                  : 'bg-surface-muted text-text-muted hover:bg-surface-active'
              }`}
              title={server.enabled ? 'Disable' : 'Enable'}
            >
              {server.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
            </button>
            <button
              onClick={onEdit}
              disabled={isLoading}
              className="p-2 rounded-lg bg-surface-muted text-text-secondary hover:bg-surface-active transition-colors"
              title="Edit"
            >
              <Edit3 className="w-4 h-4" />
            </button>
            <button
              onClick={onDelete}
              disabled={isLoading}
              className="p-2 rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ServerForm({
  server,
  onSave,
  onCancel,
  isLoading,
}: {
  server?: MCPServerConfig;
  onSave: (server: MCPServerConfig) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState(server?.name || '');
  const [type, setType] = useState<'stdio' | 'sse'>(server?.type || 'stdio');
  const [command, setCommand] = useState(server?.command || '');
  const [args, setArgs] = useState(server?.args?.join(' ') || '');
  const [url, setUrl] = useState(server?.url || '');
  const [enabled, setEnabled] = useState(server?.enabled ?? true);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    const config: MCPServerConfig = {
      id: server?.id || `mcp-${Date.now()}`,
      name: name.trim(),
      type,
      enabled,
    };

    if (type === 'stdio') {
      if (!command.trim()) {
        alert('Command is required for STDIO servers');
        return;
      }
      config.command = command.trim();
      config.args = args.trim() ? args.trim().split(/\s+/) : [];
    } else {
      if (!url.trim()) {
        alert('URL is required for SSE servers');
        return;
      }
      config.url = url.trim();
    }

    onSave(config);
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-surface p-4 space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Chrome MCP Server"
          className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">Type</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setType('stdio')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              type === 'stdio'
                ? 'bg-accent text-white'
                : 'bg-surface-muted text-text-secondary hover:bg-surface-active'
            }`}
          >
            STDIO (Local)
          </button>
          <button
            type="button"
            onClick={() => setType('sse')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              type === 'sse'
                ? 'bg-accent text-white'
                : 'bg-surface-muted text-text-secondary hover:bg-surface-active'
            }`}
          >
            SSE (Remote)
          </button>
        </div>
      </div>

      {type === 'stdio' ? (
        <>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Command</label>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx"
              className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 font-mono text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Arguments</label>
            <input
              type="text"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="-y @modelcontextprotocol/server-chrome"
              className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 font-mono text-sm"
            />
            <p className="text-xs text-text-muted mt-1">Space-separated arguments</p>
          </div>
        </>
      ) : (
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/mcp"
            className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 font-mono text-sm"
            required
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="w-4 h-4 rounded border-border text-accent focus:ring-accent"
        />
        <label htmlFor="enabled" className="text-sm text-text-primary">
          Enable this connector
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 py-2 px-4 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save'
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading}
          className="px-4 py-2 rounded-lg bg-surface-muted text-text-secondary hover:bg-surface-active transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
