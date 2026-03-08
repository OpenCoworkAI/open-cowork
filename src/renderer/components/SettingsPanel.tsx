import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Key, Plug, Settings, ChevronRight, AlertCircle, Eye, EyeOff, Plus, Trash2, Edit3, Save, Mail, Globe, Lock, Server, Cpu, Loader2, Power, PowerOff, CheckCircle, Check, ChevronDown, Package, Shield, Wifi, FolderOpen, RefreshCw, Clock3 } from 'lucide-react';
import { useWindowSize } from '../hooks/useWindowSize';
import type {
  Skill,
  PluginCatalogItemV2,
  InstalledPlugin,
  PluginComponentKind,
  ScheduleConfig,
  ScheduleTask,
  ScheduleRepeatUnit,
  ScheduleWeekday,
  ScheduleCreateInput,
  ScheduleUpdateInput,
} from '../types';
import { RemoteControlPanel } from './RemoteControlPanel';
import { useApiConfigState } from '../hooks/useApiConfigState';
import { ApiConfigSetManager } from './ApiConfigSetManager';
import { useAppStore } from '../store';

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

type CredentialDraft = Omit<UserCredential, 'id' | 'createdAt' | 'updatedAt'>;

interface ModelOptionItem {
  id: string;
  name: string;
}

interface MCPToolInfo {
  serverId: string;
  name: string;
  description?: string;
}

interface MCPPreset {
  name: string;
  type: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  requiresEnv?: string[];
  envDescription?: Record<string, string>;
}

interface SettingsPanelProps {
  onClose: () => void;
  initialTab?: 'api' | 'sandbox' | 'connectors' | 'skills' | 'schedule' | 'remote' | 'logs' | 'general';
}

type TabId = 'api' | 'sandbox' | 'connectors' | 'skills' | 'schedule' | 'remote' | 'logs' | 'general';

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

type ScheduleFormMode = 'once' | 'daily' | 'weekly' | 'legacy-interval';

const SCHEDULE_TIME_SUGGESTIONS = [
  '06:00',
  '07:30',
  '08:00',
  '09:00',
  '10:30',
  '12:00',
  '14:00',
  '15:30',
  '18:00',
  '19:30',
  '21:00',
  '22:30',
];

const WEEKDAY_OPTIONS: Array<{ value: ScheduleWeekday; label: string }> = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
];

const SCHEDULE_MODE_OPTIONS: Array<{ value: ScheduleFormMode; label: string }> = [
  { value: 'once', label: '单次' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
];

// ==================== Main Component ====================

const VALID_TABS = new Set<TabId>(['api', 'sandbox', 'connectors', 'skills', 'schedule', 'remote', 'logs', 'general']);

export function SettingsPanel({ onClose, initialTab = 'api' }: SettingsPanelProps) {
  const { t } = useTranslation();
  const { width } = useWindowSize();
  const compactSidebar = width < 900;
  // Read settingsTab from store at mount time so external navigation (nav-server)
  // takes effect even before this component mounts.
  const storeTab = useAppStore((s) => s.settingsTab);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const resolvedInitial = (storeTab && VALID_TABS.has(storeTab as TabId)) ? storeTab as TabId : initialTab;

  const [activeTab, setActiveTab] = useState<TabId>(resolvedInitial);
  // Track which tabs have been viewed at least once (for lazy loading)
  const [viewedTabs, setViewedTabs] = useState<Set<TabId>>(new Set([resolvedInitial]));
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVersion);
      else if (v) setAppVersion(v);
    } catch { /* ignore */ }
  }, []);

  // Consume the store signal and apply tab in one effect
  useEffect(() => {
    if (storeTab && VALID_TABS.has(storeTab as TabId)) {
      setActiveTab(storeTab as TabId);
      setSettingsTab(null);
    }
  }, [storeTab, setSettingsTab]);

  // Mark tab as viewed when it becomes active
  useEffect(() => {
    if (!viewedTabs.has(activeTab)) {
      setViewedTabs(prev => new Set([...prev, activeTab]));
    }
  }, [activeTab, viewedTabs]);

  const tabs = [
    { id: 'api' as TabId, label: t('settings.apiSettings'), icon: Settings, description: t('settings.apiSettingsDesc') },
    { id: 'sandbox' as TabId, label: t('settings.sandbox'), icon: Shield, description: t('settings.sandboxDesc') },
    { id: 'connectors' as TabId, label: t('settings.connectors'), icon: Plug, description: t('settings.connectorsDesc') },
    { id: 'skills' as TabId, label: t('settings.skills'), icon: Package, description: t('settings.skillsDesc') },
    { id: 'schedule' as TabId, label: t('settings.schedule'), icon: Clock3, description: t('settings.scheduleDesc') },
    { id: 'remote' as TabId, label: t('settings.remote', '远程控制'), icon: Wifi, description: t('settings.remoteDesc', '通过飞书等平台远程使用') },
    { id: 'logs' as TabId, label: t('settings.logs'), icon: AlertCircle, description: t('settings.logsDesc') },
    { id: 'general' as TabId, label: t('settings.general'), icon: Globe, description: t('settings.generalDesc') },
  ];
  const activeTabMeta = tabs.find((tab) => tab.id === activeTab);

  return (
      <div className="flex h-full w-full overflow-hidden bg-background">
        {/* Sidebar */}
        <div className={`${compactSidebar ? 'w-14' : 'w-52 lg:w-60'} bg-background-secondary/88 border-r border-border-muted flex flex-col flex-shrink-0`}>
          {!compactSidebar && (
            <div className="px-4 pt-5 pb-4 border-b border-border-muted">
              <p className="text-[11px] uppercase tracking-[0.16em] text-text-muted">{t('settings.title')}</p>
              <h2 className="mt-1 text-[1.24rem] font-semibold tracking-[-0.03em] text-text-primary">Open Cowork</h2>
              <p className="mt-1 text-[11px] leading-4 text-text-muted">
                Configure your workspace, tools, and account behavior.
              </p>
            </div>
          )}
          <div className={`flex-1 ${compactSidebar ? 'p-1.5 space-y-1' : 'p-3 space-y-1.5'}`}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={compactSidebar ? tab.label : undefined}
                className={`w-full flex items-center ${compactSidebar ? 'justify-center p-2.5' : 'gap-3 px-3.5 py-3'} rounded-2xl text-left transition-colors active:scale-[0.98] ${
                  activeTab === tab.id
                    ? 'bg-background text-text-primary border border-border-subtle shadow-soft'
                    : 'hover:bg-background/70 text-text-secondary hover:text-text-primary'
                }`}
              >
                <tab.icon className="w-4.5 h-4.5 flex-shrink-0" />
                {!compactSidebar && (
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{tab.label}</p>
                    <p className="text-[11px] leading-4 text-text-muted line-clamp-2 mt-0.5">{tab.description}</p>
                  </div>
                )}
                {!compactSidebar && activeTab === tab.id && <ChevronRight className="w-4 h-4 flex-shrink-0" />}
              </button>
            ))}
          </div>
          <div className={`${compactSidebar ? 'p-1.5' : 'p-4'} border-t border-border-muted`}>
            <button
              onClick={onClose}
              className={`w-full py-2 ${compactSidebar ? 'px-2' : 'px-4'} rounded-xl bg-background/70 hover:bg-background transition-colors text-text-secondary text-sm`}
              title={compactSidebar ? t('common.close') : undefined}
            >
              {compactSidebar ? <X className="w-4 h-4 mx-auto" /> : t('common.close')}
            </button>
            {!compactSidebar && (
              <p className="text-[10px] text-text-muted text-center mt-2 select-text">v{appVersion}</p>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex items-center justify-between px-4 lg:px-8 py-4 border-b border-border-muted flex-shrink-0 bg-background/88 backdrop-blur-sm">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">{t('settings.title')}</p>
              <h3 className="mt-1 text-[1.15rem] font-semibold tracking-[-0.02em] text-text-primary">
                {activeTabMeta?.label}
              </h3>
              {activeTabMeta?.description && (
                <p className="mt-1 text-sm text-text-muted max-w-[36rem]">
                  {activeTabMeta.description}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-surface-hover transition-colors"
            >
              <X className="w-5 h-5 text-text-secondary" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 lg:px-8 lg:py-7">
            <div className="max-w-[900px] w-full min-w-0 mx-auto space-y-5">
            {activeTabMeta && (
              <div className="rounded-[1.75rem] border border-border-subtle bg-background/70 shadow-soft px-5 py-4 lg:px-6">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-2xl border border-border-subtle bg-background/80 flex items-center justify-center text-accent flex-shrink-0">
                    <activeTabMeta.icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">{t('settings.title')}</p>
                    <h4 className="mt-1 text-[1.15rem] font-semibold tracking-[-0.02em] text-text-primary">
                      {activeTabMeta.label}
                    </h4>
                    {activeTabMeta.description && (
                      <p className="mt-1.5 text-sm leading-6 text-text-muted max-w-[42rem]">
                        {activeTabMeta.description}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div className="rounded-[2rem] border border-border-subtle bg-background/55 shadow-soft px-5 py-5 lg:px-8 lg:py-7">
            <div className={activeTab === 'api' ? '' : 'hidden'}>
              {viewedTabs.has('api') && (
                <>
                  <APISettingsTab />
                  <div className="mt-8 pt-6 border-t border-border">
                    <CredentialsTab />
                  </div>
                </>
              )}
            </div>
            <div className={activeTab === 'sandbox' ? '' : 'hidden'}>
              {viewedTabs.has('sandbox') && <SandboxTab />}
            </div>
            <div className={activeTab === 'connectors' ? '' : 'hidden'}>
              {viewedTabs.has('connectors') && <ConnectorsTab />}
            </div>
            <div className={activeTab === 'skills' ? '' : 'hidden'}>
              {viewedTabs.has('skills') && <SkillsTab />}
            </div>
            <div className={activeTab === 'schedule' ? '' : 'hidden'}>
              {viewedTabs.has('schedule') && <ScheduleTab />}
            </div>
            <div className={activeTab === 'remote' ? '' : 'hidden'}>
              {viewedTabs.has('remote') && <RemoteControlPanel />}
            </div>
            <div className={activeTab === 'logs' ? '' : 'hidden'}>
              {viewedTabs.has('logs') && <LogsTab />}
            </div>
            <div className={activeTab === 'general' ? '' : 'hidden'}>
              {viewedTabs.has('general') && <GeneralTab />}
            </div>
            </div>
            </div>
          </div>
        </div>
      </div>
  );
}

function SettingsContentSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[1.6rem] border border-border-subtle bg-background/42 px-4 py-4 space-y-3">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
        {description && (
          <p className="text-xs leading-5 text-text-muted">{description}</p>
        )}
      </div>
      <div className="space-y-3">
        {children}
      </div>
    </section>
  );
}

// ==================== API Settings Tab (Full version from ConfigModal) ====================

function APISettingsTab() {
  const { t } = useTranslation();
  const {
    provider,
    customProtocol,
    apiKey,
    baseUrl,
    model,
    customModel,
    useCustomModel,
    modelInputPlaceholder,
    modelInputHint,
    presets,
    currentPreset,
    modelOptions,
    isSaving,
    isLoadingConfig,
    error,
    successMessage,
    isTesting,
    testResult,
    useLiveTest,
    enableThinking,
    requiresApiKey,
    configSets,
    activeConfigSetId,
    currentConfigSet,
    pendingConfigSetAction,
    pendingConfigSet,
    hasUnsavedChanges,
    isMutatingConfigSet,
    canDeleteCurrentConfigSet,
    setApiKey,
    setBaseUrl,
    setModel,
    setCustomModel,
    toggleCustomModel,
    setUseLiveTest,
    setEnableThinking,
    changeProvider,
    changeProtocol,
    requestConfigSetSwitch,
    requestCreateBlankConfigSet,
    cancelPendingConfigSetAction,
    saveAndContinuePendingConfigSetAction,
    discardAndContinuePendingConfigSetAction,
    renameConfigSet,
    deleteConfigSet,
    handleSave,
    handleTest,
  } = useApiConfigState();

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
      {/* Config Set Switcher */}
      <ApiConfigSetManager
        configSets={configSets}
        activeConfigSetId={activeConfigSetId}
        currentConfigSet={currentConfigSet}
        pendingConfigSetAction={pendingConfigSetAction}
        pendingConfigSet={pendingConfigSet}
        hasUnsavedChanges={hasUnsavedChanges}
        isMutatingConfigSet={isMutatingConfigSet}
        isSaving={isSaving}
        canDeleteCurrentConfigSet={canDeleteCurrentConfigSet}
        onSwitchSet={requestConfigSetSwitch}
        onRequestCreateBlankSet={requestCreateBlankConfigSet}
        onSaveCurrentSet={handleSave}
        onRenameSet={renameConfigSet}
        onDeleteSet={deleteConfigSet}
        onCancelPendingAction={cancelPendingConfigSetAction}
        onSaveAndContinuePendingAction={saveAndContinuePendingConfigSetAction}
        onDiscardAndContinuePendingAction={discardAndContinuePendingConfigSetAction}
      />

      {/* Provider Selection */}
      <div className="space-y-2 rounded-[1.5rem] border border-border-subtle bg-background/40 px-4 py-4">
        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Server className="w-4 h-4" />
          {t('api.provider')}
        </label>
        <p className="text-xs leading-5 text-text-muted">
          Choose the provider family and the broad protocol style for this workspace.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
          {(['openrouter', 'anthropic', 'openai', 'gemini', 'custom'] as const).map((p) => (
            <button
              key={p}
              onClick={() => changeProvider(p)}
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
      <div className="space-y-2 rounded-[1.5rem] border border-border-subtle bg-background/40 px-4 py-4">
        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Key className="w-4 h-4" />
          {t('api.apiKey')}
        </label>
        <p className="text-xs leading-5 text-text-muted">
          Saved locally and scoped to the active configuration set.
        </p>
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
        <div className="space-y-2 rounded-[1.5rem] border border-border-subtle bg-background/40 px-4 py-4">
          <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Server className="w-4 h-4" />
            {t('api.protocol')}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {([
              { id: 'anthropic', label: 'Anthropic' },
              { id: 'openai', label: 'OpenAI' },
              { id: 'gemini', label: 'Gemini' },
            ] as const).map((mode) => (
              <button
                key={mode.id}
                onClick={() => changeProtocol(mode.id)}
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
        <div className="space-y-2 rounded-[1.5rem] border border-border-subtle bg-background/40 px-4 py-4">
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
                : customProtocol === 'gemini'
                  ? 'https://generativelanguage.googleapis.com'
                : (currentPreset?.baseUrl || 'https://api.anthropic.com')
            }
            className="w-full px-4 py-3 rounded-xl bg-background border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
          />
          <p className="text-xs text-text-muted">
            {customProtocol === 'openai'
              ? t('api.enterOpenAIUrl')
              : customProtocol === 'gemini'
                ? 'Enter a Gemini-compatible base URL'
              : t('api.enterAnthropicUrl')}
          </p>
        </div>
      )}

      {/* Model Selection */}
      <div className="space-y-3 rounded-[1.5rem] border border-border-subtle bg-background/40 px-4 py-4">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Cpu className="w-4 h-4" />
            {t('api.model')}
          </label>
          <button
            type="button"
            onClick={toggleCustomModel}
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
            placeholder={modelInputPlaceholder}
            className="w-full px-4 py-3 rounded-xl bg-background border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
          />
        ) : (
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all appearance-none cursor-pointer"
          >
            {(modelOptions as ModelOptionItem[]).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        {useCustomModel && (
          <p className="text-xs text-text-muted">
            {modelInputHint}
          </p>
        )}
      </div>

      {/* Enable Thinking Mode */}
      <div className="space-y-2 rounded-[1.5rem] border border-border-subtle bg-background/40 px-4 py-4">
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
      {successMessage && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success/10 text-success text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {successMessage}
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
      <div className="space-y-3 rounded-[1.5rem] border border-border-subtle bg-background/40 px-4 py-4">
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
            disabled={isTesting || (requiresApiKey && !apiKey.trim())}
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
            onClick={() => { void handleSave(); }}
            disabled={isSaving || (requiresApiKey && !apiKey.trim())}
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
      <div className="p-6 rounded-xl bg-surface border border-border text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto bg-surface-muted text-text-muted">
          <Shield className="w-8 h-8" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-text-primary">{t('sandbox.enableSandbox')}</h3>
          <p className="text-sm text-text-muted mt-1">
            {isWindows ? t('sandbox.wslDesc') : isMac ? t('sandbox.limaDesc') : t('sandbox.nativeDesc')}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-warning/10 text-warning text-xs font-medium">
          <span>🚧</span>
          <span>{t('sandbox.comingSoon')}</span>
        </div>
        <p className="text-xs text-text-muted max-w-sm mx-auto">
          {t('sandbox.helpText1')} {t('sandbox.helpText2')}
        </p>
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
                <div className="mt-3 p-3 rounded-lg bg-warning/10 text-warning text-xs">
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
                <div className="mt-3 p-3 rounded-lg bg-warning/10 text-warning text-xs">
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

      {/* Help Text - moved into card above */}
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

  const loadCredentials = useCallback(async () => {
    try {
      const loaded = await window.electronAPI.credentials.getAll();
      setCredentials(loaded || []);
      setError('');
    } catch (err) {
      console.error('Failed to load credentials:', err);
      setError(t('credentials.failedToLoad'));
    }
  }, [t]);

  useEffect(() => {
    if (isElectron) {
      void loadCredentials();
    }
  }, [loadCredentials]);

  async function handleSave(credential: CredentialDraft) {
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

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="rounded-[1.5rem] border border-border-subtle bg-background/40 px-4 py-4">
          <CredentialForm
            credential={editingCredential || undefined}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditingCredential(null); }}
            isLoading={isLoading}
          />
        </div>
      )}

      {/* List */}
      {!showForm && (
        <SettingsContentSection
          title={t('credentials.title')}
          description={t('credentials.addCredential')}
        >
          {credentials.length === 0 ? (
            <div className="rounded-[1.5rem] border border-border-subtle bg-background/40 text-center py-8 text-text-muted">
              <Key className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p>{t('credentials.noCredentials')}</p>
              <p className="text-sm mt-1">{t('credentials.addCredential')}</p>
            </div>
          ) : (
            credentials.map((cred) => (
              <div key={cred.id} className="rounded-[1.5rem] border border-border-subtle bg-background/40 p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      cred.type === 'email' ? 'bg-accent/10 text-accent' :
                      cred.type === 'website' ? 'bg-success/10 text-success' :
                      cred.type === 'api' ? 'bg-mcp/10 text-mcp' :
                      'bg-surface-muted text-text-muted'
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
        </SettingsContentSection>
      )}

      {/* Add Button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-3 px-4 rounded-[1.4rem] border-2 border-dashed border-border-subtle hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent"
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
  onSave: (c: CredentialDraft) => void;
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
    <form onSubmit={handleSubmit} className="rounded-[1.4rem] border border-border-subtle bg-background/55 p-4 space-y-4">
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
            onChange={(e) => setType(e.target.value as UserCredential['type'])}
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
  const [tools, setTools] = useState<MCPToolInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [presets, setPresets] = useState<Record<string, MCPPreset>>({});
  const [showPresets, setShowPresets] = useState(true);
  const [configuringPreset, setConfiguringPreset] = useState<{ key: string; preset: MCPPreset } | null>(null);
  const [presetEnvValues, setPresetEnvValues] = useState<Record<string, string>>({});

  // Auto-refresh
  const loadPresets = useCallback(async () => {
    try {
      const loaded = await window.electronAPI.mcp.getPresets() as Record<string, MCPPreset>;
      setPresets(loaded || {});
    } catch (err) {
      console.error('Failed to load presets:', err);
    }
  }, []);

  const loadServers = useCallback(async () => {
    try {
      const loaded = await window.electronAPI.mcp.getServers() as MCPServerConfig[];
      setServers(loaded || []);
      setError('');
    } catch (err) {
      console.error('Failed to load servers:', err);
      setError('Failed to load servers');
    }
  }, []);

  const loadStatuses = useCallback(async () => {
    try {
      const loaded = await window.electronAPI.mcp.getServerStatus() as MCPServerStatus[];
      setStatuses(loaded || []);
    } catch (err) {
      console.error('Failed to load statuses:', err);
    }
  }, []);

  const loadTools = useCallback(async () => {
    try {
      const loaded = await window.electronAPI.mcp.getTools() as MCPToolInfo[];
      setTools(loaded || []);
    } catch (err) {
      console.error('Failed to load tools:', err);
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadServers(), loadStatuses(), loadTools(), loadPresets()]);
  }, [loadPresets, loadServers, loadStatuses, loadTools]);

  useEffect(() => {
    if (!isElectron) {
      return;
    }
    void loadAll();
    const interval = setInterval(() => {
      void loadTools();
      void loadStatuses();
    }, 3000);
    return () => clearInterval(interval);
  }, [loadAll, loadStatuses, loadTools]);

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

  async function addPresetServer(presetKey: string, preset: MCPPreset, envOverrides: Record<string, string>) {
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
            <div className="rounded-[1.5rem] border border-border-subtle bg-background/40 text-center py-8 text-text-muted">
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
        <div className="p-4 rounded-[1.5rem] border border-accent/30 bg-accent/5 space-y-4">
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
                          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-warning/10 text-warning border border-warning/20">
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
  tools: MCPToolInfo[];
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
            <div className="text-sm text-text-muted space-y-1 ml-6 min-w-0">
              {server.type === 'stdio' && (
                <div className="font-mono text-xs truncate" title={`${server.command} ${server.args?.join(' ') || ''}`}>
                  {server.command} {server.args?.join(' ') || ''}
                </div>
              )}
              {server.type === 'sse' && (
                <div className="font-mono text-xs truncate" title={server.url}>{server.url}</div>
              )}
              {/* Chrome hint */}
              {server.name.toLowerCase().includes('chrome') && (
                <div className={`text-xs px-2 py-1.5 rounded-lg ${
                  isConnected 
                    ? 'bg-success/10 text-success' 
                    : server.enabled
                      ? 'bg-warning/10 text-warning'
                      : 'bg-accent/10 text-accent'
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
  const skillsStorageChangedAt = useAppStore((state) => state.skillsStorageChangedAt);
  const skillsStorageChangeEvent = useAppStore((state) => state.skillsStorageChangeEvent);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [storagePath, setStoragePath] = useState('');
  const [plugins, setPlugins] = useState<PluginCatalogItemV2[]>([]);
  const [installedPluginsByKey, setInstalledPluginsByKey] = useState<Record<string, InstalledPlugin>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isPluginLoading, setIsPluginLoading] = useState(false);
  const [isPluginModalOpen, setIsPluginModalOpen] = useState(false);
  const [pluginActionKey, setPluginActionKey] = useState<string | null>(null);
  const [pluginToastMessage, setPluginToastMessage] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const pluginToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const componentOrder: PluginComponentKind[] = ['skills', 'commands', 'agents', 'hooks', 'mcp'];

  function normalizePluginLookupKey(value: string | undefined): string {
    if (!value) {
      return '';
    }
    return value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function getCatalogLookupKeys(plugin: PluginCatalogItemV2): string[] {
    const keys = new Set<string>();
    const addKey = (value: string | undefined) => {
      if (!value) {
        return;
      }
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      keys.add(trimmed);
      keys.add(trimmed.toLowerCase());
      const normalized = normalizePluginLookupKey(trimmed);
      if (normalized) {
        keys.add(normalized);
      }
    };

    addKey(plugin.name);
    addKey(plugin.pluginId);

    const marketplaceId = plugin.pluginId?.split('@')[0];
    addKey(marketplaceId);

    return [...keys];
  }

  useEffect(() => {
    if (!skillsStorageChangeEvent) {
      return;
    }
    if (skillsStorageChangeEvent.reason === 'fallback') {
      setError(t('skills.storagePathFallback'));
      return;
    }
    if (skillsStorageChangeEvent.reason === 'watcher_error') {
      setError(
        t('skills.storageWatcherError', {
          message: skillsStorageChangeEvent.message || '',
        })
      );
    }
  }, [skillsStorageChangeEvent, t]);

  function showPluginInstallToast(message: string) {
    setPluginToastMessage(message);
    if (pluginToastTimerRef.current) {
      clearTimeout(pluginToastTimerRef.current);
    }
    pluginToastTimerRef.current = setTimeout(() => {
      setPluginToastMessage('');
      pluginToastTimerRef.current = null;
    }, 5000);
  }

  const loadSkills = useCallback(async (silent = false) => {
    try {
      const [loaded, nextStoragePath] = await Promise.all([
        window.electronAPI.skills.getAll(),
        window.electronAPI.skills.getStoragePath(),
      ]);
      setSkills(loaded || []);
      setStoragePath(nextStoragePath || '');
      if (!silent) {
        setError('');
      }
    } catch (err) {
      console.error('Failed to load skills:', err);
      if (!silent) {
        setError(t('skills.failedToLoad'));
      }
    }
  }, [t]);

  useEffect(() => {
    if (isElectron) {
      void loadSkills();
    }

    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    if (isElectron) {
      refreshTimer = setInterval(() => {
        void loadSkills(true);
      }, 5000);
    }

    return () => {
      if (pluginToastTimerRef.current) {
        clearTimeout(pluginToastTimerRef.current);
      }
      if (refreshTimer) {
        clearInterval(refreshTimer);
      }
    };
  }, [loadSkills]);

  useEffect(() => {
    if (isElectron && skillsStorageChangedAt > 0) {
      void loadSkills(true);
    }
  }, [loadSkills, skillsStorageChangedAt]);

  async function loadPlugins() {
    try {
      setIsPluginLoading(true);
      const [catalog, installed] = await Promise.all([
        window.electronAPI.plugins.listCatalog({ installableOnly: false }),
        window.electronAPI.plugins.listInstalled(),
      ]);
      setPlugins(catalog || []);
      const nextInstalledByKey: Record<string, InstalledPlugin> = {};
      const addLookupKey = (key: string, plugin: InstalledPlugin) => {
        if (!key || nextInstalledByKey[key]) {
          return;
        }
        nextInstalledByKey[key] = plugin;
      };
      for (const plugin of installed || []) {
        const candidates = [
          plugin.name,
          plugin.name?.toLowerCase(),
          normalizePluginLookupKey(plugin.name),
          plugin.pluginId,
          plugin.pluginId?.toLowerCase(),
          normalizePluginLookupKey(plugin.pluginId),
        ].filter((value): value is string => Boolean(value));
        for (const key of candidates) {
          addLookupKey(key, plugin);
        }
      }
      setInstalledPluginsByKey(nextInstalledByKey);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('skills.pluginInstallFailed'));
    } finally {
      setIsPluginLoading(false);
    }
  }

  async function handleBrowsePlugins() {
    setIsPluginModalOpen(true);
    await loadPlugins();
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
        setSuccess('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('skills.failedToInstall'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectStoragePath() {
    try {
      const folderPath = await window.electronAPI.invoke<string | null>({ type: 'folder.select', payload: {} });
      if (!folderPath) return;

      setIsLoading(true);
      const result = await window.electronAPI.skills.setStoragePath(folderPath, true);
      if (result.success) {
        setStoragePath(result.path);
        await loadSkills(true);
        setError('');
        setSuccess(
          t('skills.storagePathUpdated', {
            migrated: result.migratedCount,
            skipped: result.skippedCount,
          })
        );
        setTimeout(() => setSuccess(''), 5000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('skills.storagePathUpdateFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOpenStoragePath() {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.skills.openStoragePath();
      if (!result.success) {
        setError(result.error || t('skills.storagePathOpenFailed'));
        return;
      }
      setStoragePath(result.path);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('skills.storagePathOpenFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRefreshSkills() {
    setIsLoading(true);
    try {
      await loadSkills(true);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('skills.failedToLoad'));
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
      setError(err instanceof Error ? err.message : t('skills.failedToDelete'));
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
      setError(err instanceof Error ? err.message : t('skills.failedToToggle'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleInstallPlugin(plugin: PluginCatalogItemV2) {
    const installTarget = plugin.pluginId ?? plugin.name;
    setPluginActionKey(`install:${installTarget}`);
    setError('');
    setSuccess('');
    try {
      const result = await window.electronAPI.plugins.install(installTarget);
      await loadSkills();
      await loadPlugins();
      const message = t('skills.pluginInstallSuccess', { name: result.plugin.name });
      setSuccess(message);
      showPluginInstallToast(message);
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('skills.pluginInstallFailed'));
    } finally {
      setPluginActionKey(null);
    }
  }

  async function handleSetPluginEnabled(plugin: InstalledPlugin, enabled: boolean) {
    setPluginActionKey(`enabled:${plugin.pluginId}`);
    setError('');
    try {
      await window.electronAPI.plugins.setEnabled(plugin.pluginId, enabled);
      await loadPlugins();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('skills.pluginInstallFailed'));
    } finally {
      setPluginActionKey(null);
    }
  }

  async function handleSetComponentEnabled(
    plugin: InstalledPlugin,
    component: PluginComponentKind,
    enabled: boolean
  ) {
    setPluginActionKey(`component:${plugin.pluginId}:${component}`);
    setError('');
    try {
      await window.electronAPI.plugins.setComponentEnabled(plugin.pluginId, component, enabled);
      await loadPlugins();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('skills.pluginInstallFailed'));
    } finally {
      setPluginActionKey(null);
    }
  }

  async function handleUninstallPlugin(plugin: InstalledPlugin) {
    if (!confirm(t('skills.pluginUninstall', { name: plugin.name }))) {
      return;
    }

    setPluginActionKey(`uninstall:${plugin.pluginId}`);
    setError('');
    try {
      await window.electronAPI.plugins.uninstall(plugin.pluginId);
      await loadPlugins();
      showPluginInstallToast(t('skills.pluginUninstalled', { name: plugin.name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('skills.pluginInstallFailed'));
    } finally {
      setPluginActionKey(null);
    }
  }

  const builtinSkills = skills.filter(s => s.type === 'builtin');
  const customSkills = skills.filter(s => s.type !== 'builtin');

  return (
    <div className="space-y-4">

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success/10 text-success text-sm">
          <CheckCircle className="w-4 h-4" />
          {success}
        </div>
      )}

      <SettingsContentSection
        title={t('skills.storagePathTitle')}
        description={t('skills.storagePathHint')}
      >
        <div className="text-xs text-text-muted break-all">
          {storagePath || t('skills.storagePathUnavailable')}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <button
            onClick={handleSelectStoragePath}
            disabled={isLoading}
            className="w-full py-2.5 px-3 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent disabled:opacity-50"
          >
            <FolderOpen className="w-4 h-4" />
            {t('skills.selectStoragePath')}
          </button>
          <button
            onClick={handleOpenStoragePath}
            disabled={isLoading}
            className="w-full py-2.5 px-3 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent disabled:opacity-50"
          >
            <Globe className="w-4 h-4" />
            {t('skills.openStoragePath')}
          </button>
          <button
            onClick={handleRefreshSkills}
            disabled={isLoading}
            className="w-full py-2.5 px-3 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" />
            {t('skills.refreshSkills')}
          </button>
        </div>
      </SettingsContentSection>

      {/* Built-in Skills */}
      <SettingsContentSection
        title={t('skills.builtinSkills')}
        description={t('skills.builtinSkillsDesc')}
      >
        {builtinSkills.map(skill => (
          <SkillCard
            key={skill.id}
            skill={skill}
            onToggleEnabled={() => handleToggleEnabled(skill)}
            onDelete={null}
            isLoading={isLoading}
          />
        ))}
      </SettingsContentSection>

      {/* Custom Skills */}
      <SettingsContentSection
        title={t('skills.customSkills')}
        description={t('skills.installSkillsDesc')}
      >
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
      </SettingsContentSection>

      <SettingsContentSection
        title={t('skills.pluginsTitle')}
        description={t('skills.pluginsDesc')}
      >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <button
          onClick={handleBrowsePlugins}
          disabled={isLoading || isPluginLoading}
          className="w-full py-3 px-4 rounded-[1.4rem] border border-border-subtle hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent disabled:opacity-50"
        >
          {isPluginLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Package className="w-5 h-5" />}
          {t('skills.browsePlugins')}
        </button>
        <button
          onClick={handleInstall}
          disabled={isLoading}
          className="w-full py-3 px-4 rounded-[1.4rem] border-2 border-dashed border-border-subtle hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent disabled:opacity-50"
        >
          <Plus className="w-5 h-5" />
          {t('skills.installSkillFromFolder')}
        </button>
      </div>
      </SettingsContentSection>

      {isPluginModalOpen && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[80vh] overflow-hidden rounded-2xl border border-border bg-surface shadow-elevated">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-primary">{t('skills.pluginListTitle')}</h3>
              <button
                onClick={() => setIsPluginModalOpen(false)}
                className="p-2 rounded-lg hover:bg-surface-hover transition-colors"
              >
                <X className="w-5 h-5 text-text-secondary" />
              </button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto max-h-[65vh]">
              {isPluginLoading ? (
                <div className="py-8 flex items-center justify-center gap-2 text-text-secondary">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>{t('common.loading')}</span>
                </div>
              ) : plugins.length === 0 ? (
                <div className="py-8 text-center text-text-muted">{t('skills.noPluginsFound')}</div>
              ) : (
                plugins.map((plugin) => (
                  <div key={plugin.pluginId || plugin.name} className="rounded-xl border border-border bg-surface-hover p-4">
                    {(() => {
                      const installedPlugin = getCatalogLookupKeys(plugin)
                        .map((key) => installedPluginsByKey[key])
                        .find((item): item is InstalledPlugin => Boolean(item));
                      const installTarget = plugin.pluginId ?? plugin.name;
                      const isInstalling = pluginActionKey === `install:${installTarget}`;
                      const componentEntries = componentOrder.filter(
                        (component) => plugin.componentCounts[component] > 0
                      );
                      const isMarketplaceCatalog = plugin.catalogSource === 'claude-marketplace';
                      const hasKnownComponents = componentEntries.length > 0;
                      const isInstallable = plugin.installable;
                      return (
                        <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium text-text-primary truncate">{plugin.name}</h4>
                          {plugin.version && (
                            <span className="text-xs px-2 py-0.5 rounded bg-surface text-text-muted">
                              v{plugin.version}
                            </span>
                          )}
                        </div>
                        {plugin.description && (
                          <p className="text-sm text-text-muted line-clamp-2">{plugin.description}</p>
                        )}
                        {hasKnownComponents ? (
                          <p className="text-xs text-text-muted mt-2">
                            {t('skills.pluginComponents', {
                              skills: plugin.componentCounts.skills,
                              commands: plugin.componentCounts.commands,
                              agents: plugin.componentCounts.agents,
                              hooks: plugin.componentCounts.hooks,
                              mcp: plugin.componentCounts.mcp,
                            })}
                          </p>
                        ) : (
                          isMarketplaceCatalog && !installedPlugin && (
                            <p className="text-xs text-text-muted mt-2">
                              {t('skills.pluginComponentsAvailableAfterInstall')}
                            </p>
                          )
                        )}
                        {hasKnownComponents && plugin.componentCounts.hooks > 0 && !installedPlugin && (
                          <p className="text-xs text-warning mt-1">
                            {t('skills.pluginComponentHooksDisabledByDefault')}
                          </p>
                        )}
                        {hasKnownComponents && plugin.componentCounts.mcp > 0 && !installedPlugin && (
                          <p className="text-xs text-warning mt-1">
                            {t('skills.pluginComponentMcpDisabledByDefault')}
                          </p>
                        )}
                        {!isInstallable && !isMarketplaceCatalog && (
                          <p className="text-xs text-error mt-1">{t('skills.pluginNoComponents')}</p>
                        )}
                      </div>
                      {installedPlugin ? (
                        <span className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-success/10 text-success text-sm">
                          <CheckCircle className="w-4 h-4" />
                          {t('skills.pluginInstalled')}
                        </span>
                      ) : (
                        <button
                          onClick={() => handleInstallPlugin(plugin)}
                          disabled={!isInstallable || pluginActionKey !== null}
                          className="px-3 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                        >
                          {isInstalling ? (
                          <span className="inline-flex items-center gap-1">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {t('common.install')}
                          </span>
                        ) : (
                          t('skills.pluginInstall')
                        )}
                        </button>
                      )}
                    </div>
                    {installedPlugin && (
                      <div className="mt-3 pt-3 border-t border-border space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs text-text-muted">
                            {installedPlugin.enabled ? t('skills.pluginAppliedInRuntime') : t('skills.pluginDisabled')}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleSetPluginEnabled(installedPlugin, !installedPlugin.enabled)}
                              disabled={pluginActionKey !== null}
                              className={`px-3 py-1.5 rounded-md text-xs ${
                                installedPlugin.enabled
                                  ? 'bg-warning/10 text-warning hover:bg-warning/20'
                                  : 'bg-success/10 text-success hover:bg-success/20'
                              } disabled:opacity-50`}
                            >
                              {installedPlugin.enabled ? t('skills.pluginDisable') : t('skills.pluginEnable')}
                            </button>
                            <button
                              onClick={() => handleUninstallPlugin(installedPlugin)}
                              disabled={pluginActionKey !== null}
                              className="px-3 py-1.5 rounded-md text-xs bg-error/10 text-error hover:bg-error/20 disabled:opacity-50"
                            >
                              {t('skills.pluginManageUninstall')}
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1">
                          {componentEntries.map((component) => {
                            const enabled = installedPlugin.componentsEnabled[component];
                            return (
                              <div key={`${installedPlugin.pluginId}:${component}`} className="flex items-center justify-between gap-2">
                                <div className="text-xs text-text-secondary">
                                  <span className="font-medium">{component}</span>
                                  <span className="text-text-muted"> ({plugin.componentCounts[component]})</span>
                                </div>
                                <button
                                  onClick={() => handleSetComponentEnabled(installedPlugin, component, !enabled)}
                                  disabled={pluginActionKey !== null}
                                  className={`px-2 py-1 rounded text-xs ${
                                    enabled
                                      ? 'bg-success/10 text-success hover:bg-success/20'
                                      : 'bg-surface text-text-muted hover:bg-surface-active'
                                  } disabled:opacity-50`}
                                >
                                  {enabled ? t('skills.pluginDisable') : t('skills.pluginEnable')}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                        </>
                      );
                    })()}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {pluginToastMessage && (
        <div className="fixed right-6 bottom-6 z-[80] max-w-md rounded-xl border border-success/30 bg-surface px-4 py-3 shadow-elevated">
          <div className="flex items-start gap-2 text-success text-sm">
            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{pluginToastMessage}</span>
          </div>
        </div>
      )}
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
                ? 'bg-accent/10 text-accent'
                : skill.type === 'mcp'
                  ? 'bg-mcp/10 text-mcp'
                  : 'bg-success/10 text-success'
            }`}>
              {skill.type.toUpperCase()}
            </span>
          </div>
          {skill.description && (
            <p className="text-sm text-text-muted ml-6 line-clamp-2">{skill.description}</p>
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

function ScheduleTab() {
  const workingDir = useAppStore((state) => state.workingDir);
  const sessions = useAppStore((state) => state.sessions);
  const [tasks, setTasks] = useState<ScheduleTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTaskSnapshot, setEditingTaskSnapshot] = useState<ScheduleTask | null>(null);
  const [prompt, setPrompt] = useState('');
  const [cwd, setCwd] = useState('');
  const [runAt, setRunAt] = useState('');
  const [scheduleMode, setScheduleMode] = useState<ScheduleFormMode>('once');
  const [selectedTimes, setSelectedTimes] = useState<string[]>(['08:00']);
  const [selectedWeekdays, setSelectedWeekdays] = useState<ScheduleWeekday[]>([1]);
  const [enabled, setEnabled] = useState(true);
  const [repeatEvery, setRepeatEvery] = useState(1);
  const [repeatUnit, setRepeatUnit] = useState<ScheduleRepeatUnit>('day');
  const promptChangedWhileEditing = Boolean(
    editingTaskSnapshot && prompt.trim() !== editingTaskSnapshot.prompt.trim()
  );
  const scheduleConfig = buildScheduleConfigFromForm(scheduleMode, selectedTimes, selectedWeekdays);
  const schedulePreview = buildSchedulePreview(scheduleMode, runAt, scheduleConfig);
  const selectedWeekdayLabels = selectedWeekdays
    .map((weekday) => WEEKDAY_OPTIONS.find((option) => option.value === weekday)?.label ?? '未知')
    .join(', ');
  const selectedTimeLabels = selectedTimes.join(', ');
  const previewTitle = editingId
    ? (promptChangedWhileEditing
      ? '保存后将基于 Prompt 自动生成 [定时任务] 标题'
      : (editingTaskSnapshot?.title || '保存后将自动生成 [定时任务] 标题'))
    : '保存后将自动生成：[定时任务] + 模型摘要';

  useEffect(() => {
    const defaultRunAt = Date.now() + 5 * 60 * 1000;
    setRunAt(toLocalDateTimeInput(defaultRunAt));
  }, []);

  useEffect(() => {
    if (!cwd) {
      setCwd(workingDir || '');
    }
  }, [workingDir, cwd]);

  useEffect(() => {
    if (!isElectron) return;
    void loadTasks();
  }, []);

  useEffect(() => {
    if (!isElectron) return;
    const interval = setInterval(() => {
      void loadTasks({ silent: true });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  async function loadTasks(options: { silent?: boolean } = {}) {
    if (!isElectron) return;
    const silent = options.silent === true;
    if (!silent) {
      setIsLoading(true);
      setError('');
    }
    try {
      const rows = await window.electronAPI.schedule.list();
      setTasks(rows);
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : '加载定时任务失败');
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }

  async function submitTask() {
    if (!isElectron) return;
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError('请输入要执行的 Prompt');
      return;
    }
    if (scheduleMode === 'daily' && (!scheduleConfig || scheduleConfig.times.length === 0)) {
      setError('请至少选择一个每日执行时段');
      return;
    }
    if (scheduleMode === 'weekly') {
      if (!scheduleConfig || scheduleConfig.kind !== 'weekly' || scheduleConfig.times.length === 0) {
        setError('请至少选择一个每周执行时段');
        return;
      }
      if (scheduleConfig.weekdays.length === 0) {
        setError('请至少选择一个执行星期');
        return;
      }
    }
    const usesDateTimeInput = scheduleMode === 'once' || scheduleMode === 'legacy-interval';
    const runAtValue: number | null = usesDateTimeInput
      ? new Date(runAt).getTime()
      : computeNextScheduledRun(scheduleConfig, Date.now());
    if (runAtValue === null || !Number.isFinite(runAtValue)) {
      setError(usesDateTimeInput ? '请输入有效的执行时间' : '当前规则无法计算下一次执行时间');
      return;
    }
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      if (editingId) {
        const originalRunAtInput = editingTaskSnapshot
          ? toLocalDateTimeInput(editingTaskSnapshot.nextRunAt ?? editingTaskSnapshot.runAt)
          : null;
        const nextScheduleSignature = buildScheduleSignatureFromForm(
          scheduleMode,
          runAt,
          selectedTimes,
          selectedWeekdays,
          repeatEvery,
          repeatUnit
        );
        const originalScheduleSignature = editingTaskSnapshot
          ? buildScheduleSignatureFromTask(editingTaskSnapshot)
          : null;
        const shouldRegenerateTitle = (
          !editingTaskSnapshot ||
          trimmedPrompt !== editingTaskSnapshot.prompt.trim()
        );
        const shouldResetScheduleTime = (
          !editingTaskSnapshot ||
          nextScheduleSignature !== originalScheduleSignature ||
          runAt !== originalRunAtInput ||
          (enabled && editingTaskSnapshot.nextRunAt === null)
        );
        if (shouldResetScheduleTime && runAtValue <= Date.now()) {
          setError('执行时间必须晚于当前时间；如需立刻执行请使用“立即执行”');
          return;
        }
        const payload: ScheduleUpdateInput = {
          cwd: cwd.trim() || workingDir || '',
          enabled,
          scheduleConfig,
          repeatEvery: scheduleMode === 'legacy-interval' ? repeatEvery : null,
          repeatUnit: scheduleMode === 'legacy-interval' ? repeatUnit : null,
        };
        if (shouldRegenerateTitle) {
          payload.prompt = trimmedPrompt;
        }
        if (shouldResetScheduleTime) {
          payload.runAt = runAtValue;
          payload.nextRunAt = runAtValue;
        }
        const updated = await window.electronAPI.schedule.update(editingId, payload);
        if (!updated) {
          throw new Error('任务不存在或已被删除');
        }
        setSuccess('定时任务已更新');
      } else {
        if (runAtValue <= Date.now()) {
          setError('执行时间必须晚于当前时间；如需立刻执行请使用“立即执行”');
          return;
        }
        const payload: ScheduleCreateInput = {
          prompt: trimmedPrompt,
          cwd: cwd.trim() || workingDir || '',
          runAt: runAtValue,
          nextRunAt: runAtValue,
          scheduleConfig,
          enabled,
          repeatEvery: scheduleMode === 'legacy-interval' ? repeatEvery : null,
          repeatUnit: scheduleMode === 'legacy-interval' ? repeatUnit : null,
        };
        await window.electronAPI.schedule.create(payload);
        setSuccess('定时任务已创建');
      }
      clearForm();
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存定时任务失败');
    } finally {
      setIsLoading(false);
    }
  }

  async function toggleTask(task: ScheduleTask) {
    if (!isElectron) return;
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const updated = await window.electronAPI.schedule.toggle(task.id, !task.enabled);
      if (!updated) {
        throw new Error('任务不存在或已被删除');
      }
      setSuccess(updated.enabled ? '任务已启用' : '任务已停用（不会中断已在执行中的会话）');
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换状态失败');
      setIsLoading(false);
    }
  }

  async function runNow(task: ScheduleTask) {
    if (!isElectron) return;
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const updated = await window.electronAPI.schedule.runNow(task.id);
      if (!updated) {
        throw new Error('任务不存在或已被删除');
      }
      setSuccess('已触发立即执行');
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : '立即执行失败');
      setIsLoading(false);
    }
  }

  async function stopTaskRun(task: ScheduleTask) {
    if (!isElectron) return;
    const sessionId = task.lastRunSessionId;
    if (!sessionId) {
      setError('该任务暂无可停止的执行会话');
      return;
    }
    const targetSession = sessions.find((session) => session.id === sessionId);
    if (!targetSession || targetSession.status !== 'running') {
      setError('该任务当前没有正在执行的会话');
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      window.electronAPI.send({
        type: 'session.stop',
        payload: { sessionId },
      });
      setSuccess('已发送停止指令');
    } catch (err) {
      setError(err instanceof Error ? err.message : '停止执行失败');
      setIsLoading(false);
      return;
    }

    await loadTasks({ silent: true });
    setIsLoading(false);
  }

  async function deleteTask(task: ScheduleTask) {
    if (!isElectron) return;
    if (!window.confirm(`确认删除任务「${task.title}」？`)) return;
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      await window.electronAPI.schedule.delete(task.id);
      if (editingId === task.id) {
        clearForm();
      }
      setSuccess('定时任务已删除');
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      setIsLoading(false);
    }
  }

  function editTask(task: ScheduleTask) {
    setEditingId(task.id);
    setEditingTaskSnapshot(task);
    setPrompt(task.prompt);
    setCwd(task.cwd);
    setRunAt(toLocalDateTimeInput(task.nextRunAt ?? task.runAt));
    setEnabled(task.enabled);
    setScheduleMode(detectScheduleMode(task));
    setSelectedTimes(task.scheduleConfig?.times ?? ['08:00']);
    setSelectedWeekdays(
      task.scheduleConfig?.kind === 'weekly' ? task.scheduleConfig.weekdays : [1]
    );
    setRepeatEvery(task.repeatEvery ?? 1);
    setRepeatUnit(task.repeatUnit ?? 'day');
    setError('');
    setSuccess('');
  }

  function clearForm() {
    const defaultRunAt = Date.now() + 5 * 60 * 1000;
    setEditingId(null);
    setEditingTaskSnapshot(null);
    setPrompt('');
    setCwd(workingDir || '');
    setRunAt(toLocalDateTimeInput(defaultRunAt));
    setScheduleMode('once');
    setSelectedTimes(['08:00']);
    setSelectedWeekdays([1]);
    setEnabled(true);
    setRepeatEvery(1);
    setRepeatUnit('day');
  }

  return (
    <div className="space-y-4">
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

      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {editingId ? '编辑定时任务' : '新建定时任务'}
        </h4>
        <div className="rounded-lg border border-border bg-background px-3 py-2">
          <div className="text-xs text-text-muted mb-1">自动标题（用于会话区分）</div>
          <div className="text-sm text-text-primary break-all">{previewTitle}</div>
          {editingId && (
            <div className="text-xs text-text-muted mt-2">
              {promptChangedWhileEditing
                ? '检测到 Prompt 已修改，保存后会重新生成标题。'
                : '未修改 Prompt 时将保留现有标题。'}
            </div>
          )}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="到点后自动执行的 Prompt"
          rows={3}
          className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm"
        />
        <input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="执行目录（默认当前工作目录）"
          className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm"
        />
        <div className="rounded-lg border border-border bg-background p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-text-primary">执行时间</div>
              <div className="text-xs text-text-muted">
                新任务优先使用多时段模式，旧版间隔任务仍可兼容编辑
              </div>
            </div>
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              启用
            </label>
          </div>
          <div className={`grid gap-2 ${scheduleMode === 'weekly' ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
            <ScheduleSelectMenu
              label="执行模式"
              options={SCHEDULE_MODE_OPTIONS}
              value={scheduleMode}
              onChange={(value) => setScheduleMode(value as ScheduleFormMode)}
            />
            {scheduleMode === 'weekly' && (
              <ScheduleSelectMenu
                label="执行星期"
                options={WEEKDAY_OPTIONS}
                values={selectedWeekdays}
                placeholder="选择星期"
                summary={selectedWeekdayLabels}
                onToggle={(value) => {
                  setSelectedWeekdays((current) => toggleWeekdayValue(current, value as ScheduleWeekday));
                }}
              />
            )}
            {(scheduleMode === 'daily' || scheduleMode === 'weekly') && (
              <TimeMultiSelectMenu
                label="执行时段"
                values={selectedTimes}
                placeholder="选择时间"
                summary={selectedTimeLabels}
                onAdd={(value) => setSelectedTimes((current) => toggleTimeValue(current, value))}
                onRemove={(value) => setSelectedTimes((current) => toggleTimeValue(current, value))}
              />
            )}
          </div>
          {scheduleMode === 'legacy-interval' && (
            <div className="rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">
              当前任务来自旧版“固定间隔”规则，保存时会继续保留该模式。
            </div>
          )}
          {(scheduleMode === 'once' || scheduleMode === 'legacy-interval') && (
            <div className="space-y-2">
              <div className="text-xs text-text-muted">
                {scheduleMode === 'once' ? '选择单次执行时间' : '选择旧版间隔任务的起始时间'}
              </div>
              <input
                type="datetime-local"
                value={runAt}
                onChange={(e) => setRunAt(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm"
              />
            </div>
          )}
          {scheduleMode === 'legacy-interval' && (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min={1}
                value={repeatEvery}
                onChange={(e) => setRepeatEvery(Math.max(1, Number(e.target.value) || 1))}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm"
              />
              <select
                value={repeatUnit}
                onChange={(e) => setRepeatUnit(e.target.value as ScheduleRepeatUnit)}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm"
              >
                <option value="minute">分钟</option>
                <option value="hour">小时</option>
                <option value="day">天</option>
              </select>
            </div>
          )}
          {scheduleMode === 'daily' && (
            <div className="text-xs text-text-muted">每天在这些时段自动执行</div>
          )}
          {scheduleMode === 'weekly' && (
            <div className="text-xs text-text-muted">每周在选中的星期与时段自动执行</div>
          )}
          <div className="text-xs text-text-muted">{schedulePreview}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={submitTask}
            disabled={isLoading}
            className="px-3 py-2 rounded-lg bg-accent text-white text-sm disabled:opacity-50"
          >
            {editingId ? '保存修改' : '创建任务'}
          </button>
          {editingId && (
            <button
              onClick={clearForm}
              disabled={isLoading}
              className="px-3 py-2 rounded-lg bg-surface-hover text-text-secondary text-sm disabled:opacity-50"
            >
              取消编辑
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-text-muted">
          说明：停用仅阻止后续自动触发，已开始执行的会话需在会话列表中手动停止。
        </div>
        {tasks.length === 0 ? (
          <div className="text-sm text-text-muted text-center py-6 border border-dashed border-border rounded-xl">
            暂无定时任务
          </div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="rounded-xl border border-border bg-surface p-3 space-y-2">
              {(() => {
                const lastRunSession = task.lastRunSessionId
                  ? sessions.find((session) => session.id === task.lastRunSessionId) ?? null
                  : null;
                const isTaskRunning = lastRunSession?.status === 'running';
                const lastRunStatusLabel = lastRunSession
                  ? (isTaskRunning ? '运行中' : '已结束')
                  : (task.lastRunSessionId ? '未知' : '无');
                return (
                  <>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm text-text-primary truncate">{task.title}</div>
                  <div className="text-xs text-text-muted truncate">{task.prompt}</div>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${task.enabled ? 'bg-success/10 text-success' : 'bg-surface-hover text-text-muted'}`}>
                  {task.enabled ? '已启用' : '已停用'}
                </span>
              </div>
              <div className="text-xs text-text-muted">
                下次执行：{task.nextRunAt === null ? '无' : formatTime(task.nextRunAt)}
              </div>
              <div className="text-xs text-text-muted">
                执行策略：{formatScheduleRule(task)}
              </div>
              <div className="text-xs text-text-muted">
                上次执行：{task.lastRunAt === null ? '尚未执行' : formatTime(task.lastRunAt)}
              </div>
              {task.lastRunSessionId && (
                <div className="text-xs text-text-muted break-all">
                  最近会话：{task.lastRunSessionId}
                </div>
              )}
              <div className="text-xs text-text-muted">
                会话状态：{lastRunStatusLabel}
              </div>
              <div className="text-xs text-text-muted truncate" title={task.cwd}>
                目录：{task.cwd}
              </div>
              {task.lastError && (
                <div className="text-xs text-error break-all">最近错误：{task.lastError}</div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => toggleTask(task)}
                  disabled={isLoading}
                  className="px-2 py-1 rounded bg-surface-hover text-xs text-text-secondary disabled:opacity-50"
                >
                  {task.enabled ? '停用' : '启用'}
                </button>
                <button
                  onClick={() => runNow(task)}
                  disabled={isLoading}
                  className="px-2 py-1 rounded bg-surface-hover text-xs text-text-secondary disabled:opacity-50"
                >
                  立即执行
                </button>
                <button
                  onClick={() => stopTaskRun(task)}
                  disabled={isLoading || !isTaskRunning}
                  title={isTaskRunning ? '停止该任务最近一次执行会话' : '该任务当前没有正在执行的会话'}
                  className={`px-2 py-1 rounded text-xs disabled:opacity-50 ${
                    isTaskRunning
                      ? 'bg-warning/10 text-warning'
                      : 'bg-surface-hover text-text-muted'
                  }`}
                >
                  停止执行
                </button>
                <button
                  onClick={() => editTask(task)}
                  disabled={isLoading}
                  className="px-2 py-1 rounded bg-surface-hover text-xs text-text-secondary disabled:opacity-50"
                >
                  编辑
                </button>
                <button
                  onClick={() => deleteTask(task)}
                  disabled={isLoading}
                  className="px-2 py-1 rounded bg-error/10 text-xs text-error disabled:opacity-50"
                >
                  删除
                </button>
              </div>
                  </>
                );
              })()}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function toLocalDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function formatScheduleRule(task: ScheduleTask): string {
  if (task.scheduleConfig?.kind === 'daily') {
    return `每天 ${task.scheduleConfig.times.join('、')}`;
  }
  if (task.scheduleConfig?.kind === 'weekly') {
    const weekdays = task.scheduleConfig.weekdays
      .map((weekday) => WEEKDAY_OPTIONS.find((option) => option.value === weekday)?.label ?? '未知')
      .join('、');
    return `每周 ${weekdays} · ${task.scheduleConfig.times.join('、')}`;
  }
  if (!task.repeatEvery || !task.repeatUnit) {
    return '一次性';
  }
  if (task.repeatUnit === 'minute') {
    return `每 ${task.repeatEvery} 分钟`;
  }
  if (task.repeatUnit === 'hour') {
    return `每 ${task.repeatEvery} 小时`;
  }
  return `每 ${task.repeatEvery} 天`;
}

function ScheduleSelectMenu(props: {
  label: string;
  options: Array<{ value: string | number; label: string }>;
  value?: string | number;
  values?: Array<string | number>;
  placeholder?: string;
  summary?: string;
  onChange?: (value: string | number) => void;
  onToggle?: (value: string | number) => void;
}) {
  const {
    label,
    options,
    value,
    values = [],
    placeholder = '请选择',
    summary,
    onChange,
    onToggle,
  } = props;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isMulti = typeof onToggle === 'function';
  const buttonText = summary || (
    isMulti
      ? (values.length > 0
        ? values
          .map((item) => options.find((option) => option.value === item)?.label ?? String(item))
          .join(', ')
        : placeholder)
      : (options.find((option) => option.value === value)?.label ?? placeholder)
  );

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="mb-1 text-xs text-text-muted">{label}</div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
          open
            ? 'border-accent bg-surface text-text-primary'
            : 'border-border bg-surface text-text-secondary hover:bg-surface-hover'
        }`}
      >
        <span className="truncate">{buttonText}</span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-elevated">
          {options.map((option) => {
            const selected = isMulti
              ? values.includes(option.value)
              : option.value === value;
            return (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => {
                  if (isMulti) {
                    onToggle?.(option.value);
                    return;
                  }
                  onChange?.(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                  selected
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-secondary hover:bg-surface-hover'
                }`}
              >
                <span>{option.label}</span>
                {selected && <Check className="h-4 w-4" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TimeMultiSelectMenu(props: {
  label: string;
  values: string[];
  placeholder?: string;
  summary?: string;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const {
    label,
    values,
    placeholder = '选择时间',
    summary,
    onAdd,
    onRemove,
  } = props;
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [draftTime, setDraftTime] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonText = summary || (values.length > 0 ? values.join(', ') : placeholder);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    function updatePlacement() {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const estimatedPanelHeight = 420;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUpward(spaceBelow < estimatedPanelHeight && spaceAbove > spaceBelow);
    }

    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [open]);

  function addDraftTime() {
    if (!isValidTimeValue(draftTime)) {
      return;
    }
    onAdd(draftTime);
    setDraftTime('');
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="mb-1 text-xs text-text-muted">{label}</div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
          open
            ? 'border-accent bg-surface text-text-primary'
            : 'border-border bg-surface text-text-secondary hover:bg-surface-hover'
        }`}
      >
        <span className="truncate">{buttonText}</span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className={`absolute right-0 z-20 w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border/80 bg-surface p-3 shadow-[0_24px_60px_rgba(0,0,0,0.14)] ${
          openUpward ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'
        }`}>
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-text-primary">编辑时段</div>
                  <div className="text-xs text-text-muted">支持输入任意 `HH:mm`</div>
                </div>
                {values.length > 0 && (
                  <div className="text-xs text-text-muted">{values.length} 个已选</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  step={60}
                  value={draftTime}
                  onChange={(event) => setDraftTime(event.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm text-text-primary"
                />
                <button
                  type="button"
                  onClick={addDraftTime}
                  disabled={!isValidTimeValue(draftTime)}
                  className="inline-flex min-w-[92px] flex-shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  添加
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-text-muted">已选时段</div>
              {values.length > 0 ? (
                <div className="flex flex-wrap gap-2 rounded-xl bg-background/60 p-2">
                  {values.map((time) => (
                    <button
                      key={time}
                      type="button"
                      onClick={() => onRemove(time)}
                      className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-surface px-3 py-1 text-sm text-accent shadow-sm"
                    >
                      <span>{time}</span>
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl bg-background/60 px-3 py-2 text-xs text-text-muted">
                  还没有选择时段
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="text-xs text-text-muted">常用建议</div>
              <div className="flex flex-wrap gap-2">
                {SCHEDULE_TIME_SUGGESTIONS.map((time) => {
                  const selected = values.includes(time);
                  return (
                    <button
                      key={time}
                      type="button"
                      onClick={() => {
                        if (selected) {
                          onRemove(time);
                          return;
                        }
                        onAdd(time);
                      }}
                      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        selected
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border bg-background text-text-secondary hover:bg-surface-hover'
                      }`}
                    >
                      {time}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function detectScheduleMode(task: ScheduleTask): ScheduleFormMode {
  if (task.scheduleConfig?.kind === 'daily') {
    return 'daily';
  }
  if (task.scheduleConfig?.kind === 'weekly') {
    return 'weekly';
  }
  if (task.repeatEvery && task.repeatUnit) {
    return 'legacy-interval';
  }
  return 'once';
}

function buildScheduleConfigFromForm(
  mode: ScheduleFormMode,
  times: string[],
  weekdays: ScheduleWeekday[]
): ScheduleConfig | null {
  const normalizedTimes = Array.from(new Set(times)).sort();
  if (mode === 'daily' && normalizedTimes.length > 0) {
    return { kind: 'daily', times: normalizedTimes };
  }
  if (mode === 'weekly' && normalizedTimes.length > 0 && weekdays.length > 0) {
    return {
      kind: 'weekly',
      weekdays: Array.from(new Set(weekdays)).sort((left, right) => left - right),
      times: normalizedTimes,
    };
  }
  return null;
}

function buildScheduleSignatureFromTask(task: ScheduleTask): string {
  if (task.scheduleConfig) {
    return JSON.stringify(task.scheduleConfig);
  }
  if (task.repeatEvery && task.repeatUnit) {
    return JSON.stringify({
      mode: 'legacy-interval',
      runAt: toLocalDateTimeInput(task.nextRunAt ?? task.runAt),
      repeatEvery: task.repeatEvery,
      repeatUnit: task.repeatUnit,
    });
  }
  return JSON.stringify({
    mode: 'once',
    runAt: toLocalDateTimeInput(task.nextRunAt ?? task.runAt),
  });
}

function buildScheduleSignatureFromForm(
  mode: ScheduleFormMode,
  runAt: string,
  times: string[],
  weekdays: ScheduleWeekday[],
  repeatEvery: number,
  repeatUnit: ScheduleRepeatUnit
): string {
  if (mode === 'daily' || mode === 'weekly') {
    return JSON.stringify(buildScheduleConfigFromForm(mode, times, weekdays));
  }
  if (mode === 'legacy-interval') {
    return JSON.stringify({ mode, runAt, repeatEvery, repeatUnit });
  }
  return JSON.stringify({ mode, runAt });
}

function buildSchedulePreview(
  mode: ScheduleFormMode,
  runAt: string,
  scheduleConfig: ScheduleConfig | null
): string {
  if (mode === 'once' || mode === 'legacy-interval') {
    const timestamp = new Date(runAt).getTime();
    return Number.isFinite(timestamp)
      ? `下次预计执行：${formatTime(timestamp)}`
      : '请选择有效的执行时间';
  }
  const nextRunAt = computeNextScheduledRun(scheduleConfig, Date.now());
  return nextRunAt === null
    ? '请至少选择一个有效时段'
    : `系统将自动找到下一档执行时间：${formatTime(nextRunAt)}`;
}

function computeNextScheduledRun(
  scheduleConfig: ScheduleConfig | null,
  now: number
): number | null {
  if (!scheduleConfig || scheduleConfig.times.length === 0) {
    return null;
  }
  const allowedWeekdays = scheduleConfig.kind === 'weekly'
    ? new Set(scheduleConfig.weekdays)
    : null;
  const nowDate = new Date(now);

  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const candidateDate = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate() + dayOffset,
      0,
      0,
      0,
      0
    );
    if (allowedWeekdays && !allowedWeekdays.has(candidateDate.getDay() as ScheduleWeekday)) {
      continue;
    }
    for (const time of scheduleConfig.times) {
      const [hour, minute] = time.split(':').map(Number);
      const candidate = new Date(
        candidateDate.getFullYear(),
        candidateDate.getMonth(),
        candidateDate.getDate(),
        hour,
        minute,
        0,
        0
      ).getTime();
      if (candidate > now) {
        return candidate;
      }
    }
  }

  return null;
}

function toggleTimeValue(current: string[], target: string): string[] {
  if (!isValidTimeValue(target)) {
    return current;
  }
  const next = current.includes(target)
    ? current.filter((value) => value !== target)
    : [...current, target];
  return next.sort();
}

function toggleWeekdayValue(
  current: ScheduleWeekday[],
  target: ScheduleWeekday
): ScheduleWeekday[] {
  const next = current.includes(target)
    ? current.filter((value) => value !== target)
    : [...current, target];
  return next.sort((left, right) => left - right);
}

function isValidTimeValue(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

// ==================== General Tab ====================

function GeneralTab() {
  const { i18n, t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const currentLang = i18n.language.startsWith('zh') ? 'zh' : 'en';
  const [appVer, setAppVer] = useState('');
  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVer);
      else if (v) setAppVer(v);
    } catch { /* ignore */ }
  }, []);

  const languages = [
    { code: 'en', nativeName: 'English' },
    { code: 'zh', nativeName: '中文' },
  ];

  const themeOptions = [
    { value: 'light' as const, label: t('general.themeLight') },
    { value: 'dark' as const, label: t('general.themeDark') },
  ];

  return (
    <div className="space-y-6">
      {/* Theme */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.appearance')}</h4>
        <div className="flex gap-2">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateSettings({ theme: opt.value })}
              className={`flex-1 px-4 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                settings.theme === opt.value
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Language */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.language')}</h4>
        <div className="flex gap-2">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => i18n.changeLanguage(lang.code)}
              className={`flex-1 px-4 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                currentLang === lang.code
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {lang.nativeName}
            </button>
          ))}
        </div>
      </div>

      {/* About */}
      {appVer && (
        <div className="pt-4 border-t border-border">
          <p className="text-xs text-text-muted">Open Cowork v{appVer}</p>
        </div>
      )}
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

  const loadLogs = useCallback(async () => {
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
  }, [t]);

  const loadDevLogsStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI.logs.isEnabled();
      if (result.success && typeof result.enabled === 'boolean') {
        setDevLogsEnabled(result.enabled);
      }
    } catch (err) {
      console.error('Failed to load dev logs status:', err);
    }
  }, []);

  useEffect(() => {
    if (!isElectron) {
      return;
    }
    void loadLogs();
    void loadDevLogsStatus();
    const interval = setInterval(() => {
      void loadLogs();
    }, 3000);
    return () => clearInterval(interval);
  }, [loadDevLogsStatus, loadLogs]);

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
      <section className="rounded-[1.6rem] border border-border-subtle bg-background/42 px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-text-primary">{t('logs.enableDevLogs')}</h4>
            <p className="mt-1 text-xs leading-5 text-text-muted">{t('logs.enableDevLogsDesc')}</p>
          </div>
          <button
            onClick={handleToggleDevLogs}
            disabled={isLoading}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-50 flex-shrink-0 ${
              devLogsEnabled ? 'bg-accent' : 'bg-surface-muted'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-text-primary transition-transform ${
                devLogsEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </section>

      {/* Stats */}
      <SettingsContentSection
        title={t('logs.logFiles')}
        description="Current log inventory and storage footprint."
      >
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 rounded-[1.5rem] bg-background/40 border border-border-subtle">
          <div className="text-2xl font-bold text-text-primary">{logFiles.length}</div>
          <div className="text-sm text-text-muted">{t('logs.logFiles')}</div>
        </div>
        <div className="p-4 rounded-[1.5rem] bg-background/40 border border-border-subtle">
          <div className="text-2xl font-bold text-text-primary">{formatFileSize(totalSize)}</div>
          <div className="text-sm text-text-muted">{t('logs.totalSize')}</div>
        </div>
      </div>
      </SettingsContentSection>

      {/* Log Files List */}
      <SettingsContentSection
        title={t('logs.logFiles')}
        description="Recent application logs available for export or inspection."
      >
        {logFiles.length === 0 ? (
          <div className="text-center py-8 text-text-muted">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>{t('logs.noLogFiles')}</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {logFiles.map((file) => (
              <div key={file.path} className="p-3 rounded-xl bg-background/45 border border-border-subtle">
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
      </SettingsContentSection>

      {/* Directory Path */}
      {logsDirectory && (
        <SettingsContentSection
          title={t('logs.logsDirectory')}
          description="Current on-disk location for application logs."
        >
        <div className="p-3 rounded-xl bg-background/45 border border-border-subtle">
          <div className="text-xs text-text-muted mb-1">{t('logs.logsDirectory')}</div>
          <div className="font-mono text-xs text-text-secondary break-all">{logsDirectory}</div>
        </div>
        </SettingsContentSection>
      )}

      {/* Action Buttons */}
      <SettingsContentSection
        title={t('logs.actionsTitle')}
        description="Export, reveal, or clear log files."
      >
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
          className="py-3 px-4 rounded-[1.4rem] bg-background/45 border border-border-subtle text-text-primary font-medium hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
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
      </SettingsContentSection>

      {/* Help Text */}
      <div className="text-xs text-text-muted text-center space-y-1">
        <p>{t('logs.helpText1')}</p>
        <p>{t('logs.helpText2')}</p>
      </div>
    </div>
  );
}
