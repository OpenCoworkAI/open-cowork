import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Key,
  Plug,
  Server,
  Cpu,
  Loader2,
  Edit3,
  Save,
  Mail,
  Globe,
  Lock,
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
  Trash2,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useApiConfigState } from '../../hooks/useApiConfigState';
import { ApiConfigSetManager } from '../ApiConfigSetManager';
import { CommonProviderSetupsCard, GuidanceInlineHint } from '../ProviderGuidance';
import ApiDiagnosticsPanel from '../ApiDiagnosticsPanel';
import { CodexAuthPanel } from '../CodexAuthPanel';
import { SettingsContentSection, SERVICE_OPTIONS } from './shared';
import type { UserCredential, CredentialDraft } from './shared';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

interface ModelOptionItem {
  id: string;
  name: string;
}

// ==================== API Settings Tab ====================

export function SettingsAPI() {
  const { t } = useTranslation();
  const {
    provider,
    customProtocol,
    apiKey,
    baseUrl,
    model,
    customModel,
    useCustomModel,
    contextWindow,
    maxTokens,
    modelInputPlaceholder,
    modelInputHint,
    presets,
    currentPreset,
    modelOptions,
    isSaving,
    isLoadingConfig,
    error,
    successMessage,
    isRefreshingModels,
    isDiscoveringLocalOllama,
    enableThinking,
    isOllamaMode,
    isCodexMode,
    codexPath,
    requiresApiKey,
    protocolGuidanceText,
    protocolGuidanceTone,
    baseUrlGuidanceText,
    commonProviderSetups,
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
    setContextWindow,
    setMaxTokens,
    toggleCustomModel,
    setEnableThinking,
    setCodexPath,
    applyCommonProviderSetup,
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
    refreshModelOptions,
    discoverLocalOllama,
    diagnosticResult,
    isDiagnosing,
    handleDiagnose,
    handleDeepDiagnose,
    shouldShowOllamaManualModelToggle,
  } = useApiConfigState();

  if (isLoadingConfig) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
        <span className="ml-2 text-text-secondary">{t('common.loading')}</span>
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
      <div className="space-y-3 py-5 border-b border-border-muted">
        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Server className="w-4 h-4" />
          {t('api.provider')}
        </label>
        <p className="text-xs leading-5 text-text-muted">{t('api.providerDescription')}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-2">
          {(
            [
              'openrouter',
              'anthropic',
              'openai',
              'gemini',
              'ollama',
              'codex_chatgpt',
              'custom',
            ] as const
          ).map((p) => (
            <button
              key={p}
              onClick={() => changeProvider(p)}
              disabled={isLoadingConfig}
              className={`px-3 py-2 rounded-lg text-sm transition-colors border ${
                provider === p
                  ? 'border-accent bg-accent/10 text-accent font-medium'
                  : 'border-border-muted text-text-secondary hover:border-border hover:text-text-primary disabled:opacity-50'
              }`}
            >
              {p === 'custom' ? t('api.moreModels') : presets?.[p]?.name || p}
            </button>
          ))}
        </div>
      </div>

      {isCodexMode ? (
        <CodexAuthPanel codexPath={codexPath} setCodexPath={setCodexPath} />
      ) : (
        <div className="space-y-3 py-5 border-b border-border-muted">
          <label
            htmlFor="api-key-input"
            className="flex items-center gap-2 text-sm font-medium text-text-primary"
          >
            <Key className="w-4 h-4" />
            {t('api.apiKey')}
          </label>
          <p className="text-xs leading-5 text-text-muted">{t('api.apiKeyDescription')}</p>
          <input
            id="api-key-input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={currentPreset?.keyPlaceholder || t('api.enterApiKey')}
            className="w-full px-4 py-3 rounded-lg bg-background border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
          />
          {currentPreset?.keyHint && (
            <p className="text-xs text-text-muted">{currentPreset.keyHint}</p>
          )}
        </div>
      )}

      {/* Custom Protocol */}
      {provider === 'custom' && (
        <div className="space-y-3 py-5 border-b border-border-muted">
          <label
            id="api-protocol-label"
            className="flex items-center gap-2 text-sm font-medium text-text-primary"
          >
            <Server className="w-4 h-4" />
            {t('api.protocol')}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(
              [
                { id: 'anthropic', label: 'Anthropic' },
                { id: 'openai', label: 'OpenAI' },
                { id: 'gemini', label: 'Gemini' },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                onClick={() => changeProtocol(mode.id)}
                className={`px-3 py-2 rounded-lg text-sm transition-colors border ${
                  customProtocol === mode.id
                    ? 'border-accent bg-accent/10 text-accent font-medium'
                    : 'border-border-muted text-text-secondary hover:border-border hover:text-text-primary'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-muted">{t('api.selectProtocol')}</p>
          <GuidanceInlineHint text={protocolGuidanceText} tone={protocolGuidanceTone} />
        </div>
      )}

      {(provider === 'custom' || provider === 'ollama') && (
        <div className="space-y-3 py-5 border-b border-border-muted">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="api-base-url-input"
              className="flex items-center gap-2 text-sm font-medium text-text-primary"
            >
              <Server className="w-4 h-4" />
              {t('api.baseUrl')}
            </label>
            {isOllamaMode && (
              <button
                type="button"
                onClick={() => {
                  void discoverLocalOllama();
                }}
                disabled={isDiscoveringLocalOllama}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors active:scale-95 bg-accent-muted text-accent hover:bg-accent-muted/80 disabled:opacity-50"
              >
                <Plug className="w-3 h-3" />
                {isDiscoveringLocalOllama
                  ? t('api.discoveringLocalOllama')
                  : t('api.discoverLocalOllama')}
              </button>
            )}
          </div>
          <input
            id="api-base-url-input"
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={
              provider === 'ollama'
                ? 'http://localhost:11434/v1'
                : customProtocol === 'openai'
                  ? 'https://api.openai.com/v1'
                  : customProtocol === 'gemini'
                    ? 'https://generativelanguage.googleapis.com'
                    : currentPreset?.baseUrl || 'https://api.anthropic.com'
            }
            className="w-full px-4 py-3 rounded-lg bg-background border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
          />
          <p className="text-xs text-text-muted">
            {provider === 'ollama'
              ? t('api.enterOllamaUrl')
              : customProtocol === 'openai'
                ? t('api.enterOpenAIUrl')
                : customProtocol === 'gemini'
                  ? t('api.enterGeminiUrl')
                  : t('api.enterAnthropicUrl')}
          </p>
          {isOllamaMode && (
            <p className="text-xs text-text-muted">{t('api.discoverLocalOllamaHint')}</p>
          )}
          {provider === 'custom' && <GuidanceInlineHint text={baseUrlGuidanceText} />}
        </div>
      )}

      {/* Model Selection */}
      <div className="space-y-3 py-5 border-b border-border-muted">
        <div className="flex items-center justify-between">
          <label
            htmlFor="api-model-input"
            className="flex items-center gap-2 text-sm font-medium text-text-primary"
          >
            <Cpu className="w-4 h-4" />
            {t('api.model')}
          </label>
          <div className="flex items-center gap-2">
            {(isOllamaMode || provider === 'codex_chatgpt') && (
              <button
                type="button"
                onClick={() => {
                  void refreshModelOptions();
                }}
                disabled={isRefreshingModels}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors active:scale-95 bg-surface-hover text-text-secondary hover:bg-surface-active disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshingModels ? 'animate-spin' : ''}`} />
                {isRefreshingModels ? t('api.refreshingModels') : t('api.refreshModels')}
              </button>
            )}
            {shouldShowOllamaManualModelToggle && (
              <button
                type="button"
                onClick={toggleCustomModel}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors active:scale-95 ${
                  useCustomModel
                    ? 'bg-accent-muted text-accent'
                    : 'border border-border-muted bg-background text-text-secondary hover:bg-surface-hover'
                }`}
              >
                <Edit3 className="w-3 h-3" />
                {isOllamaMode
                  ? useCustomModel
                    ? t('api.useDetectedModels')
                    : t('api.manualModel')
                  : useCustomModel
                    ? t('api.usePreset')
                    : t('api.custom')}
              </button>
            )}
          </div>
        </div>
        {useCustomModel ? (
          <input
            id="api-model-input"
            type="text"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder={modelInputPlaceholder}
            className="w-full px-4 py-3 rounded-lg bg-background border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
          />
        ) : (
          <select
            id="api-model-input"
            value={modelOptions.length ? model : ''}
            onChange={(e) => setModel(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all appearance-none cursor-pointer"
          >
            {modelOptions.length ? (
              (modelOptions as ModelOptionItem[]).map((m) => (
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
        {useCustomModel && <p className="text-xs text-text-muted">{modelInputHint}</p>}

        {/* Context Window & Max Tokens — only for non-registry providers */}
        {(provider === 'ollama' || provider === 'custom') && (
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div>
              <label
                htmlFor="api-context-window-input"
                className="block text-xs font-medium text-text-secondary mb-1"
              >
                {t('api.contextWindow')}
              </label>
              <input
                id="api-context-window-input"
                type="number"
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                placeholder={t('api.contextWindowPlaceholder')}
                min={1024}
                step={1024}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
              />
            </div>
            <div>
              <label
                htmlFor="api-max-tokens-input"
                className="block text-xs font-medium text-text-secondary mb-1"
              >
                {t('api.maxOutputTokens')}
              </label>
              <input
                id="api-max-tokens-input"
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder={t('api.maxOutputTokensPlaceholder')}
                min={256}
                step={256}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
              />
            </div>
            <p className="col-span-2 text-xs text-text-muted">{t('api.contextWindowHint')}</p>
          </div>
        )}
      </div>

      {provider === 'custom' && (
        <CommonProviderSetupsCard
          setups={commonProviderSetups}
          onApplySetup={applyCommonProviderSetup}
        />
      )}

      {/* Enable Thinking Mode */}
      <div className="space-y-3 py-5 border-b border-border-muted">
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
            {isOllamaMode && (
              <div className="text-amber-500 dark:text-amber-400 text-xs mt-1">
                {t('api.enableThinkingOllamaHint')}
              </div>
            )}
          </label>
        </div>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {successMessage && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-success/10 text-success text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {successMessage}
        </div>
      )}
      {/* Diagnostics Panel */}
      {!isCodexMode && (
        <ApiDiagnosticsPanel
          result={diagnosticResult}
          isRunning={isDiagnosing}
          onRunDiagnostics={handleDiagnose}
          onRunDeepDiagnostics={isOllamaMode ? handleDeepDiagnose : undefined}
          disabled={requiresApiKey && !apiKey.trim()}
        />
      )}

      {/* Save Button */}
      <div className="space-y-3 py-5 border-b border-border-muted">
        <div className="grid grid-cols-1 gap-2">
          <button
            onClick={() => {
              void handleSave();
            }}
            disabled={isSaving || (requiresApiKey && !apiKey.trim())}
            className="w-full py-3 px-4 rounded-lg bg-accent text-white font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
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

// ==================== Credentials Tab ====================

export function CredentialsTab() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
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
      setError(tRef.current('credentials.failedToLoad'));
    }
  }, []);

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
      case 'email':
        return <Mail className="w-4 h-4" />;
      case 'website':
        return <Globe className="w-4 h-4" />;
      case 'api':
        return <Key className="w-4 h-4" />;
      default:
        return <Lock className="w-4 h-4" />;
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="rounded-lg border border-border-subtle bg-background px-4 py-4">
          <CredentialForm
            credential={editingCredential || undefined}
            onSave={handleSave}
            onCancel={() => {
              setShowForm(false);
              setEditingCredential(null);
            }}
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
            <div className="rounded-lg border border-border-subtle bg-background text-center py-8 text-text-muted">
              <Key className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p>{t('credentials.noCredentials')}</p>
              <p className="text-sm mt-1">{t('credentials.addCredential')}</p>
            </div>
          ) : (
            credentials.map((cred) => (
              <div
                key={cred.id}
                className="rounded-lg border border-border-subtle bg-background p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        cred.type === 'email'
                          ? 'bg-accent/10 text-accent'
                          : cred.type === 'website'
                            ? 'bg-success/10 text-success'
                            : cred.type === 'api'
                              ? 'bg-mcp/10 text-mcp'
                              : 'bg-surface-muted text-text-muted'
                      }`}
                    >
                      {getTypeIcon(cred.type)}
                    </div>
                    <div>
                      <h3 className="font-medium text-text-primary">{cred.name}</h3>
                      <p className="text-sm text-text-secondary">{cred.username}</p>
                      {cred.service && (
                        <span className="inline-block mt-1 px-2 py-0.5 text-xs rounded bg-surface-muted text-text-muted">
                          {SERVICE_OPTIONS.find((s) => s.value === cred.service)?.label ||
                            cred.service}
                        </span>
                      )}
                      {cred.url && <p className="text-xs text-text-muted mt-1">{cred.url}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingCredential(cred);
                        setShowForm(true);
                      }}
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
          className="w-full py-3 px-4 rounded-lg border-2 border-dashed border-border-subtle hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent"
        >
          <Plus className="w-5 h-5" />
          {t('credentials.addNewCredential')}
        </button>
      )}
    </div>
  );
}

function CredentialForm({
  credential,
  onSave,
  onCancel,
  isLoading,
}: {
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
  const [formError, setFormError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !username.trim()) {
      setFormError(t('credentials.nameRequired'));
      return;
    }
    if (!credential && !password.trim()) {
      setFormError(t('credentials.passwordRequired'));
      return;
    }
    setFormError('');

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
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border-subtle bg-background p-4 space-y-4"
    >
      <h3 className="font-medium text-text-primary">
        {credential ? t('credentials.editCredential') : t('credentials.addNewCredential')}
      </h3>

      {formError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {formError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">
            {t('credentials.name')} *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('credentials.namePlaceholder')}
            className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">
            {t('credentials.type')}
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as UserCredential['type'])}
            className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <option value="email">{t('credentials.typeEmail')}</option>
            <option value="website">{t('credentials.typeWebsite')}</option>
            <option value="api">{t('credentials.typeApi')}</option>
            <option value="other">{t('credentials.typeOther')}</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          {t('credentials.service')}
        </label>
        <select
          value={service}
          onChange={(e) => setService(e.target.value)}
          className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
        >
          <option value="">{t('credentials.selectService')}</option>
          {SERVICE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          {t('credentials.username')} *
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t('credentials.usernamePlaceholder')}
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
            placeholder={credential ? '••••••••' : t('credentials.passwordPlaceholder')}
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
        <label className="block text-sm font-medium text-text-primary mb-2">
          {t('credentials.loginUrl')}
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('credentials.loginUrlPlaceholder')}
          className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          {t('credentials.notes')}
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('credentials.notesPlaceholder')}
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
