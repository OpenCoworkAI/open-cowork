import { useState, useEffect, useRef } from 'react';
import { X, Key, Plug, Settings, ChevronRight, Check, AlertCircle, Eye, EyeOff, Plus, Trash2, Edit3, Save, Mail, Globe, Lock, Server, Cpu, Loader2, Power, PowerOff, CheckCircle, ChevronDown } from 'lucide-react';
import type { AppConfig, ProviderPresets } from '../types';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

// ==================== Types ====================

interface UserCredential {
  id: string;
  name: string;
  type: 'email' | 'website' | 'api' | 'other';
  service?: string;
  username: string;
  password?: string;
  url?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface MCPServerConfig {
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

interface MCPServerStatus {
  id: string;
  name: string;
  connected: boolean;
  toolCount: number;
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'api' | 'credentials' | 'connectors';
}

type TabId = 'api' | 'credentials' | 'connectors';

const SERVICE_OPTIONS = [
  { value: 'gmail', label: 'Gmail' },
  { value: 'outlook', label: 'Outlook / Hotmail' },
  { value: 'yahoo', label: 'Yahoo Mail' },
  { value: 'netease', label: 'NetEase Mail (163/126)' },
  { value: 'qq', label: 'QQ Mail' },
  { value: 'icloud', label: 'iCloud Mail' },
  { value: 'proton', label: 'ProtonMail' },
  { value: 'github', label: 'GitHub' },
  { value: 'gitlab', label: 'GitLab' },
  { value: 'aws', label: 'AWS' },
  { value: 'azure', label: 'Azure' },
  { value: 'other', label: 'Other' },
];

// ==================== Main Component ====================

export function SettingsPanel({ isOpen, onClose, initialTab = 'api' }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  // Track which tabs have been viewed at least once (for lazy loading)
  const [viewedTabs, setViewedTabs] = useState<Set<TabId>>(new Set([initialTab]));

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setViewedTabs(new Set([initialTab]));
    }
  }, [isOpen, initialTab]);

  // Mark tab as viewed when it becomes active
  useEffect(() => {
    if (!viewedTabs.has(activeTab)) {
      setViewedTabs(prev => new Set([...prev, activeTab]));
    }
  }, [activeTab, viewedTabs]);

  if (!isOpen) return null;

  const tabs = [
    { id: 'api' as TabId, label: 'API Settings', icon: Settings, description: 'Configure API provider and key' },
    { id: 'credentials' as TabId, label: 'Saved Credentials', icon: Key, description: 'Manage login credentials' },
    { id: 'connectors' as TabId, label: 'MCP Connectors', icon: Plug, description: 'Browser & tool integrations' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-4xl mx-4 max-h-[85vh] overflow-hidden border border-border flex">
        {/* Sidebar */}
        <div className="w-56 bg-surface-hover border-r border-border flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-border">
            <h2 className="text-lg font-semibold text-text-primary">Settings</h2>
          </div>
          <div className="flex-1 p-2 space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors active:scale-[0.98] ${
                  activeTab === tab.id
                    ? 'bg-accent/10 text-accent'
                    : 'hover:bg-surface-active text-text-secondary hover:text-text-primary'
                }`}
              >
                <tab.icon className="w-5 h-5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{tab.label}</p>
                  <p className="text-xs text-text-muted truncate">{tab.description}</p>
                </div>
                {activeTab === tab.id && <ChevronRight className="w-4 h-4 flex-shrink-0" />}
              </button>
            ))}
          </div>
          <div className="p-4 border-t border-border">
            <button
              onClick={onClose}
              className="w-full py-2 px-4 rounded-lg bg-surface hover:bg-surface-active transition-colors text-text-secondary text-sm"
            >
              Close
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
            <h3 className="text-lg font-semibold text-text-primary">
              {tabs.find(t => t.id === activeTab)?.label}
            </h3>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-surface-hover transition-colors"
            >
              <X className="w-5 h-5 text-text-secondary" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {/* Lazy load tabs - only mount when first viewed, then keep mounted */}
            <div className={activeTab === 'api' ? '' : 'hidden'}>
              {viewedTabs.has('api') && <APISettingsTab />}
            </div>
            <div className={activeTab === 'credentials' ? '' : 'hidden'}>
              {viewedTabs.has('credentials') && <CredentialsTab />}
            </div>
            <div className={activeTab === 'connectors' ? '' : 'hidden'}>
              {viewedTabs.has('connectors') && <ConnectorsTab />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== API Settings Tab (Full version from ConfigModal) ====================

function APISettingsTab() {
  const [provider, setProvider] = useState<'openrouter' | 'anthropic' | 'custom' | 'openai'>('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [customProtocol, setCustomProtocol] = useState<'anthropic' | 'openai'>('anthropic');
  const [model, setModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [presets, setPresets] = useState<ProviderPresets | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const previousProviderRef = useRef(provider);
  const isLoadingConfigRef = useRef(false);

  useEffect(() => {
    if (isElectron) {
      loadConfig();
    } else {
      setIsLoadingConfig(false);
    }
  }, []);

  // Handle provider change synchronously for immediate feedback
  const handleProviderChange = (newProvider: typeof provider) => {
    if (newProvider === provider || !presets) return;
    
    const preset = presets[newProvider];
    if (preset) {
      // Batch state updates
      setProvider(newProvider);
      if (newProvider !== 'custom') {
        setBaseUrl(preset.baseUrl);
      } else if (previousProviderRef.current !== 'custom') {
        setBaseUrl(preset.baseUrl);
      }
      setUseCustomModel(false);
      setModel(preset.models[0]?.id || '');
    } else {
      setProvider(newProvider);
    }
    previousProviderRef.current = newProvider;
  };

  async function loadConfig() {
    isLoadingConfigRef.current = true;
    setIsLoadingConfig(true);
    try {
      const [cfg, prs] = await Promise.all([
        window.electronAPI.config.get(),
        window.electronAPI.config.getPresets(),
      ]);
      setPresets(prs);
      
      if (cfg) {
        const newProvider = cfg.provider || 'openrouter';
        setProvider(newProvider);
        previousProviderRef.current = newProvider;
        setApiKey(cfg.apiKey || '');
        const preset = prs?.[cfg.provider];
        setBaseUrl(cfg.baseUrl || preset?.baseUrl || '');
        setCustomProtocol(cfg.customProtocol || 'anthropic');
        
        const isPresetModel = preset?.models.some((m: any) => m.id === cfg.model);
        
        if (isPresetModel) {
          setModel(cfg.model || '');
          setUseCustomModel(false);
        } else if (cfg.model) {
          setUseCustomModel(true);
          setCustomModel(cfg.model);
        }
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    } finally {
      isLoadingConfigRef.current = false;
      setIsLoadingConfig(false);
    }
  }

  async function handleSave() {
    if (!apiKey.trim()) {
      setError('Please enter API Key');
      return;
    }

    const finalModel = useCustomModel ? customModel.trim() : model;
    if (!finalModel) {
      setError('Please select or enter a model name');
      return;
    }

    setError('');
    setIsSaving(true);

    try {
      const presetBaseUrl = presets?.[provider]?.baseUrl;
      const resolvedBaseUrl = provider === 'custom'
        ? baseUrl.trim()
        : (presetBaseUrl || baseUrl).trim();
      const resolvedOpenaiMode =
        provider === 'openai' || (provider === 'custom' && customProtocol === 'openai')
          ? 'responses'
          : undefined;

      await window.electronAPI.config.save({
        provider,
        apiKey: apiKey.trim(),
        baseUrl: resolvedBaseUrl || undefined,
        customProtocol,
        model: finalModel,
        openaiMode: resolvedOpenaiMode,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  }

  const currentPreset = presets?.[provider];

  if (isLoadingConfig) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
        <span className="ml-2 text-text-secondary">Loading settings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Provider Selection */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Server className="w-4 h-4" />
          API Provider
        </label>
        <div className="grid grid-cols-3 gap-2">
          {(['openrouter', 'anthropic', 'openai', 'custom'] as const).map((p) => (
            <button
              key={p}
              onClick={() => handleProviderChange(p)}
              disabled={isLoadingConfig}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors active:scale-95 ${
                provider === p
                  ? 'bg-accent text-white'
                  : 'bg-surface-hover text-text-secondary hover:bg-surface-active disabled:opacity-50'
              }`}
            >
              {presets?.[p]?.name || p}
            </button>
          ))}
        </div>
      </div>

      {/* API Key */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Key className="w-4 h-4" />
          API Key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={currentPreset?.keyPlaceholder || 'Enter your API Key'}
          className="w-full px-4 py-3 rounded-xl bg-background border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
        />
        {currentPreset?.keyHint && (
          <p className="text-xs text-text-muted">{currentPreset.keyHint}</p>
        )}
      </div>

      {/* Custom Protocol */}
      {provider === 'custom' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Server className="w-4 h-4" />
            Protocol
          </label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: 'anthropic', label: 'Anthropic' },
              { id: 'openai', label: 'OpenAI' },
            ] as const).map((mode) => (
              <button
                key={mode.id}
                onClick={() => setCustomProtocol(mode.id)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors active:scale-95 ${
                  customProtocol === mode.id
                    ? 'bg-accent text-white'
                    : 'bg-surface-hover text-text-secondary hover:bg-surface-active'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-muted">Select the compatible protocol for the service</p>
        </div>
      )}

      {/* Base URL - Only for custom provider */}
      {provider === 'custom' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Server className="w-4 h-4" />
            Base URL
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={
              customProtocol === 'openai'
                ? 'https://api.openai.com/v1'
                : (currentPreset?.baseUrl || 'https://api.anthropic.com')
            }
            className="w-full px-4 py-3 rounded-xl bg-background border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
          />
          <p className="text-xs text-text-muted">
            {customProtocol === 'openai'
              ? 'Enter OpenAI-compatible service URL'
              : 'Enter Anthropic-compatible service URL'}
          </p>
        </div>
      )}

      {/* Model Selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Cpu className="w-4 h-4" />
            Model
          </label>
          <button
            type="button"
            onClick={() => setUseCustomModel(!useCustomModel)}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors active:scale-95 ${
              useCustomModel
                ? 'bg-accent-muted text-accent'
                : 'bg-surface-hover text-text-secondary hover:bg-surface-active'
            }`}
          >
            <Edit3 className="w-3 h-3" />
            {useCustomModel ? 'Use Preset' : 'Custom'}
          </button>
        </div>
        {useCustomModel ? (
          <input
            type="text"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder={
              provider === 'openrouter'
                ? 'openai/gpt-4o or other model ID'
                : provider === 'openai' || (provider === 'custom' && customProtocol === 'openai')
                  ? 'gpt-4o'
                  : 'claude-sonnet-4'
            }
            className="w-full px-4 py-3 rounded-xl bg-background border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
          />
        ) : (
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all appearance-none cursor-pointer"
          >
            {currentPreset?.models.map((m: any) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        {useCustomModel && (
          <p className="text-xs text-text-muted">
            Enter model ID, e.g., moonshotai/kimi-k2-0905, openai/gpt-4o
          </p>
        )}
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success/10 text-success text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          Saved successfully!
        </div>
      )}

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={isSaving || !apiKey.trim()}
        className="w-full py-3 px-4 rounded-xl bg-accent text-white font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
      >
        {isSaving ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <CheckCircle className="w-4 h-4" />
            Save Settings
          </>
        )}
      </button>
    </div>
  );
}

// ==================== Credentials Tab ====================

function CredentialsTab() {
  const [credentials, setCredentials] = useState<UserCredential[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingCredential, setEditingCredential] = useState<UserCredential | null>(null);

  useEffect(() => {
    if (isElectron) {
      loadCredentials();
    }
  }, []);

  async function loadCredentials() {
    try {
      const loaded = await window.electronAPI.credentials.getAll();
      setCredentials(loaded || []);
      setError('');
    } catch (err) {
      console.error('Failed to load credentials:', err);
      setError('Failed to load credentials');
    }
  }

  async function handleSave(credential: Omit<UserCredential, 'id' | 'createdAt' | 'updatedAt'>) {
    if (!isElectron) return;
    setIsLoading(true);
    setError('');
    try {
      if (editingCredential) {
        await window.electronAPI.credentials.update(editingCredential.id, credential);
      } else {
        await window.electronAPI.credentials.save(credential);
      }
      await loadCredentials();
      setShowForm(false);
      setEditingCredential(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credential');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this credential?')) return;
    setIsLoading(true);
    try {
      await window.electronAPI.credentials.delete(id);
      await loadCredentials();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete credential');
    } finally {
      setIsLoading(false);
    }
  }

  function getTypeIcon(type: string) {
    switch (type) {
      case 'email': return <Mail className="w-4 h-4" />;
      case 'website': return <Globe className="w-4 h-4" />;
      case 'api': return <Key className="w-4 h-4" />;
      default: return <Lock className="w-4 h-4" />;
    }
  }

  return (
    <div className="space-y-4">
      {/* Info */}
      <div className="px-4 py-3 rounded-xl bg-blue-500/10 text-blue-600 text-sm">
        <p className="font-medium mb-1">🔐 Securely Encrypted</p>
        <p className="text-xs opacity-80">
          Credentials are encrypted locally. The agent can use these to automatically log in to your accounts.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <CredentialForm
          credential={editingCredential || undefined}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingCredential(null); }}
          isLoading={isLoading}
        />
      )}

      {/* List */}
      {!showForm && (
        <div className="space-y-2">
          {credentials.length === 0 ? (
            <div className="text-center py-8 text-text-muted">
              <Key className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p>No saved credentials</p>
              <p className="text-sm mt-1">Add credentials for the agent to use</p>
            </div>
          ) : (
            credentials.map((cred) => (
              <div key={cred.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      cred.type === 'email' ? 'bg-blue-500/10 text-blue-500' :
                      cred.type === 'website' ? 'bg-green-500/10 text-green-500' :
                      cred.type === 'api' ? 'bg-purple-500/10 text-purple-500' :
                      'bg-gray-500/10 text-gray-500'
                    }`}>
                      {getTypeIcon(cred.type)}
                    </div>
                    <div>
                      <h3 className="font-medium text-text-primary">{cred.name}</h3>
                      <p className="text-sm text-text-secondary">{cred.username}</p>
                      {cred.service && (
                        <span className="inline-block mt-1 px-2 py-0.5 text-xs rounded bg-surface-muted text-text-muted">
                          {SERVICE_OPTIONS.find(s => s.value === cred.service)?.label || cred.service}
                        </span>
                      )}
                      {cred.url && (
                        <p className="text-xs text-text-muted mt-1">{cred.url}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setEditingCredential(cred); setShowForm(true); }}
                      disabled={isLoading}
                      className="p-2 rounded-lg bg-surface-muted text-text-secondary hover:bg-surface-active transition-colors"
                      title="Edit"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(cred.id)}
                      disabled={isLoading}
                      className="p-2 rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Add Button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-3 px-4 rounded-xl border-2 border-dashed border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent"
        >
          <Plus className="w-5 h-5" />
          Add Credential
        </button>
      )}
    </div>
  );
}

function CredentialForm({ credential, onSave, onCancel, isLoading }: {
  credential?: UserCredential;
  onSave: (c: any) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState(credential?.name || '');
  const [type, setType] = useState<UserCredential['type']>(credential?.type || 'email');
  const [service, setService] = useState(credential?.service || '');
  const [username, setUsername] = useState(credential?.username || '');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState(credential?.url || '');
  const [notes, setNotes] = useState(credential?.notes || '');
  const [showPassword, setShowPassword] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !username.trim()) {
      alert('Name and username are required');
      return;
    }
    if (!credential && !password.trim()) {
      alert('Password is required for new credentials');
      return;
    }

    onSave({
      name: name.trim(),
      type,
      service: service || undefined,
      username: username.trim(),
      ...(password.trim() ? { password } : {}),
      url: url.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-surface p-4 space-y-4">
      <h3 className="font-medium text-text-primary">
        {credential ? 'Edit Credential' : 'Add New Credential'}
      </h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Work Gmail"
            className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as any)}
            className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <option value="email">Email</option>
            <option value="website">Website</option>
            <option value="api">API Key</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">Service</label>
        <select
          value={service}
          onChange={(e) => setService(e.target.value)}
          className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
        >
          <option value="">Select a service...</option>
          {SERVICE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">Username / Email *</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="your.email@example.com"
          className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          Password {credential ? '(leave empty to keep current)' : '*'}
        </label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={credential ? '••••••••' : 'Enter password'}
            className="w-full px-4 py-2 pr-10 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
            required={!credential}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">Login URL (optional)</label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://mail.google.com"
          className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any additional notes..."
          rows={2}
          className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 py-2 px-4 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" />
          {isLoading ? 'Saving...' : 'Save'}
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

// ==================== Connectors Tab (Full version from MCPConnectorsModal) ====================

function ConnectorsTab() {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [statuses, setStatuses] = useState<MCPServerStatus[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [presets, setPresets] = useState<Record<string, any>>({});
  const [showPresets, setShowPresets] = useState(false);

  // Auto-refresh
  useEffect(() => {
    if (isElectron) {
      loadAll();
      const interval = setInterval(() => {
        loadTools();
        loadStatuses();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, []);

  async function loadAll() {
    await Promise.all([loadServers(), loadStatuses(), loadTools(), loadPresets()]);
  }

  async function loadPresets() {
    try {
      const loaded = await window.electronAPI.mcp.getPresets();
      setPresets(loaded || {});
    } catch (err) {
      console.error('Failed to load presets:', err);
    }
  }

  async function loadServers() {
    try {
      const loaded = await window.electronAPI.mcp.getServers();
      setServers(loaded || []);
      setError('');
    } catch (err) {
      console.error('Failed to load servers:', err);
      setError('Failed to load servers');
    }
  }

  async function loadStatuses() {
    try {
      const loaded = await window.electronAPI.mcp.getServerStatus();
      setStatuses(loaded || []);
    } catch (err) {
      console.error('Failed to load statuses:', err);
    }
  }

  async function loadTools() {
    try {
      const loaded = await window.electronAPI.mcp.getTools();
      setTools(loaded || []);
    } catch (err) {
      console.error('Failed to load tools:', err);
    }
  }

  async function handleAddPreset(presetKey: string) {
    const preset = presets[presetKey];
    if (!preset) return;

    const existing = servers.find(s => s.name === preset.name && s.command === preset.command);
    if (existing) {
      setError(`Server "${preset.name}" is already configured`);
      return;
    }

    const serverConfig: MCPServerConfig = {
      id: `mcp-${presetKey}-${Date.now()}`,
      name: preset.name,
      type: preset.type,
      command: preset.command,
      args: preset.args,
      env: preset.env,
      enabled: false,
    };

    await handleSaveServer(serverConfig);
    setShowPresets(false);
  }

  async function handleSaveServer(server: MCPServerConfig) {
    setIsLoading(true);
    setError('');
    try {
      await window.electronAPI.mcp.saveServer(server);
      await loadAll();
      setEditingServer(null);
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save server');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteServer(serverId: string) {
    if (!confirm('Delete this connector?')) return;
    setIsLoading(true);
    try {
      await window.electronAPI.mcp.deleteServer(serverId);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete server');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleToggleEnabled(server: MCPServerConfig) {
    await handleSaveServer({ ...server, enabled: !server.enabled });
  }

  function getServerStatus(serverId: string) {
    return statuses.find(s => s.id === serverId);
  }

  function getServerTools(serverId: string) {
    return tools.filter(t => t.serverId === serverId);
  }

  return (
    <div className="space-y-4">
      {/* Info */}
      <div className="px-4 py-3 rounded-xl bg-purple-500/10 text-purple-600 text-sm">
        <p className="font-medium mb-1">🔌 MCP Connectors</p>
        <p className="text-xs opacity-80">
          Connect external tools like Chrome browser for web automation.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Add/Edit Form */}
      {(showAddForm || editingServer) && (
        <ServerForm
          server={editingServer || undefined}
          onSave={handleSaveServer}
          onCancel={() => { setShowAddForm(false); setEditingServer(null); }}
          isLoading={isLoading}
        />
      )}

      {/* Server List */}
      {!showAddForm && !editingServer && (
        <div className="space-y-3">
          {servers.length === 0 ? (
            <div className="text-center py-8 text-text-muted">
              <Plug className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p>No connectors configured</p>
              <p className="text-sm mt-1">Add a connector to enable MCP tools</p>
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
                  tools={serverTools}
                  onEdit={() => setEditingServer(server)}
                  onDelete={() => handleDeleteServer(server.id)}
                  onToggleEnabled={() => handleToggleEnabled(server)}
                  isLoading={isLoading}
                />
              );
            })
          )}
        </div>
      )}

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
                const isAdded = servers.some(s => s.name === preset.name && s.command === preset.command);
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
                    {isAdded && <div className="text-xs text-success mt-1">Already added</div>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add Custom Button */}
      {!showAddForm && !editingServer && (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full py-3 px-4 rounded-xl border-2 border-dashed border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent"
        >
          <Plus className="w-5 h-5" />
          Add Custom Connector
        </button>
      )}

      {/* Footer info */}
      <div className="text-sm text-text-muted text-center pt-2">
        {tools.length} tool{tools.length !== 1 ? 's' : ''} available
      </div>
    </div>
  );
}

function ServerCard({
  server,
  status,
  toolCount,
  tools,
  onEdit,
  onDelete,
  onToggleEnabled,
  isLoading,
}: {
  server: MCPServerConfig;
  status?: MCPServerStatus;
  toolCount: number;
  tools: any[];
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  isLoading: boolean;
}) {
  const isConnected = status?.connected || false;
  const [showTools, setShowTools] = useState(false);

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
              {/* Chrome hint */}
              {server.name.toLowerCase().includes('chrome') && (
                <div className={`text-xs px-2 py-1.5 rounded-lg ${
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
                  {showTools ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
                {isConnected && (
                  <span className="flex items-center gap-1 text-success">
                    <CheckCircle className="w-3 h-3" />
                    Connected
                  </span>
                )}
              </div>
              
              {/* Tools List */}
              {showTools && tools.length > 0 && (
                <div className="mt-3 p-3 rounded-lg bg-surface-muted border border-border">
                  <div className="text-xs font-medium text-text-primary mb-2">Available Tools:</div>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {tools.map((tool, idx) => (
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
              {showTools && tools.length === 0 && (
                <div className="mt-3 p-3 rounded-lg bg-surface-muted text-xs text-text-muted">
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
      <h3 className="font-medium text-text-primary">
        {server ? 'Edit Connector' : 'Add Custom Connector'}
      </h3>

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
              placeholder="-y chrome-devtools-mcp@latest --browser-url http://localhost:9222"
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
