import { useEffect } from 'react';
import { X, Key, Server, Cpu, CheckCircle, AlertCircle, Loader2, Edit3, Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppConfig, ApiTestResult } from '../types';
import { useApiConfigState } from '../hooks/useApiConfigState';
import { ApiConfigSetManager } from './ApiConfigSetManager';

interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: Partial<AppConfig>) => Promise<void>;
  initialConfig?: AppConfig | null;
  isFirstRun?: boolean;
}

const PROVIDER_LABELS: Record<'openrouter' | 'anthropic' | 'openai' | 'gemini' | 'custom', string> = {
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  custom: 'Custom',
};

export function ConfigModal({ isOpen, onClose, onSave, initialConfig, isFirstRun }: ConfigModalProps) {
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
    error,
    successMessage,
    isTesting,
    testResult,
    useLiveTest,
    requiresApiKey,
    showsCompatibilityProbeHint,
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
  } = useApiConfigState({
    enabled: isOpen,
    initialConfig,
    onSave,
  });

  useEffect(() => {
    if (!successMessage || successMessage !== t('common.saved')) {
      return;
    }
    const timer = setTimeout(() => {
      onClose();
    }, 1000);
    return () => clearTimeout(timer);
  }, [onClose, successMessage, t]);

  if (!isOpen) return null;

  const testErrorMessage = (result: ApiTestResult) => {
    switch (result.errorType) {
      case 'missing_key':
        return t('api.testError.missing_key');
      case 'missing_base_url':
        return t('api.testError.missing_base_url');
      case 'unauthorized':
        return t('api.testError.unauthorized');
      case 'not_found':
        return t('api.testError.not_found');
      case 'rate_limited':
        return t('api.testError.rate_limited');
      case 'server_error':
        return t('api.testError.server_error');
      case 'network_error':
        return t('api.testError.network_error');
      case 'proxy_boot_failed':
        return t('api.testError.proxy_boot_failed');
      case 'proxy_health_failed':
        return t('api.testError.proxy_health_failed');
      case 'proxy_upstream_auth_failed':
        return t('api.testError.proxy_upstream_auth_failed');
      case 'proxy_upstream_not_found':
        return t('api.testError.proxy_upstream_not_found');
      default:
        return t('api.testError.unknown');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md">
      <div className="bg-background rounded-[2rem] shadow-elevated w-full max-w-[880px] mx-4 max-h-[88vh] overflow-hidden border border-border-subtle flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-muted bg-background/88">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl border border-border-subtle bg-background-secondary/88 flex items-center justify-center text-accent">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
                {t('settings.title')}
              </p>
              <h2 className="mt-1 text-[1.15rem] font-semibold tracking-[-0.02em] text-text-primary">
                {isFirstRun ? t('api.firstRunTitle') : t('api.settingsTitle')}
              </h2>
              <p className="text-sm text-text-secondary">
                {isFirstRun ? t('api.firstRunSubtitle') : t('api.settingsSubtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-surface-hover transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 flex-1 overflow-y-auto bg-background/70">
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
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <Server className="w-4 h-4" />
              {t('api.provider')}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(['openrouter', 'anthropic', 'openai', 'gemini', 'custom'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => changeProvider(p)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    provider === p
                      ? 'bg-accent text-white'
                      : 'bg-surface-hover text-text-secondary hover:bg-surface-active'
                  }`}
                >
                  {presets?.[p]?.name || PROVIDER_LABELS[p] || p}
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
              placeholder={currentPreset?.keyPlaceholder || t('api.enterApiKey')}
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
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: 'anthropic', label: 'Anthropic' },
                  { id: 'openai', label: 'OpenAI' },
                  { id: 'gemini', label: 'Gemini' },
                ] as const).map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => changeProtocol(mode.id)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
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

          {/* Base URL - Editable for custom provider */}
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
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Cpu className="w-4 h-4" />
                {t('api.model')}
              </label>
              <button
                type="button"
                onClick={toggleCustomModel}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-all ${
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
                {modelOptions.length ? (
                  modelOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))
                ) : (
                  <option value="" disabled>
                    {t('api.noModelsAvailable')}
                  </option>
                )}
              </select>
            )}
            {useCustomModel && (
              <p className="text-xs text-text-muted">
                {modelInputHint}
              </p>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-error/10 text-error text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
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
                    : testErrorMessage(testResult)}
                </div>
                {!testResult.ok && testResult.details && (
                  <div className="mt-1 text-xs text-text-muted">{testResult.details}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-surface-hover border-t border-border">
          {successMessage && (
            <div className="mb-3 flex items-center gap-2 px-4 py-3 rounded-xl bg-success/10 text-success text-sm">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              {successMessage}
            </div>
          )}
          <div className="flex items-start gap-2 text-xs text-text-muted mb-3">
            <input
              type="checkbox"
              id="api-live-test-modal"
              checked={useLiveTest}
              onChange={(e) => setUseLiveTest(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-border text-accent focus:ring-accent"
            />
            <label htmlFor="api-live-test-modal" className="space-y-0.5">
              <div className="text-text-primary">{t('api.liveTest')}</div>
              <div>{t('api.liveTestHint')}</div>
              {showsCompatibilityProbeHint && (
                <div>{t('api.liveTestCompatibilityHint')}</div>
              )}
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleTest}
              disabled={isTesting || (requiresApiKey && !apiKey.trim())}
              className="w-full py-3 px-4 rounded-xl border border-border bg-surface text-text-primary font-medium hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
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
              className="w-full py-3 px-4 rounded-xl bg-accent text-white font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('common.saving')}
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  {isFirstRun ? t('api.getStarted') : t('api.saveSettings')}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
