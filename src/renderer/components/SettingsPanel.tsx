import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Key, Plug, Settings, ChevronRight, AlertCircle, Eye, EyeOff, Plus, Trash2, Edit3, Save, Mail, Globe, Lock, Server, Cpu, Loader2, Power, PowerOff, CheckCircle, ChevronDown, Package, Languages, Shield, Wifi } from 'lucide-react';
import type { ProviderPresets, Skill, ApiTestResult } from '../types';
import { RemoteControlPanel } from './RemoteControlPanel';

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
  initialTab?: 'api' | 'sandbox' | 'credentials' | 'connectors' | 'skills' | 'remote' | 'logs' | 'language';
}

type TabId = 'api' | 'sandbox' | 'credentials' | 'connectors' | 'skills' | 'remote' | 'logs' | 'language';

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
  const { t } = useTranslation();
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
    { id: 'api' as TabId, label: t('settings.apiSettings'), icon: Settings, description: t('settings.apiSettingsDesc') },
    { id: 'sandbox' as TabId, label: t('settings.sandbox'), icon: Shield, description: t('settings.sandboxDesc') },
    { id: 'credentials' as TabId, label: t('settings.credentials'), icon: Key, description: t('settings.credentialsDesc') },
    { id: 'connectors' as TabId, label: t('settings.connectors'), icon: Plug, description: t('settings.connectorsDesc') },
    { id: 'skills' as TabId, label: t('settings.skills'), icon: Package, description: t('settings.skillsDesc') },
    { id: 'remote' as TabId, label: t('settings.remote', '远程控制'), icon: Wifi, description: t('settings.remoteDesc', '通过飞书等平台远程使用') },
    { id: 'logs' as TabId, label: t('settings.logs'), icon: AlertCircle, description: t('settings.logsDesc') },
    { id: 'language' as TabId, label: t('settings.language'), icon: Languages, description: t('settings.languageDesc') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-4xl mx-4 max-h-[85vh] overflow-hidden border border-border flex">
        {/* Sidebar */}
        <div className="w-72 bg-surface-hover border-r border-border flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-border">
            <h2 className="text-lg font-semibold text-text-primary">{t('settings.title')}</h2>
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
              {t('common.close')}
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
            <div className={activeTab === 'sandbox' ? '' : 'hidden'}>
              {viewedTabs.has('sandbox') && <SandboxTab />}
            </div>
            <div className={activeTab === 'credentials' ? '' : 'hidden'}>
              {viewedTabs.has('credentials') && <CredentialsTab />}
            </div>
            <div className={activeTab === 'connectors' ? '' : 'hidden'}>
              {viewedTabs.has('connectors') && <ConnectorsTab />}
            </div>
            <div className={activeTab === 'skills' ? '' : 'hidden'}>
              {viewedTabs.has('skills') && <SkillsTab />}
            </div>
            <div className={activeTab === 'remote' ? '' : 'hidden'}>
              {viewedTabs.has('remote') && <RemoteControlPanel />}
            </div>
            <div className={activeTab === 'logs' ? '' : 'hidden'}>
              {viewedTabs.has('logs') && <LogsTab />}
            </div>
            <div className={activeTab === 'language' ? '' : 'hidden'}>
              {viewedTabs.has('language') && <LanguageTab />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== API Settings Tab (Full version from ConfigModal) ====================

function APISettingsTab() {
  const { t } = useTranslation();
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
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ApiTestResult | null>(null);
  const [useLiveTest, setUseLiveTest] = useState(false);
  const [enableThinking, setEnableThinking] = useState(false);
  const previousProviderRef = useRef(provider);
  const isLoadingConfigRef = useRef(false);

  useEffect(() => {
    if (isElectron) {
      loadConfig();
    } else {
      setIsLoadingConfig(false);
    }
  }, []);

  useEffect(() => {
    setTestResult(null);
  }, [provider, apiKey, baseUrl, customProtocol, model, customModel, useCustomModel]);

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
        setEnableThinking(cfg.enableThinking || false);
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    } finally {
      isLoadingConfigRef.current = false;
      setIsLoadingConfig(false);
    }
  }

  async function handleTest() {
    if (!apiKey.trim()) {
      setError(t('api.apiKey') + ' is required');
      return;
    }

    const finalModel = useCustomModel ? customModel.trim() : model;
    if (!finalModel) {
      setError(t('api.model') + ' is required');
      return;
    }

    setError('');
    setIsTesting(true);
    setTestResult(null);

    try {
      const presetBaseUrl = presets?.[provider]?.baseUrl;
      const resolvedBaseUrl = provider === 'custom'
        ? baseUrl.trim()
        : (presetBaseUrl || baseUrl).trim();

      const result = await window.electronAPI.config.test({
        provider,
        apiKey: apiKey.trim(),
        baseUrl: resolvedBaseUrl || undefined,
        customProtocol,
        model: finalModel,
        useLiveRequest: useLiveTest,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        errorType: 'unknown',
        details: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSave() {
    if (!apiKey.trim()) {
      setError(t('api.apiKey') + ' is required');
      return;
    }

    const finalModel = useCustomModel ? customModel.trim() : model;
    if (!finalModel) {
      setError(t('api.model') + ' is required');
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
        enableThinking,
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
          {t('api.provider')}
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
              {p === 'custom' ? t('api.moreModels') : (presets?.[p]?.name || p)}
            </button>
          ))}
        </div>
      </div>

      {/* API Key */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Key className="w-4 h-4" />
          {t('api.apiKey')}
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
            {t('api.protocol')}
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
          <p className="text-xs text-text-muted">{t('api.selectProtocol')}</p>
        </div>
      )}

      {/* Base URL - Only for custom provider */}
      {provider === 'custom' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Server className="w-4 h-4" />
            {t('api.baseUrl')}
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
              ? t('api.enterOpenAIUrl')
              : t('api.enterAnthropicUrl')}
          </p>
        </div>
      )}

      {/* Model Selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Cpu className="w-4 h-4" />
            {t('api.model')}
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
            {useCustomModel ? t('api.usePreset') : t('api.custom')}
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
            {t('api.enterModelId')}
          </p>
        )}
      </div>

      {/* Enable Thinking Mode */}
      <div className="space-y-2">
        <div className="flex items-start gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            id="enable-thinking"
            checked={enableThinking}
            onChange={(e) => setEnableThinking(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-border text-accent focus:ring-accent"
          />
          <label htmlFor="enable-thinking" className="space-y-0.5 flex-1">
            <div className="text-text-primary font-medium">{t('api.enableThinking')}</div>
            <div>{t('api.enableThinkingHint')}</div>
          </label>
        </div>
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
          {t('common.saved')}
        </div>
      )}
      {testResult && (
        <div className={`flex gap-2 px-4 py-3 rounded-xl text-sm ${testResult.ok ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}`}>
          {testResult.ok ? (
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
          )}
          <div className="flex-1">
            <div>
              {testResult.ok
                ? t('api.testSuccess', { ms: typeof testResult.latencyMs === 'number' ? testResult.latencyMs : '--' })
                : t(`api.testError.${testResult.errorType || 'unknown'}`)}
            </div>
            {!testResult.ok && testResult.details && (
              <div className="mt-1 text-xs text-text-muted">{testResult.details}</div>
            )}
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="flex items-start gap-2 text-xs text-text-muted">
        <input
          type="checkbox"
          id="api-live-test"
          checked={useLiveTest}
          onChange={(e) => setUseLiveTest(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-border text-accent focus:ring-accent"
        />
        <label htmlFor="api-live-test" className="space-y-0.5">
          <div className="text-text-primary">{t('api.liveTest')}</div>
          <div>{t('api.liveTestHint')}</div>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={handleTest}
          disabled={isTesting || !apiKey.trim()}
          className="w-full py-3 px-4 rounded-xl border border-border bg-surface-hover text-text-primary font-medium hover:bg-surface-active disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
        >
          {isTesting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('api.testingConnection')}
            </>
          ) : (
            <>
              <Plug className="w-4 h-4" />
              {t('api.testConnection')}
            </>
          )}
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving || !apiKey.trim()}
          className="w-full py-3 px-4 rounded-xl bg-accent text-white font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('common.saving')}
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              {t('api.saveSettings')}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ==================== Sandbox Tab ====================

interface SandboxStatus {
  platform: string;
  mode: string;
  initialized: boolean;
  wsl?: {
    available: boolean;
    distro?: string;
    nodeAvailable?: boolean;
    version?: string;
    pythonAvailable?: boolean;
    pythonVersion?: string;
    pipAvailable?: boolean;
    claudeCodeAvailable?: boolean;
  };
  lima?: {
    available: boolean;
    instanceExists?: boolean;
    instanceRunning?: boolean;
    instanceName?: string;
    nodeAvailable?: boolean;
    version?: string;
    pythonAvailable?: boolean;
    pythonVersion?: string;
    pipAvailable?: boolean;
    claudeCodeAvailable?: boolean;
  };
  error?: string;
}

function SandboxTab() {
  const { t } = useTranslation();
  const [sandboxEnabled, setSandboxEnabled] = useState(true);
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);

  const platform = window.electronAPI?.platform || 'unknown';
  const isWindows = platform === 'win32';
  const isMac = platform === 'darwin';

  // Single initialization effect - load config and status together
  useEffect(() => {
    if (!isElectron) {
      setIsLoading(false);
      setIsInitialized(true);
      return;
    }

    let cancelled = false;

    async function initialize() {
      try {
        // Load both config and status in parallel
        const [cfg, s] = await Promise.all([
          window.electronAPI.config.get(),
          window.electronAPI.sandbox.getStatus()
        ]);
        
        if (cancelled) return;
        
        setSandboxEnabled(cfg.sandboxEnabled !== false);
        setStatus(s);
        setError('');
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to initialize sandbox tab:', err);
        setError(t('sandbox.failedToLoad'));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsInitialized(true);
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, [t]);

  async function loadStatus() {
    try {
      const s = await window.electronAPI.sandbox.getStatus();
      setStatus(s);
      setError('');
    } catch (err) {
      console.error('Failed to load sandbox status:', err);
      setError(t('sandbox.failedToLoad'));
    }
  }

  // TODO: Re-enable when sandbox debugging is complete
  // async function handleToggleSandbox() {
  //   const newEnabled = !sandboxEnabled;
  //   
  //   // Optimistically update UI
  //   setSandboxEnabled(newEnabled);
  //   setError('');
  //   setSuccess('');
  //
  //   try {
  //     await window.electronAPI.config.save({ sandboxEnabled: newEnabled });
  //     setSuccess(newEnabled ? t('sandbox.enabledWillSetup') : t('sandbox.disabled'));
  //     
  //     // Clear success message after delay
  //     const timer = setTimeout(() => setSuccess(''), 3000);
  //     return () => clearTimeout(timer);
  //   } catch (err) {
  //     // Revert on error
  //     setSandboxEnabled(!newEnabled);
  //     setError(err instanceof Error ? err.message : t('sandbox.failedToSave'));
  //   }
  // }

  async function handleCheckStatus() {
    if (isChecking) return; // Prevent double-click
    
    setIsChecking(true);
    setError('');
    setSuccess('');
    
    try {
      // Fresh check based on platform - this forces a re-check on the backend
      if (isWindows) {
        await window.electronAPI.sandbox.checkWSL();
      } else if (isMac) {
        await window.electronAPI.sandbox.checkLima();
      }
      
      // Get full status after check
      const fullStatus = await window.electronAPI.sandbox.getStatus();
      setStatus(fullStatus);
      
      setSuccess(t('sandbox.statusRefreshed'));
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sandbox.checkFailed'));
    } finally {
      setIsChecking(false);
    }
  }

  async function handleInstallNode() {
    if (!status || isInstalling) return;
    setIsInstalling('node');
    setError('');
    setSuccess('');

    try {
      let result = false;
      if (isWindows && status.wsl?.distro) {
        result = await window.electronAPI.sandbox.installNodeInWSL(status.wsl.distro);
      } else if (isMac) {
        result = await window.electronAPI.sandbox.installNodeInLima();
      }

      if (result) {
        setSuccess(t('sandbox.nodeInstalled'));
        // Refresh status after a short delay to allow backend to update
        setTimeout(async () => {
          await loadStatus();
        }, 500);
      } else {
        setError(t('sandbox.nodeInstallFailed'));
      }
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sandbox.nodeInstallFailed'));
    } finally {
      setIsInstalling(null);
    }
  }

  async function handleInstallPython() {
    if (!status || isInstalling) return;
    setIsInstalling('python');
    setError('');
    setSuccess('');

    try {
      let result = false;
      if (isWindows && status.wsl?.distro) {
        result = await window.electronAPI.sandbox.installPythonInWSL(status.wsl.distro);
      } else if (isMac) {
        result = await window.electronAPI.sandbox.installPythonInLima();
      }

      if (result) {
        setSuccess(t('sandbox.pythonInstalled'));
        setTimeout(async () => {
          await loadStatus();
        }, 500);
      } else {
        setError(t('sandbox.pythonInstallFailed'));
      }
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sandbox.pythonInstallFailed'));
    } finally {
      setIsInstalling(null);
    }
  }

  async function handleRetrySetup() {
    if (isInstalling) return;
    setIsInstalling('setup');
    setError('');
    setSuccess('');

    try {
      const result = await window.electronAPI.sandbox.retrySetup();
      if (result.success) {
        setSuccess(t('sandbox.setupComplete'));
        setTimeout(async () => {
          await loadStatus();
        }, 500);
      } else {
        setError(result.error || t('sandbox.setupFailed'));
      }
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sandbox.setupFailed'));
    } finally {
      setIsInstalling(null);
    }
  }

  async function handleStartLima() {
    if (isInstalling) return;
    setIsInstalling('start');
    setError('');
    setSuccess('');
    
    try {
      const result = await window.electronAPI.sandbox.startLimaInstance();
      if (result) {
        setSuccess(t('sandbox.limaStarted'));
        setTimeout(async () => {
          await loadStatus();
        }, 500);
      } else {
        setError(t('sandbox.limaStartFailed'));
      }
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sandbox.limaStartFailed'));
    } finally {
      setIsInstalling(null);
    }
  }

  async function handleStopLima() {
    if (isInstalling) return;
    setIsInstalling('stop');
    setError('');
    setSuccess('');
    
    try {
      const result = await window.electronAPI.sandbox.stopLimaInstance();
      if (result) {
        setSuccess(t('sandbox.limaStopped'));
        setTimeout(async () => {
          await loadStatus();
        }, 500);
      } else {
        setError(t('sandbox.limaStopFailed'));
      }
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sandbox.limaStopFailed'));
    } finally {
      setIsInstalling(null);
    }
  }

  // Show loading only on initial load
  if (isLoading && !isInitialized) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
        <span className="ml-2 text-text-secondary">{t('common.loading')}</span>
      </div>
    );
  }

  const sandboxAvailable = isWindows ? status?.wsl?.available : isMac ? status?.lima?.available : false;
  const sandboxReady = isWindows 
    ? status?.wsl?.available && status?.wsl?.nodeAvailable
    : isMac 
      ? status?.lima?.available && status?.lima?.instanceRunning && status?.lima?.nodeAvailable
      : false;

  return (
    <div className="space-y-4">
      {/* Info Banner */}
      <div className="px-4 py-3 rounded-xl bg-blue-500/10 text-blue-600 text-sm">
        <p className="font-medium mb-1">🛡️ {t('sandbox.title')}</p>
        <p className="text-xs opacity-80">
          {isWindows ? t('sandbox.wslDesc') : isMac ? t('sandbox.limaDesc') : t('sandbox.nativeDesc')}
        </p>
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
          {success}
        </div>
      )}

      {/* Enable/Disable Toggle - Temporarily Disabled */}
      <div className="p-4 rounded-xl bg-surface border-2 border-border opacity-60">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-gray-200 dark:bg-gray-700 text-gray-500">
              <Shield className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-text-primary">{t('sandbox.enableSandbox')}</h3>
              <p className="text-sm text-amber-500 mt-0.5">
                🚧 功能调试中，暂时不支持
              </p>
            </div>
          </div>
          {/* Toggle switch - disabled */}
          <button
            disabled={true}
            aria-label="Sandbox temporarily unavailable"
            title="功能调试中，暂时不支持"
            className="relative inline-flex h-8 w-14 items-center rounded-full transition-all duration-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 bg-gray-300 dark:bg-gray-600"
          >
            <span
              className="inline-block h-6 w-6 transform rounded-full bg-white shadow-md transition-transform duration-200 translate-x-1"
            />
          </button>
        </div>
      </div>

      {/* Status Details - Hidden while sandbox is disabled for debugging */}
      {false && sandboxEnabled && (
        <div className="p-4 rounded-xl bg-surface border border-border space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-text-primary">{t('sandbox.environmentStatus')}</h3>
            <button
              onClick={handleCheckStatus}
              disabled={isChecking || isInstalling !== null}
              className="px-3 py-1.5 rounded-lg bg-surface-hover text-text-secondary text-xs hover:bg-surface-active transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {isChecking ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Settings className="w-3.5 h-3.5" />
              )}
              {t('sandbox.checkStatus')}
            </button>
          </div>

          {/* Platform Info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-surface-muted">
              <div className="text-xs text-text-muted mb-1">{t('sandbox.platform')}</div>
              <div className="text-sm font-medium text-text-primary">
                {isWindows ? 'Windows' : isMac ? 'macOS' : 'Linux'}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-surface-muted">
              <div className="text-xs text-text-muted mb-1">{t('sandbox.mode')}</div>
              <div className="text-sm font-medium text-text-primary">
                {status?.mode === 'wsl' ? 'WSL2' : status?.mode === 'lima' ? 'Lima VM' : t('sandbox.native')}
              </div>
            </div>
          </div>

          {/* WSL Status (Windows) */}
          {isWindows && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                WSL2 {t('sandbox.status')}
              </div>
              <div className="space-y-2">
                <StatusItem 
                  label={t('sandbox.wslAvailable')} 
                  available={status?.wsl?.available || false} 
                  detail={status?.wsl?.distro}
                />
                <StatusItem 
                  label="Node.js" 
                  available={status?.wsl?.nodeAvailable || false}
                  detail={status?.wsl?.version}
                  action={!status?.wsl?.nodeAvailable && status?.wsl?.available ? {
                    label: t('common.install'),
                    onClick: handleInstallNode,
                    loading: isInstalling === 'node'
                  } : undefined}
                />
                <StatusItem 
                  label="Python" 
                  available={status?.wsl?.pythonAvailable || false}
                  detail={status?.wsl?.pythonVersion}
                  optional
                  action={!status?.wsl?.pythonAvailable && status?.wsl?.available ? {
                    label: t('common.install'),
                    onClick: handleInstallPython,
                    loading: isInstalling === 'python'
                  } : undefined}
                />
                <StatusItem 
                  label="pip" 
                  available={status?.wsl?.pipAvailable || false}
                  optional
                />
              </div>
              
              {!status?.wsl?.available && (
                <div className="mt-3 p-3 rounded-lg bg-amber-500/10 text-amber-600 text-xs">
                  <p className="font-medium mb-1">{t('sandbox.wslNotInstalled')}</p>
                  <p className="opacity-80">{t('sandbox.wslInstallHint')}</p>
                  <code className="block mt-2 p-2 rounded bg-background font-mono text-xs">
                    wsl --install
                  </code>
                </div>
              )}
            </div>
          )}

          {/* Lima Status (macOS) */}
          {isMac && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                Lima VM {t('sandbox.status')}
              </div>
              <div className="space-y-2">
                <StatusItem 
                  label={t('sandbox.limaAvailable')} 
                  available={status?.lima?.available || false}
                />
                <StatusItem 
                  label={t('sandbox.vmCreated')} 
                  available={status?.lima?.instanceExists || false}
                  detail={status?.lima?.instanceName}
                />
                <StatusItem 
                  label={t('sandbox.vmRunning')} 
                  available={status?.lima?.instanceRunning || false}
                  action={status?.lima?.instanceExists && !status?.lima?.instanceRunning ? {
                    label: t('sandbox.start'),
                    onClick: handleStartLima,
                    loading: isInstalling === 'start'
                  } : status?.lima?.instanceRunning ? {
                    label: t('sandbox.stop'),
                    onClick: handleStopLima,
                    loading: isInstalling === 'stop',
                    variant: 'secondary'
                  } : undefined}
                />
                <StatusItem 
                  label="Node.js" 
                  available={status?.lima?.nodeAvailable || false}
                  detail={status?.lima?.version}
                  action={!status?.lima?.nodeAvailable && status?.lima?.instanceRunning ? {
                    label: t('common.install'),
                    onClick: handleInstallNode,
                    loading: isInstalling === 'node'
                  } : undefined}
                />
                <StatusItem 
                  label="Python" 
                  available={status?.lima?.pythonAvailable || false}
                  detail={status?.lima?.pythonVersion}
                  optional
                  action={!status?.lima?.pythonAvailable && status?.lima?.instanceRunning ? {
                    label: t('common.install'),
                    onClick: handleInstallPython,
                    loading: isInstalling === 'python'
                  } : undefined}
                />
              </div>

              {!status?.lima?.available && (
                <div className="mt-3 p-3 rounded-lg bg-amber-500/10 text-amber-600 text-xs">
                  <p className="font-medium mb-1">{t('sandbox.limaNotInstalled')}</p>
                  <p className="opacity-80">{t('sandbox.limaInstallHint')}</p>
                  <code className="block mt-2 p-2 rounded bg-background font-mono text-xs">
                    brew install lima
                  </code>
                </div>
              )}
            </div>
          )}

          {/* Linux - Native Mode */}
          {!isWindows && !isMac && (
            <div className="p-3 rounded-lg bg-surface-muted text-text-secondary text-sm">
              {t('sandbox.linuxNative')}
            </div>
          )}
        </div>
      )}

      {/* Retry Setup Button */}
      {sandboxEnabled && sandboxAvailable && !sandboxReady && (
        <button
          onClick={handleRetrySetup}
          disabled={isInstalling !== null}
          className="w-full py-3 px-4 rounded-xl bg-accent text-white font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
        >
          {isInstalling === 'setup' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('sandbox.settingUp')}
            </>
          ) : (
            <>
              <Settings className="w-4 h-4" />
              {t('sandbox.retrySetup')}
            </>
          )}
        </button>
      )}

      {/* Help Text */}
      <div className="text-xs text-text-muted text-center space-y-1">
        <p>{t('sandbox.helpText1')}</p>
        <p>{t('sandbox.helpText2')}</p>
      </div>
    </div>
  );
}

function StatusItem({ 
  label, 
  available, 
  detail, 
  optional,
  action 
}: { 
  label: string; 
  available: boolean; 
  detail?: string;
  optional?: boolean;
  action?: { 
    label: string; 
    onClick: () => void; 
    loading?: boolean;
    variant?: 'primary' | 'secondary';
  };
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background">
      <div className="flex items-center gap-2">
        <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
          available 
            ? 'bg-success/10 text-success' 
            : optional 
              ? 'bg-surface-muted text-text-muted'
              : 'bg-error/10 text-error'
        }`}>
          {available ? (
            <CheckCircle className="w-3.5 h-3.5" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5" />
          )}
        </div>
        <span className="text-sm text-text-primary">{label}</span>
        {detail && (
          <span className="text-xs text-text-muted">({detail})</span>
        )}
        {optional && !available && (
          <span className="text-xs text-text-muted">({t('common.optional')})</span>
        )}
      </div>
      {action && (
        <button
          onClick={action.onClick}
          disabled={action.loading}
          className={`px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1 ${
            action.variant === 'secondary'
              ? 'bg-surface-muted text-text-secondary hover:bg-surface-active'
              : 'bg-accent text-white hover:bg-accent-hover'
          }`}
        >
          {action.loading && <Loader2 className="w-3 h-3 animate-spin" />}
          {action.label}
        </button>
      )}
    </div>
  );
}

// ==================== Credentials Tab ====================

function CredentialsTab() {
  const { t } = useTranslation();
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
      setError(t('credentials.failedToLoad'));
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
      setError(err instanceof Error ? err.message : t('credentials.failedToSave'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('credentials.deleteConfirm'))) return;
    setIsLoading(true);
    try {
      await window.electronAPI.credentials.delete(id);
      await loadCredentials();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('credentials.failedToDelete'));
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
        <p className="font-medium mb-1">{t('credentials.encrypted')}</p>
        <p className="text-xs opacity-80">
          {t('credentials.encryptedDesc')}
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
              <p>{t('credentials.noCredentials')}</p>
              <p className="text-sm mt-1">{t('credentials.addCredential')}</p>
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
                      title={t('common.edit')}
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(cred.id)}
                      disabled={isLoading}
                      className="p-2 rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors"
                      title={t('common.delete')}
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
          {t('credentials.addNewCredential')}
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
  const { t } = useTranslation();
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
      alert(t('credentials.nameRequired'));
      return;
    }
    if (!credential && !password.trim()) {
      alert(t('credentials.passwordRequired'));
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
        {credential ? t('credentials.editCredential') : t('credentials.addNewCredential')}
      </h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">{t('credentials.name')} *</label>
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
          <label className="block text-sm font-medium text-text-primary mb-2">{t('credentials.type')}</label>
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
        <label className="block text-sm font-medium text-text-primary mb-2">{t('credentials.service')}</label>
        <select
          value={service}
          onChange={(e) => setService(e.target.value)}
          className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
        >
          <option value="">{t('credentials.selectService')}</option>
          {SERVICE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{t('credentials.username')} *</label>
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
          {t('credentials.password')} {credential ? t('credentials.passwordKeepCurrent') : '*'}
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
        <label className="block text-sm font-medium text-text-primary mb-2">{t('credentials.loginUrl')}</label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://mail.google.com"
          className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{t('credentials.notes')}</label>
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
          {isLoading ? t('common.saving') : t('common.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading}
          className="px-4 py-2 rounded-lg bg-surface-muted text-text-secondary hover:bg-surface-active transition-colors"
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

// ==================== Connectors Tab (Full version from MCPConnectorsModal) ====================

function ConnectorsTab() {
  const { t } = useTranslation();
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [statuses, setStatuses] = useState<MCPServerStatus[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [presets, setPresets] = useState<Record<string, any>>({});
  const [showPresets, setShowPresets] = useState(true);
  const [configuringPreset, setConfiguringPreset] = useState<{ key: string; preset: any } | null>(null);
  const [presetEnvValues, setPresetEnvValues] = useState<Record<string, string>>({});

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

    // Check if preset requires environment variables
    if (preset.requiresEnv && preset.requiresEnv.length > 0) {
      // Initialize env values from preset defaults
      const initialEnv: Record<string, string> = {};
      preset.requiresEnv.forEach((key: string) => {
        initialEnv[key] = preset.env?.[key] || '';
      });
      setPresetEnvValues(initialEnv);
      setConfiguringPreset({ key: presetKey, preset });
      return;
    }

    // No env required, add directly
    await addPresetServer(presetKey, preset, {});
  }

  async function addPresetServer(presetKey: string, preset: any, envOverrides: Record<string, string>) {
    const serverConfig: MCPServerConfig = {
      id: `mcp-${presetKey}-${Date.now()}`,
      name: preset.name,
      type: preset.type,
      // STDIO fields
      command: preset.command,
      args: preset.args,
      env: { ...preset.env, ...envOverrides },
      // SSE fields
      url: preset.url,
      headers: preset.headers,
      enabled: false,
    };

    await handleSaveServer(serverConfig);
    setShowPresets(false);
    setConfiguringPreset(null);
    setPresetEnvValues({});
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
    if (!confirm(t('common.delete') + ' this connector?')) return;
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
        <p className="font-medium mb-1">🔌 {t('settings.connectors')}</p>
        <p className="text-xs opacity-80">
          {t('settings.connectorsDesc')}
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
              <p>{t('mcp.noConnectors')}</p>
              <p className="text-sm mt-1">{t('mcp.addConnector')}</p>
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

      {/* Preset Environment Configuration Modal */}
      {configuringPreset && (
        <div className="p-4 rounded-xl border border-accent/30 bg-accent/5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-text-primary">
              {t('mcp.configure')} {configuringPreset.preset.name}
            </h3>
            <button
              onClick={() => {
                setConfiguringPreset(null);
                setPresetEnvValues({});
              }}
              className="text-text-muted hover:text-text-primary"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-text-muted">
            This connector requires configuration before it can be added.
          </p>
          <div className="space-y-3">
            {configuringPreset.preset.requiresEnv?.map((envKey: string) => (
              <div key={envKey}>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  {configuringPreset.preset.envDescription?.[envKey] || envKey}
                </label>
                <input
                  type="password"
                  value={presetEnvValues[envKey] || ''}
                  onChange={(e) => setPresetEnvValues(prev => ({ ...prev, [envKey]: e.target.value }))}
                  placeholder={`Enter ${envKey}`}
                  className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setConfiguringPreset(null);
                setPresetEnvValues({});
              }}
              className="px-3 py-1.5 rounded-md text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => addPresetServer(configuringPreset.key, configuringPreset.preset, presetEnvValues)}
              disabled={isLoading || configuringPreset.preset.requiresEnv?.some((key: string) => !presetEnvValues[key]?.trim())}
              className="px-4 py-1.5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {t('common.add')}
            </button>
          </div>
        </div>
      )}

      {/* Preset Servers */}
      {!showAddForm && !editingServer && !configuringPreset && Object.keys(presets).length > 0 && (
        <div className="space-y-3">
            <button
              onClick={() => setShowPresets(!showPresets)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-surface-muted hover:bg-surface transition-colors"
            >
              <h3 className="text-sm font-medium text-text-primary">{t('mcp.quickAddPresets')}</h3>
              <div className="flex items-center gap-1.5 text-text-muted">
                <span className="text-xs">{showPresets ? t('mcp.hide') : t('mcp.show')}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showPresets ? 'rotate-180' : ''}`} />
              </div>
            </button>
          {showPresets && (
            <div className="grid grid-cols-1 gap-2">
              {Object.entries(presets).map(([key, preset]) => {
                const isAdded = servers.some(s => s.name === preset.name && s.command === preset.command);
                const requiresConfig = preset.requiresEnv && preset.requiresEnv.length > 0;
                return (
                  <div
                    key={key}
                    className={`p-3 rounded-lg border flex items-center gap-3 ${
                      isAdded
                        ? 'border-border bg-surface-muted opacity-60'
                        : 'border-border bg-surface'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-text-primary">{preset.name}</span>
                        {requiresConfig && !isAdded && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-500/10 text-amber-600 border border-amber-500/20">
                            {t('mcp.requiresToken')}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-muted mt-0.5 truncate">
                        {preset.type === 'stdio' 
                          ? `${preset.command} ${preset.args?.join(' ') || ''}`
                          : preset.url || 'Remote server'
                        }
                      </div>
                    </div>
                    {isAdded ? (
                      <div className="flex items-center gap-1 text-success text-xs whitespace-nowrap">
                        <CheckCircle className="w-4 h-4" />
                        <span>{t('mcp.added')}</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleAddPreset(key)}
                        disabled={isLoading}
                        className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 whitespace-nowrap flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {requiresConfig ? t('mcp.configure') : t('common.add')}
                      </button>
                    )}
                  </div>
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
          {t('mcp.addCustomConnector')}
        </button>
      )}

      {/* Footer info */}
      <div className="text-sm text-text-muted text-center pt-2">
        {t('mcp.toolsAvailable', { count: tools.length })}
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
  const { t } = useTranslation();
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
                    ? `✓ ${t('mcp.connected')} to Chrome debug port (9222)` 
                    : server.enabled
                      ? `⏳ ${t('mcp.connecting')}`
                      : `💡 ${t('mcp.chromeHint')}`
                  }
                </div>
              )}
              <div className="flex items-center gap-4 mt-2">
                <button
                  onClick={() => setShowTools(!showTools)}
                  className="flex items-center gap-1 hover:text-accent transition-colors"
                >
                  <Plug className="w-3 h-3" />
                  <span>{t('mcp.toolsAvailable', { count: toolCount })}</span>
                  {showTools ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
                {isConnected && (
                  <span className="flex items-center gap-1 text-success">
                    <CheckCircle className="w-3 h-3" />
                    {t('mcp.connected')}
                  </span>
                )}
              </div>
              
              {/* Tools List */}
              {showTools && tools.length > 0 && (
                <div className="mt-3 p-3 rounded-lg bg-surface-muted border border-border">
                  <div className="text-xs font-medium text-text-primary mb-2">{t('mcp.toolsAvailable', { count: tools.length }).split(' ').slice(1).join(' ')}:</div>
                  <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
                    {tools.map((tool, idx) => {
                      // Extract only the part after the last double underscore
                      const parts = tool.name.split('__');
                      const displayName = parts.length > 1 ? parts[parts.length - 1] : tool.name;
                      return (
                        <div
                          key={idx}
                          className="px-2 py-1.5 rounded bg-background border border-border text-xs text-text-secondary"
                          title={tool.description || tool.name}
                        >
                          <div className="font-mono text-accent break-words whitespace-normal">{displayName}</div>
                          {tool.description && (
                            <div className="text-text-muted mt-0.5 break-words whitespace-normal">{tool.description}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {showTools && tools.length === 0 && (
                <div className="mt-3 p-3 rounded-lg bg-surface-muted text-xs text-text-muted">
                  {t('mcp.notConnected')}
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
              title={server.enabled ? t('common.disable') || 'Disable' : t('common.enable') || 'Enable'}
            >
              {server.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
            </button>
            <button
              onClick={onEdit}
              disabled={isLoading}
              className="p-2 rounded-lg bg-surface-muted text-text-secondary hover:bg-surface-active transition-colors"
              title={t('common.edit')}
            >
              <Edit3 className="w-4 h-4" />
            </button>
            <button
              onClick={onDelete}
              disabled={isLoading}
              className="p-2 rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors"
              title={t('common.delete')}
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
  const { t } = useTranslation();
  const [name, setName] = useState(server?.name || '');
  const [type, setType] = useState<'stdio' | 'sse'>(server?.type || 'stdio');
  const [command, setCommand] = useState(server?.command || '');
  const [args, setArgs] = useState(server?.args?.join(' ') || '');
  const [url, setUrl] = useState(server?.url || '');
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  // Environment variables (for tokens, etc.)
  const [envVars, setEnvVars] = useState<Record<string, string>>(server?.env || {});
  const [showEnvSection, setShowEnvSection] = useState(Object.keys(server?.env || {}).length > 0);

  function handleEnvChange(key: string, value: string) {
    setEnvVars(prev => ({ ...prev, [key]: value }));
  }

  const [isAddingEnvVar, setIsAddingEnvVar] = useState(false);
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');

  const handleAddEnvVar = () => {
    setIsAddingEnvVar(true);
    setShowEnvSection(true);
  };

  const handleSaveNewEnvVar = () => {
    if (newEnvKey.trim()) {
      setEnvVars(prev => ({ ...prev, [newEnvKey.trim()]: newEnvValue.trim() }));
      setNewEnvKey('');
      setNewEnvValue('');
      setIsAddingEnvVar(false);
    }
  };

  const handleCancelNewEnvVar = () => {
    setNewEnvKey('');
    setNewEnvValue('');
    setIsAddingEnvVar(false);
  };

  function handleRemoveEnvVar(key: string) {
    setEnvVars(prev => {
      const newVars = { ...prev };
      delete newVars[key];
      return newVars;
    });
  }

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
        alert(t('mcp.command') + ' is required');
        return;
      }
      config.command = command.trim();
      config.args = args.trim() ? args.trim().split(/\s+/) : [];
      // Include environment variables
      if (Object.keys(envVars).length > 0) {
        config.env = envVars;
      }
    } else {
      if (!url.trim()) {
        alert(t('mcp.url') + ' is required');
        return;
      }
      config.url = url.trim();
    }

    onSave(config);
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-surface p-4 space-y-4">
      <h3 className="font-medium text-text-primary">
        {server ? t('mcp.editConnector') : t('mcp.addConnectorTitle')}
      </h3>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{t('mcp.name')}</label>
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
        <label className="block text-sm font-medium text-text-primary mb-2">{t('mcp.type')}</label>
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
            <label className="block text-sm font-medium text-text-primary mb-2">{t('mcp.command')}</label>
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
            <label className="block text-sm font-medium text-text-primary mb-2">{t('mcp.arguments')}</label>
            <input
              type="text"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="-y chrome-devtools-mcp@latest --browser-url http://localhost:9222"
              className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 font-mono text-sm"
            />
            <p className="text-xs text-text-muted mt-1">{t('mcp.spaceSeparated')}</p>
          </div>
          
          {/* Environment Variables Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-primary">{t('credentials.envVars')}</label>
              <button
                type="button"
                onClick={() => setShowEnvSection(!showEnvSection)}
                className="text-xs text-accent hover:text-accent-hover"
              >
                {showEnvSection ? t('mcp.hide') : t('mcp.show')}
              </button>
            </div>
            {showEnvSection && (
              <div className="space-y-2 p-3 rounded-lg bg-surface-muted border border-border">
                {Object.entries(envVars).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-secondary w-32 truncate" title={key}>
                      {key}
                    </span>
                    <input
                      type="password"
                      value={value}
                      onChange={(e) => handleEnvChange(key, e.target.value)}
                      placeholder={`Enter ${key}`}
                      className="flex-1 px-3 py-1.5 rounded bg-background border border-border text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveEnvVar(key)}
                      className="p-1.5 rounded hover:bg-error/10 text-text-muted hover:text-error transition-colors"
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {Object.keys(envVars).length === 0 && !isAddingEnvVar && (
                  <p className="text-xs text-text-muted text-center py-2">{t('credentials.noEnvVars')}</p>
                )}
                {isAddingEnvVar && (
                  <div className="space-y-2 p-2 rounded bg-background border border-accent/30">
                    <input
                      type="text"
                      value={newEnvKey}
                      onChange={(e) => setNewEnvKey(e.target.value)}
                      placeholder="NOTION_TOKEN"
                      className="w-full px-3 py-1.5 rounded bg-surface border border-border text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
                      autoFocus
                    />
                    <input
                      type="password"
                      value={newEnvValue}
                      onChange={(e) => setNewEnvValue(e.target.value)}
                      placeholder="输入值"
                      className="w-full px-3 py-1.5 rounded bg-surface border border-border text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSaveNewEnvVar}
                        disabled={!newEnvKey.trim()}
                        className="flex-1 py-1 px-3 rounded bg-accent text-white text-xs hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {t('common.save')}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelNewEnvVar}
                        className="flex-1 py-1 px-3 rounded bg-surface-muted text-text-secondary text-xs hover:bg-surface-active transition-colors"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                )}
                {!isAddingEnvVar && (
                <button
                  type="button"
                  onClick={handleAddEnvVar}
                  className="w-full mt-2 py-1.5 px-3 rounded border border-dashed border-border hover:border-accent hover:bg-accent/5 text-xs text-text-secondary hover:text-accent transition-colors flex items-center justify-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('credentials.envVars')}
                </button>
                )}
              </div>
            )}
            <p className="text-xs text-text-muted">
              {t('credentials.usedForTokens')}
            </p>
          </div>
        </>
      ) : (
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">{t('mcp.url')}</label>
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
          {t('mcp.enableConnector')}
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
              {t('common.saving')}
            </>
          ) : (
            t('common.save')
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading}
          className="px-4 py-2 rounded-lg bg-surface-muted text-text-secondary hover:bg-surface-active transition-colors"
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}


// ==================== Skills Tab ====================

function SkillsTab() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isElectron) {
      loadSkills();
    }
  }, []);

  async function loadSkills() {
    try {
      const loaded = await window.electronAPI.skills.getAll();
      setSkills(loaded || []);
      setError('');
    } catch (err) {
      console.error('Failed to load skills:', err);
      setError('Failed to load skills');
    }
  }

  async function handleInstall() {
    try {
      const folderPath = await window.electronAPI.invoke<string | null>({ type: 'folder.select', payload: {} });
      if (!folderPath) return;

      setIsLoading(true);
      const validation = await window.electronAPI.skills.validate(folderPath);

      if (!validation.valid) {
        setError(`Invalid skill folder: ${validation.errors.join(', ')}`);
        return;
      }

      const result = await window.electronAPI.skills.install(folderPath);
      if (result.success) {
        await loadSkills();
        setError('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install skill');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(skillId: string, skillName: string) {
    if (!confirm(t('skills.deleteSkill', { name: skillName }))) return;

    setIsLoading(true);
    try {
      await window.electronAPI.skills.delete(skillId);
      await loadSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete skill');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleToggleEnabled(skill: Skill) {
    setIsLoading(true);
    try {
      await window.electronAPI.skills.setEnabled(skill.id, !skill.enabled);
      await loadSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle skill');
    } finally {
      setIsLoading(false);
    }
  }

  const builtinSkills = skills.filter(s => s.type === 'builtin');
  const customSkills = skills.filter(s => s.type !== 'builtin');

  return (
    <div className="space-y-4">
      {/* Info Banner */}
      <div className="px-4 py-3 rounded-xl bg-purple-500/10 text-purple-600 text-sm">
        <p className="font-medium mb-1">{t('skills.title')}</p>
        <p className="text-xs opacity-80">
          {t('skills.description')}
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Built-in Skills */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-text-primary px-2">{t('skills.builtinSkills')}</h3>
        {builtinSkills.map(skill => (
          <SkillCard
            key={skill.id}
            skill={skill}
            onToggleEnabled={() => handleToggleEnabled(skill)}
            onDelete={null}
            isLoading={isLoading}
          />
        ))}
      </div>

      {/* Custom Skills */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-text-primary px-2">{t('skills.customSkills')}</h3>
        {customSkills.length === 0 ? (
          <div className="text-center py-8 text-text-muted">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>{t('skills.noCustomSkills')}</p>
            <p className="text-sm mt-1">{t('skills.installSkillsDesc')}</p>
          </div>
        ) : (
          customSkills.map(skill => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onToggleEnabled={() => handleToggleEnabled(skill)}
              onDelete={() => handleDelete(skill.id, skill.name)}
              isLoading={isLoading}
            />
          ))
        )}
      </div>

      {/* Install Button */}
      <button
        onClick={handleInstall}
        disabled={isLoading}
        className="w-full py-3 px-4 rounded-xl border-2 border-dashed border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent disabled:opacity-50"
      >
        <Plus className="w-5 h-5" />
        {t('skills.installSkillFromFolder')}
      </button>
    </div>
  );
}

function SkillCard({ skill, onToggleEnabled, onDelete, isLoading }: {
  skill: Skill;
  onToggleEnabled: () => void;
  onDelete: (() => void) | null;
  isLoading: boolean;
}) {
  const isBuiltin = skill.type === 'builtin';

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-3 h-3 rounded-full ${skill.enabled ? 'bg-success' : 'bg-text-muted'}`} />
            <h3 className="font-medium text-text-primary">{skill.name}</h3>
            <span className={`px-2 py-0.5 text-xs rounded ${
              isBuiltin
                ? 'bg-blue-500/10 text-blue-500'
                : skill.type === 'mcp'
                  ? 'bg-purple-500/10 text-purple-500'
                  : 'bg-green-500/10 text-green-500'
            }`}>
              {skill.type.toUpperCase()}
            </span>
          </div>
          {skill.description && (
            <p className="text-sm text-text-muted ml-6">{skill.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleEnabled}
            disabled={isLoading}
            className={`p-2 rounded-lg transition-colors ${
              skill.enabled
                ? 'bg-success/10 text-success hover:bg-success/20'
                : 'bg-surface-muted text-text-muted hover:bg-surface-active'
            }`}
            title={skill.enabled ? 'Disable' : 'Enable'}
          >
            {skill.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
          </button>
          {onDelete && (
            <button
              onClick={onDelete}
              disabled={isLoading}
              className="p-2 rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== Language Tab ====================

function LanguageTab() {
  const { i18n, t } = useTranslation();
  const currentLang = i18n.language.startsWith('zh') ? 'zh' : 'en';

  const languages = [
    { code: 'en', nativeName: 'English' },
    { code: 'zh', nativeName: '中文' },
  ];

  const handleLanguageChange = (langCode: string) => {
    i18n.changeLanguage(langCode);
  };

  return (
    <div className="space-y-4">
      {/* Info Banner */}
      <div className="px-4 py-3 rounded-xl bg-blue-500/10 text-blue-600 text-sm">
        <p className="font-medium mb-1">🌐 {t('language.selectLanguage')}</p>
        <p className="text-xs opacity-80">
          {t('language.currentLanguage')}: {currentLang === 'zh' ? t('language.chinese') : t('language.english')}
        </p>
      </div>

      {/* Language Options */}
      <div className="space-y-2">
        {languages.map((lang) => (
          <button
            key={lang.code}
            onClick={() => handleLanguageChange(lang.code)}
            className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
              currentLang === lang.code
                ? 'border-accent bg-accent/5'
                : 'border-border bg-surface hover:border-accent/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="font-medium text-text-primary">{lang.nativeName}</div>
              {currentLang === lang.code && (
                <CheckCircle className="w-5 h-5 text-accent" />
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ==================== Logs Tab ====================

function LogsTab() {
  const { t } = useTranslation();
  const [logFiles, setLogFiles] = useState<Array<{ name: string; path: string; size: number; mtime: Date }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [logsDirectory, setLogsDirectory] = useState('');
  const [devLogsEnabled, setDevLogsEnabled] = useState(true);

  useEffect(() => {
    if (isElectron) {
      loadLogs();
      loadDevLogsStatus();
      
      // Auto-refresh logs every 3 seconds
      const interval = setInterval(() => {
        loadLogs();
      }, 3000);
      
      return () => clearInterval(interval);
    }
  }, []);

  async function loadLogs() {
    try {
      const [files, dir] = await Promise.all([
        window.electronAPI.logs.getAll(),
        window.electronAPI.logs.getDirectory(),
      ]);
      setLogFiles(files || []);
      setLogsDirectory(dir || '');
      setError('');
    } catch (err) {
      console.error('Failed to load logs:', err);
      setError(t('logs.exportFailed'));
    }
  }

  async function loadDevLogsStatus() {
    try {
      const result = await window.electronAPI.logs.isEnabled();
      if (result.success && typeof result.enabled === 'boolean') {
        setDevLogsEnabled(result.enabled);
      }
    } catch (err) {
      console.error('Failed to load dev logs status:', err);
    }
  }

  async function handleToggleDevLogs() {
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const newEnabled = !devLogsEnabled;
      const result = await window.electronAPI.logs.setEnabled(newEnabled);
      if (result.success) {
        setDevLogsEnabled(newEnabled);
        setSuccess(newEnabled ? t('logs.devLogsEnabled') : t('logs.devLogsDisabled'));
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(result.error || t('logs.toggleFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logs.toggleFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleExport() {
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const result = await window.electronAPI.logs.export();
      if (result.success) {
        setSuccess(t('logs.exportSuccess', { path: result.path }));
        setTimeout(() => setSuccess(''), 5000);
      } else {
        setError(result.error || t('logs.exportFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logs.exportFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOpen() {
    setIsLoading(true);
    try {
      await window.electronAPI.logs.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logs.exportFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleClear() {
    if (!confirm(t('logs.clearConfirm'))) {
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const result = await window.electronAPI.logs.clear();
      if (result.success) {
        setSuccess(t('logs.clearSuccess', { count: result.deletedCount }));
        await loadLogs();
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(result.error || t('logs.clearFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logs.clearFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(date: Date): string {
    return new Date(date).toLocaleString();
  }

  const totalSize = logFiles.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="space-y-4">
      {/* Info Banner */}
      <div className="px-4 py-3 rounded-xl bg-blue-500/10 text-blue-600 text-sm">
        <p className="font-medium mb-1">📋 {t('logs.title')}</p>
        <p className="text-xs opacity-80">
          {t('logs.description')}
        </p>
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
          {success}
        </div>
      )}

      {/* Developer Logs Toggle */}
      <div className="p-4 rounded-xl bg-surface border border-border">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h3 className="text-sm font-medium text-text-primary mb-1">{t('logs.enableDevLogs')}</h3>
            <p className="text-xs text-text-muted">{t('logs.enableDevLogsDesc')}</p>
          </div>
          <button
            onClick={handleToggleDevLogs}
            disabled={isLoading}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-50 ${
              devLogsEnabled ? 'bg-accent' : 'bg-surface-muted'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                devLogsEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 rounded-xl bg-surface border border-border">
          <div className="text-2xl font-bold text-text-primary">{logFiles.length}</div>
          <div className="text-sm text-text-muted">{t('logs.logFiles')}</div>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-border">
          <div className="text-2xl font-bold text-text-primary">{formatFileSize(totalSize)}</div>
          <div className="text-sm text-text-muted">{t('logs.totalSize')}</div>
        </div>
      </div>

      {/* Log Files List */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-text-primary px-2">{t('logs.logFiles')}</h3>
        {logFiles.length === 0 ? (
          <div className="text-center py-8 text-text-muted">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>{t('logs.noLogFiles')}</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {logFiles.map((file) => (
              <div key={file.path} className="p-3 rounded-lg bg-surface border border-border">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-text-primary truncate">{file.name}</div>
                    <div className="text-xs text-text-muted mt-1">
                      {formatFileSize(file.size)} • {formatDate(file.mtime)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Directory Path */}
      {logsDirectory && (
        <div className="p-3 rounded-lg bg-surface-muted border border-border">
          <div className="text-xs text-text-muted mb-1">{t('logs.logsDirectory')}</div>
          <div className="font-mono text-xs text-text-secondary break-all">{logsDirectory}</div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={handleExport}
          disabled={isLoading || logFiles.length === 0}
          className="py-3 px-4 rounded-xl bg-accent text-white font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          <span className="text-sm">{t('logs.exportZip')}</span>
        </button>
        <button
          onClick={handleOpen}
          disabled={isLoading}
          className="py-3 px-4 rounded-xl bg-surface border border-border text-text-primary font-medium hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
        >
          <Globe className="w-4 h-4" />
          <span className="text-sm">{t('logs.openFolder')}</span>
        </button>
        <button
          onClick={handleClear}
          disabled={isLoading || logFiles.length === 0}
          className="py-3 px-4 rounded-xl bg-error/10 text-error font-medium hover:bg-error/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
        >
          <Trash2 className="w-4 h-4" />
          <span className="text-sm">{t('logs.clearAll')}</span>
        </button>
      </div>

      {/* Help Text */}
      <div className="text-xs text-text-muted text-center space-y-1">
        <p>{t('logs.helpText1')}</p>
        <p>{t('logs.helpText2')}</p>
      </div>
    </div>
  );
}
