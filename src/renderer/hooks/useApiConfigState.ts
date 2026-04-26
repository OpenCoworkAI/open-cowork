import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import type {
  ApiConfigSet,
  AppConfig,
  ApiTestResult,
  CustomProtocolType,
  DiagnosticResult,
  ProviderModelInfo,
  ProviderProfile,
  ProviderProfileKey,
  ProviderPresets,
  ProviderType,
} from '../types';
import { isLoopbackBaseUrl } from '../../shared/network/loopback';
import { DEFAULT_OLLAMA_BASE_URL, normalizeOllamaBaseUrl } from '../../shared/ollama-base-url';
import { API_PROVIDER_PRESETS, getModelInputGuidance } from '../../shared/api-model-presets';
import {
  COMMON_PROVIDER_SETUPS,
  detectCommonProviderSetup,
  getFallbackOpenAISetup,
  isParsableBaseUrl,
  orderCommonProviderSetups,
  resolveProviderGuidanceErrorHint,
  type CommonProviderSetup,
} from '../../shared/api-provider-guidance';
export { getModelInputGuidance } from '../../shared/api-model-presets';

interface UseApiConfigStateOptions {
  enabled?: boolean;
  initialConfig?: AppConfig | null;
  onSave?: (config: Partial<AppConfig>) => Promise<void>;
}

interface UIProviderProfile {
  apiKey: string;
  baseUrl: string;
  model: string;
  customModel: string;
  useCustomModel: boolean;
  contextWindow: string;
  maxTokens: string;
}

interface ConfigStateSnapshot {
  activeProfileKey: ProviderProfileKey;
  profiles: Record<ProviderProfileKey, UIProviderProfile>;
  enableThinking: boolean;
}

interface ApiConfigBootstrap {
  snapshot: ConfigStateSnapshot;
  configSets: ApiConfigSet[];
  activeConfigSetId: string;
}

type CreateMode = 'blank' | 'clone';

type PendingConfigSetAction = { type: 'switch'; targetSetId: string };

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
const CONFIG_SET_LIMIT = 20;
const DEFAULT_CONFIG_SET_ID = 'default';
const DEFAULT_CONFIG_SET_NAME_EN = 'Default Config';
export const FALLBACK_PROVIDER_PRESETS: ProviderPresets = API_PROVIDER_PRESETS;

const PROFILE_KEYS: ProviderProfileKey[] = [
  'openrouter',
  'anthropic',
  'openai',
  'gemini',
  'ollama',
  'custom:anthropic',
  'custom:openai',
  'custom:gemini',
];

function isProfileKey(value: unknown): value is ProviderProfileKey {
  return typeof value === 'string' && PROFILE_KEYS.includes(value as ProviderProfileKey);
}

function isProviderType(value: unknown): value is ProviderType {
  return (
    value === 'openrouter' ||
    value === 'anthropic' ||
    value === 'custom' ||
    value === 'openai' ||
    value === 'gemini' ||
    value === 'ollama'
  );
}

function isCustomProtocol(value: unknown): value is CustomProtocolType {
  return value === 'anthropic' || value === 'openai' || value === 'gemini';
}

export function profileKeyFromProvider(
  provider: ProviderType,
  customProtocol: CustomProtocolType = 'anthropic'
): ProviderProfileKey {
  if (provider !== 'custom') {
    return provider;
  }
  if (customProtocol === 'openai') {
    return 'custom:openai';
  }
  if (customProtocol === 'gemini') {
    return 'custom:gemini';
  }
  return 'custom:anthropic';
}

export function profileKeyToProvider(profileKey: ProviderProfileKey): {
  provider: ProviderType;
  customProtocol: CustomProtocolType;
} {
  if (profileKey === 'ollama') {
    return { provider: 'ollama', customProtocol: 'openai' };
  }
  if (profileKey === 'custom:openai') {
    return { provider: 'custom', customProtocol: 'openai' };
  }
  if (profileKey === 'custom:gemini') {
    return { provider: 'custom', customProtocol: 'gemini' };
  }
  if (profileKey === 'custom:anthropic') {
    return { provider: 'custom', customProtocol: 'anthropic' };
  }
  if (profileKey === 'openai') {
    return { provider: 'openai', customProtocol: 'openai' };
  }
  if (profileKey === 'gemini') {
    return { provider: 'gemini', customProtocol: 'gemini' };
  }
  return { provider: profileKey, customProtocol: 'anthropic' };
}

export function isCustomAnthropicLoopbackGateway(baseUrl: string): boolean {
  return isLoopbackBaseUrl(baseUrl);
}

export function isCustomGeminiLoopbackGateway(baseUrl: string): boolean {
  return isLoopbackBaseUrl(baseUrl);
}

export function isCustomOpenAiLoopbackGateway(baseUrl: string): boolean {
  return isLoopbackBaseUrl(baseUrl);
}

function isLegacyOllamaConfig(
  config: Pick<AppConfig, 'provider' | 'customProtocol' | 'baseUrl'> | null | undefined
): boolean {
  if (!(config?.provider === 'custom' && config.customProtocol === 'openai')) {
    return false;
  }
  const baseUrl = config.baseUrl?.trim();
  if (!baseUrl || !isLoopbackBaseUrl(baseUrl)) {
    return false;
  }
  try {
    const parsed = new URL(baseUrl);
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return port === '11434' && (!pathname || pathname === '/v1');
  } catch {
    return false;
  }
}

function modelPresetForProfile(profileKey: ProviderProfileKey, presets: ProviderPresets) {
  if (profileKey === 'ollama') {
    return presets.ollama;
  }
  if (profileKey === 'custom:openai') {
    return presets.openai;
  }
  if (profileKey === 'custom:gemini') {
    return presets.gemini;
  }
  if (profileKey === 'custom:anthropic') {
    return presets.custom;
  }
  return presets[profileKey];
}

function defaultProfileForKey(
  profileKey: ProviderProfileKey,
  presets: ProviderPresets
): UIProviderProfile {
  const preset = modelPresetForProfile(profileKey, presets);
  const prefersCustomInput = profileKey.startsWith('custom:');
  return {
    apiKey: '',
    baseUrl: preset.baseUrl,
    model: profileKey === 'ollama' ? '' : preset.models[0]?.id || '',
    customModel: '',
    useCustomModel: prefersCustomInput,
    contextWindow: '',
    maxTokens: '',
  };
}

function normalizeDiscoveredOllamaModels(models: string[] | undefined): ProviderModelInfo[] {
  return (models || [])
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => ({ id, name: id }));
}

// Inline helper: produces a partial discoveredModels update that clears a profile key.
// Used by dispatch callers instead of calling this as a free function.
function clearDiscoveredModelsForProfile(
  prev: Partial<Record<ProviderProfileKey, ProviderModelInfo[]>>,
  profileKey: ProviderProfileKey
): Partial<Record<ProviderProfileKey, ProviderModelInfo[]>> {
  return { ...prev, [profileKey]: [] };
}

function isPristineCustomProfile(
  profileKey: ProviderProfileKey,
  profile: Partial<ProviderProfile> | undefined,
  fallback: UIProviderProfile
): boolean {
  if (!profileKey.startsWith('custom:') || !profile) {
    return false;
  }

  const apiKey = profile.apiKey?.trim() || '';
  const baseUrl = profile.baseUrl?.trim() || fallback.baseUrl;
  const model = profile.model?.trim() || fallback.model;

  return apiKey === '' && baseUrl === fallback.baseUrl && model === fallback.model;
}

function normalizeProfile(
  profileKey: ProviderProfileKey,
  profile: Partial<ProviderProfile> | undefined,
  presets: ProviderPresets
): UIProviderProfile {
  const fallback = defaultProfileForKey(profileKey, presets);
  if (!profile) {
    return fallback;
  }

  if (isPristineCustomProfile(profileKey, profile, fallback)) {
    return {
      ...fallback,
      apiKey: '',
      baseUrl: fallback.baseUrl,
      customModel: '',
      useCustomModel: true,
      contextWindow: '',
      maxTokens: '',
    };
  }

  const modelValue = profile?.model?.trim() || fallback.model;
  const rawBaseUrl = profile?.baseUrl?.trim() || fallback.baseUrl;
  const hasPresetModel = modelPresetForProfile(profileKey, presets).models.some(
    (item) => item.id === modelValue
  );
  return {
    apiKey: profile?.apiKey || '',
    baseUrl:
      profileKey === 'ollama' ? normalizeOllamaBaseUrl(rawBaseUrl) || fallback.baseUrl : rawBaseUrl,
    model: hasPresetModel ? modelValue : fallback.model,
    customModel: hasPresetModel ? '' : modelValue,
    useCustomModel: !hasPresetModel,
    contextWindow: profile?.contextWindow ? String(profile.contextWindow) : '',
    maxTokens: profile?.maxTokens ? String(profile.maxTokens) : '',
  };
}

export function buildApiConfigSnapshot(
  config: AppConfig | null | undefined,
  presets: ProviderPresets
): ConfigStateSnapshot {
  const migratedToOllama = config?.provider === 'ollama' || isLegacyOllamaConfig(config);
  const provider = migratedToOllama ? 'ollama' : config?.provider || 'openrouter';
  const customProtocol: CustomProtocolType = migratedToOllama
    ? 'openai'
    : config?.customProtocol === 'openai'
      ? 'openai'
      : config?.customProtocol === 'gemini'
        ? 'gemini'
        : 'anthropic';
  const derivedProfileKey = profileKeyFromProvider(provider, customProtocol);
  const activeProfileKey = migratedToOllama
    ? 'ollama'
    : isProfileKey(config?.activeProfileKey)
      ? config.activeProfileKey
      : derivedProfileKey;

  const profiles = {} as Record<ProviderProfileKey, UIProviderProfile>;
  for (const key of PROFILE_KEYS) {
    profiles[key] = normalizeProfile(key, config?.profiles?.[key], presets);
  }

  if (migratedToOllama) {
    profiles.ollama = normalizeProfile(
      'ollama',
      config?.profiles?.ollama ||
        config?.profiles?.['custom:openai'] || {
          apiKey: config?.apiKey || '',
          baseUrl: config?.baseUrl,
          model: config?.model,
        },
      presets
    );
  }

  const hasProfilesFromConfig = Boolean(
    config?.profiles && Object.keys(config.profiles).length > 0
  );
  if (!hasProfilesFromConfig) {
    profiles[activeProfileKey] = normalizeProfile(
      activeProfileKey,
      {
        apiKey: config?.apiKey || '',
        baseUrl: config?.baseUrl,
        model: config?.model,
      },
      presets
    );
  }

  return {
    activeProfileKey,
    profiles,
    enableThinking: Boolean(config?.enableThinking),
  };
}

function toPersistedProfiles(
  profiles: Record<ProviderProfileKey, UIProviderProfile>
): Partial<Record<ProviderProfileKey, ProviderProfile>> {
  const persisted: Partial<Record<ProviderProfileKey, ProviderProfile>> = {};
  for (const key of PROFILE_KEYS) {
    const profile = profiles[key];
    const finalModel = profile.useCustomModel
      ? profile.customModel.trim() || profile.model
      : profile.model;
    persisted[key] = {
      apiKey: profile.apiKey,
      baseUrl: profile.baseUrl.trim() || undefined,
      model: finalModel,
      contextWindow: profile.contextWindow ? Number(profile.contextWindow) : undefined,
      maxTokens: profile.maxTokens ? Number(profile.maxTokens) : undefined,
    };
  }
  return persisted;
}

export function buildApiConfigDraftSignature(
  activeProfileKey: ProviderProfileKey,
  profiles: Record<ProviderProfileKey, UIProviderProfile>,
  enableThinking: boolean
): string {
  const persisted = toPersistedProfiles(profiles);
  return JSON.stringify({
    activeProfileKey,
    enableThinking,
    profiles: PROFILE_KEYS.map((key) => ({
      key,
      apiKey: persisted[key]?.apiKey || '',
      baseUrl: persisted[key]?.baseUrl || '',
      model: persisted[key]?.model || '',
    })),
  });
}

export function buildApiConfigSets(
  config: AppConfig | null | undefined,
  presets: ProviderPresets
): ApiConfigSet[] {
  const now = new Date().toISOString();

  if (config?.configSets && config.configSets.length > 0) {
    return config.configSets.map((set, index) => {
      const isMigratedOllamaSet = isLegacyOllamaConfig({
        provider: isProviderType(set.provider) ? set.provider : 'openrouter',
        customProtocol: isCustomProtocol(set.customProtocol) ? set.customProtocol : 'anthropic',
        baseUrl: set.profiles?.['custom:openai']?.baseUrl || config?.baseUrl,
      });
      const provider = isMigratedOllamaSet
        ? 'ollama'
        : isProviderType(set.provider)
          ? set.provider
          : 'openrouter';
      const customProtocol = isMigratedOllamaSet
        ? 'openai'
        : isCustomProtocol(set.customProtocol)
          ? set.customProtocol
          : 'anthropic';
      const fallbackActive = profileKeyFromProvider(provider, customProtocol);
      const activeProfileKey = isMigratedOllamaSet
        ? 'ollama'
        : isProfileKey(set.activeProfileKey)
          ? set.activeProfileKey
          : fallbackActive;

      const normalizedProfiles = {} as Record<ProviderProfileKey, ProviderProfile>;
      for (const key of PROFILE_KEYS) {
        const uiProfile = normalizeProfile(key, set.profiles?.[key], presets);
        normalizedProfiles[key] = {
          apiKey: uiProfile.apiKey,
          baseUrl: uiProfile.baseUrl,
          model: uiProfile.useCustomModel
            ? uiProfile.customModel.trim() || uiProfile.model
            : uiProfile.model,
        };
      }

      if (isMigratedOllamaSet) {
        const ollamaProfile = normalizeProfile(
          'ollama',
          set.profiles?.ollama || set.profiles?.['custom:openai'],
          presets
        );
        normalizedProfiles.ollama = {
          apiKey: ollamaProfile.apiKey,
          baseUrl: ollamaProfile.baseUrl,
          model: ollamaProfile.useCustomModel
            ? ollamaProfile.customModel.trim() || ollamaProfile.model
            : ollamaProfile.model,
        };
      }

      return {
        ...set,
        id: typeof set.id === 'string' && set.id.trim() ? set.id : `set-${index + 1}`,
        name:
          typeof set.name === 'string' && set.name.trim() ? set.name : `Config Set ${index + 1}`,
        provider,
        customProtocol,
        activeProfileKey,
        profiles: normalizedProfiles,
        enableThinking: Boolean(set.enableThinking),
        updatedAt: typeof set.updatedAt === 'string' && set.updatedAt.trim() ? set.updatedAt : now,
      };
    });
  }

  const snapshot = buildApiConfigSnapshot(config, presets);
  const activeMeta = profileKeyToProvider(snapshot.activeProfileKey);
  const fallbackId =
    typeof config?.activeConfigSetId === 'string' && config.activeConfigSetId.trim()
      ? config.activeConfigSetId
      : DEFAULT_CONFIG_SET_ID;

  return [
    {
      id: fallbackId,
      name: DEFAULT_CONFIG_SET_NAME_EN,
      isSystem: true,
      provider: activeMeta.provider,
      customProtocol: activeMeta.customProtocol,
      activeProfileKey: snapshot.activeProfileKey,
      profiles: toPersistedProfiles(snapshot.profiles),
      enableThinking: snapshot.enableThinking,
      updatedAt: now,
    },
  ];
}

export function buildApiConfigBootstrap(
  config: AppConfig | null | undefined,
  presets: ProviderPresets
): ApiConfigBootstrap {
  const snapshot = buildApiConfigSnapshot(config, presets);
  const configSets = buildApiConfigSets(config, presets);
  const activeConfigSetId =
    typeof config?.activeConfigSetId === 'string' &&
    configSets.some((set) => set.id === config.activeConfigSetId)
      ? config.activeConfigSetId
      : configSets[0]?.id || DEFAULT_CONFIG_SET_ID;

  return {
    snapshot,
    configSets,
    activeConfigSetId,
  };
}

function translateApiConfigErrorMessage(
  message: string,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (message === 'Config set name is required') {
    return t('api.configSetNameRequired');
  }
  if (message === 'Config set clone source not found') {
    return t('api.configSetCloneSourceMissing');
  }
  if (message === 'Config set not found') {
    return t('api.configSetMissing');
  }
  if (message === 'System config set cannot be deleted') {
    return t('api.configSetSystemDeleteForbidden');
  }
  if (message === 'At least one config set must be kept') {
    return t('api.configSetKeepOne');
  }

  const limitMatch = message.match(/^Config set limit reached: max\s+(\d+)$/);
  if (limitMatch) {
    return t('api.configSetLimitReached', { count: Number(limitMatch[1]) });
  }

  return message;
}

function protocolLabel(
  protocol: CustomProtocolType,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (protocol === 'openai') {
    return t('api.guidance.protocolLabels.openai');
  }
  if (protocol === 'gemini') {
    return t('api.guidance.protocolLabels.gemini');
  }
  return t('api.guidance.protocolLabels.anthropic');
}

function providerTabLabel(
  provider: ProviderType,
  presets: ProviderPresets,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (provider === 'custom') {
    return t('api.custom');
  }
  return presets[provider]?.name || provider;
}

function buildSetupModelState(
  setup: CommonProviderSetup,
  profileKey: ProviderProfileKey,
  presets: ProviderPresets
): Pick<UIProviderProfile, 'model' | 'customModel' | 'useCustomModel'> {
  const preset = modelPresetForProfile(profileKey, presets);
  const hasPresetModel = preset.models.some((item) => item.id === setup.exampleModel);
  return {
    model: hasPresetModel ? setup.exampleModel : preset.models[0]?.id || setup.exampleModel,
    customModel: hasPresetModel ? '' : setup.exampleModel,
    useCustomModel: !hasPresetModel,
  };
}

// ---------------------------------------------------------------------------
// Reducer state
// ---------------------------------------------------------------------------

interface ApiConfigState {
  // Provider presets loaded from Electron
  presets: ProviderPresets;
  // Per-profile UI fields
  profiles: Record<ProviderProfileKey, UIProviderProfile>;
  // Which profile tab is selected
  activeProfileKey: ProviderProfileKey;
  // Config-set list and selection
  configSets: ApiConfigSet[];
  activeConfigSetId: string;
  // Deferred action waiting for unsaved-changes resolution
  pendingConfigSetAction: PendingConfigSetAction | null;
  // Extended thinking flag
  enableThinking: boolean;
  // Remember last custom protocol so switching back to custom restores it
  lastCustomProtocol: CustomProtocolType;
  // Signature of the last persisted state (used for dirty-check)
  savedDraftSignature: string;
  // Ollama model discovery results keyed by profile
  discoveredModels: Partial<Record<ProviderProfileKey, ProviderModelInfo[]>>;
  // Async loading flags
  isLoadingConfig: boolean;
  isSaving: boolean;
  isTesting: boolean;
  isRefreshingModels: boolean;
  isDiscoveringLocalOllama: boolean;
  isMutatingConfigSet: boolean;
  isDiagnosing: boolean;
  // Error message — either a raw string or a i18n key + optional values
  errorText: string;
  errorKey: string | null;
  errorValues: Record<string, string | number> | undefined;
  // Success message — same dual-source pattern
  successText: string;
  successKey: string | null;
  successValues: Record<string, string | number> | undefined;
  // Persisted results
  lastSaveCompletedAt: number;
  testResult: ApiTestResult | null;
  diagnosticResult: DiagnosticResult | null;
}

// ---------------------------------------------------------------------------
// Actions (discriminated union — no plain string payloads where avoidable)
// ---------------------------------------------------------------------------

type ApiConfigAction =
  // Bulk resets from loaded config
  | {
      type: 'APPLY_LOADED_STATE';
      payload: {
        presets: ProviderPresets;
        profiles: Record<ProviderProfileKey, UIProviderProfile>;
        activeProfileKey: ProviderProfileKey;
        enableThinking: boolean;
        configSets: ApiConfigSet[];
        activeConfigSetId: string;
        lastCustomProtocol: CustomProtocolType;
        savedDraftSignature: string;
      };
    }
  // Active profile key
  | { type: 'SET_ACTIVE_PROFILE_KEY'; payload: ProviderProfileKey }
  // Enable thinking toggle
  | { type: 'SET_ENABLE_THINKING'; payload: boolean }
  // Patch one profile in the profiles map
  | { type: 'PATCH_PROFILE'; profileKey: ProviderProfileKey; patch: Partial<UIProviderProfile> }
  // Replace a profile using a functional updater
  | {
      type: 'UPDATE_PROFILE_FN';
      profileKey: ProviderProfileKey;
      updater: (prev: UIProviderProfile) => UIProviderProfile;
    }
  // Discovered Ollama models
  | {
      type: 'SET_DISCOVERED_MODELS';
      profileKey: ProviderProfileKey;
      models: ProviderModelInfo[];
    }
  | { type: 'CLEAR_DISCOVERED_MODELS'; profileKey: ProviderProfileKey }
  | { type: 'DELETE_DISCOVERED_MODELS'; profileKey: ProviderProfileKey }
  // Config set mutations
  | { type: 'SET_CONFIG_SETS'; payload: ApiConfigSet[] }
  | { type: 'SET_ACTIVE_CONFIG_SET_ID'; payload: string }
  | { type: 'SET_PENDING_CONFIG_SET_ACTION'; payload: PendingConfigSetAction | null }
  // Loading flags
  | { type: 'SET_IS_LOADING_CONFIG'; payload: boolean }
  | { type: 'SET_IS_SAVING'; payload: boolean }
  | { type: 'SET_IS_TESTING'; payload: boolean }
  | { type: 'SET_IS_REFRESHING_MODELS'; payload: boolean }
  | { type: 'SET_IS_DISCOVERING_LOCAL_OLLAMA'; payload: boolean }
  | { type: 'SET_IS_MUTATING_CONFIG_SET'; payload: boolean }
  | { type: 'SET_IS_DIAGNOSING'; payload: boolean }
  // Error message helpers
  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_ERROR_KEY'; key: string; values?: Record<string, string | number> }
  | { type: 'SET_ERROR_TEXT'; text: string }
  // Success message helpers
  | { type: 'CLEAR_SUCCESS' }
  | { type: 'SET_SUCCESS_KEY'; key: string; values?: Record<string, string | number> }
  | { type: 'SET_SUCCESS_TEXT'; text: string }
  // Results
  | { type: 'SET_LAST_SAVE_COMPLETED_AT'; payload: number }
  | { type: 'SET_TEST_RESULT'; payload: ApiTestResult | null }
  | { type: 'SET_DIAGNOSTIC_RESULT'; payload: DiagnosticResult | null }
  // Save signature
  | { type: 'SET_SAVED_DRAFT_SIGNATURE'; payload: string }
  // Last custom protocol memory
  | { type: 'SET_LAST_CUSTOM_PROTOCOL'; payload: CustomProtocolType };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function apiConfigReducer(state: ApiConfigState, action: ApiConfigAction): ApiConfigState {
  switch (action.type) {
    case 'APPLY_LOADED_STATE':
      return {
        ...state,
        presets: action.payload.presets,
        profiles: action.payload.profiles,
        activeProfileKey: action.payload.activeProfileKey,
        enableThinking: action.payload.enableThinking,
        configSets: action.payload.configSets,
        activeConfigSetId: action.payload.activeConfigSetId,
        pendingConfigSetAction: null,
        lastCustomProtocol: action.payload.lastCustomProtocol,
        savedDraftSignature: action.payload.savedDraftSignature,
      };

    case 'SET_ACTIVE_PROFILE_KEY':
      return { ...state, activeProfileKey: action.payload };

    case 'SET_ENABLE_THINKING':
      return { ...state, enableThinking: action.payload };

    case 'PATCH_PROFILE':
      return {
        ...state,
        profiles: {
          ...state.profiles,
          [action.profileKey]: {
            ...(state.profiles[action.profileKey] ||
              defaultProfileForKey(action.profileKey, state.presets)),
            ...action.patch,
          },
        },
      };

    case 'UPDATE_PROFILE_FN':
      return {
        ...state,
        profiles: {
          ...state.profiles,
          [action.profileKey]: action.updater(
            state.profiles[action.profileKey] ||
              defaultProfileForKey(action.profileKey, state.presets)
          ),
        },
      };

    case 'SET_DISCOVERED_MODELS':
      return {
        ...state,
        discoveredModels: { ...state.discoveredModels, [action.profileKey]: action.models },
      };

    case 'CLEAR_DISCOVERED_MODELS':
      return {
        ...state,
        discoveredModels: clearDiscoveredModelsForProfile(
          state.discoveredModels,
          action.profileKey
        ),
      };

    case 'DELETE_DISCOVERED_MODELS': {
      const next = { ...state.discoveredModels };
      delete next[action.profileKey];
      return { ...state, discoveredModels: next };
    }

    case 'SET_CONFIG_SETS':
      return { ...state, configSets: action.payload };

    case 'SET_ACTIVE_CONFIG_SET_ID':
      return { ...state, activeConfigSetId: action.payload };

    case 'SET_PENDING_CONFIG_SET_ACTION':
      return { ...state, pendingConfigSetAction: action.payload };

    case 'SET_IS_LOADING_CONFIG':
      return { ...state, isLoadingConfig: action.payload };

    case 'SET_IS_SAVING':
      return { ...state, isSaving: action.payload };

    case 'SET_IS_TESTING':
      return { ...state, isTesting: action.payload };

    case 'SET_IS_REFRESHING_MODELS':
      return { ...state, isRefreshingModels: action.payload };

    case 'SET_IS_DISCOVERING_LOCAL_OLLAMA':
      return { ...state, isDiscoveringLocalOllama: action.payload };

    case 'SET_IS_MUTATING_CONFIG_SET':
      return { ...state, isMutatingConfigSet: action.payload };

    case 'SET_IS_DIAGNOSING':
      return { ...state, isDiagnosing: action.payload };

    case 'CLEAR_ERROR':
      return { ...state, errorText: '', errorKey: null, errorValues: undefined };

    case 'SET_ERROR_KEY':
      return { ...state, errorText: '', errorKey: action.key, errorValues: action.values };

    case 'SET_ERROR_TEXT':
      return { ...state, errorKey: null, errorValues: undefined, errorText: action.text };

    case 'CLEAR_SUCCESS':
      return { ...state, successText: '', successKey: null, successValues: undefined };

    case 'SET_SUCCESS_KEY':
      return { ...state, successText: '', successKey: action.key, successValues: action.values };

    case 'SET_SUCCESS_TEXT':
      return { ...state, successKey: null, successValues: undefined, successText: action.text };

    case 'SET_LAST_SAVE_COMPLETED_AT':
      return { ...state, lastSaveCompletedAt: action.payload };

    case 'SET_TEST_RESULT':
      return { ...state, testResult: action.payload };

    case 'SET_DIAGNOSTIC_RESULT':
      return { ...state, diagnosticResult: action.payload };

    case 'SET_SAVED_DRAFT_SIGNATURE':
      return { ...state, savedDraftSignature: action.payload };

    case 'SET_LAST_CUSTOM_PROTOCOL':
      return { ...state, lastCustomProtocol: action.payload };

    default: {
      // Exhaustiveness check — TypeScript will error if a case is missing
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function useApiConfigState(options: UseApiConfigStateOptions = {}) {
  const { t } = useTranslation();
  const { enabled = true, initialConfig, onSave } = options;
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const setIsConfigured = useAppStore((s) => s.setIsConfigured);
  const initialBootstrapRef = useRef<ApiConfigBootstrap | null>(null);
  if (!initialBootstrapRef.current) {
    initialBootstrapRef.current = buildApiConfigBootstrap(initialConfig, FALLBACK_PROVIDER_PRESETS);
  }
  const initialBootstrap = initialBootstrapRef.current;

  const initialLastCustomProtocol: CustomProtocolType =
    initialConfig?.customProtocol === 'openai'
      ? 'openai'
      : initialConfig?.customProtocol === 'gemini'
        ? 'gemini'
        : 'anthropic';

  const [state, dispatch] = useReducer(
    apiConfigReducer,
    undefined,
    (): ApiConfigState => ({
      presets: FALLBACK_PROVIDER_PRESETS,
      profiles: initialBootstrap.snapshot.profiles,
      activeProfileKey: initialBootstrap.snapshot.activeProfileKey,
      configSets: initialBootstrap.configSets,
      activeConfigSetId: initialBootstrap.activeConfigSetId,
      pendingConfigSetAction: null,
      isMutatingConfigSet: false,
      lastCustomProtocol: initialLastCustomProtocol,
      enableThinking: Boolean(initialConfig?.enableThinking),
      discoveredModels: {},
      isLoadingConfig: true,
      savedDraftSignature: '',
      isSaving: false,
      isTesting: false,
      isRefreshingModels: false,
      isDiscoveringLocalOllama: false,
      errorText: '',
      errorKey: null,
      errorValues: undefined,
      successText: '',
      successKey: null,
      successValues: undefined,
      lastSaveCompletedAt: 0,
      testResult: null,
      diagnosticResult: null,
      isDiagnosing: false,
    })
  );

  // Destructure state for convenience — avoids `state.X` in every expression
  const {
    presets,
    profiles,
    activeProfileKey,
    configSets,
    activeConfigSetId,
    pendingConfigSetAction,
    isMutatingConfigSet,
    lastCustomProtocol,
    enableThinking,
    discoveredModels,
    isLoadingConfig,
    savedDraftSignature,
    isSaving,
    isTesting,
    isRefreshingModels,
    isDiscoveringLocalOllama,
    errorText,
    errorKey,
    errorValues,
    successText,
    successKey,
    successValues,
    lastSaveCompletedAt,
    testResult,
    diagnosticResult,
    isDiagnosing,
  } = state;

  const ollamaRefreshRequestIdRef = useRef(0);
  const latestOllamaTargetRef = useRef<{
    activeProfileKey: ProviderProfileKey;
    baseUrl: string;
    provider: ProviderType;
  }>({
    activeProfileKey,
    baseUrl: '',
    provider: 'openrouter',
  });
  const ollamaDiscoverRequestIdRef = useRef(0);

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  const showErrorKey = useCallback((key: string, values?: Record<string, string | number>) => {
    dispatch({ type: 'SET_ERROR_KEY', key, values });
  }, []);

  const showErrorText = useCallback((text: string) => {
    dispatch({ type: 'SET_ERROR_TEXT', text });
  }, []);

  const clearSuccessMessage = useCallback(() => {
    dispatch({ type: 'CLEAR_SUCCESS' });
  }, []);

  const showSuccessKey = useCallback((key: string, values?: Record<string, string | number>) => {
    dispatch({ type: 'SET_SUCCESS_KEY', key, values });
  }, []);

  const showSuccessText = useCallback((text: string) => {
    dispatch({ type: 'SET_SUCCESS_TEXT', text });
  }, []);

  const error = errorKey ? t(errorKey, errorValues) : errorText;
  const successMessage = successKey ? t(successKey, successValues) : successText;

  const providerMeta = useMemo(() => profileKeyToProvider(activeProfileKey), [activeProfileKey]);
  const provider = providerMeta.provider;
  const customProtocol = providerMeta.customProtocol;
  const currentProfile =
    profiles[activeProfileKey] || defaultProfileForKey(activeProfileKey, presets);
  const modelPreset = modelPresetForProfile(activeProfileKey, presets);
  const currentPreset = modelPreset;
  const hasDiscoveredOllamaModels =
    provider === 'ollama' &&
    Object.prototype.hasOwnProperty.call(discoveredModels, activeProfileKey);
  const modelOptions =
    provider === 'ollama'
      ? discoveredModels[activeProfileKey] || []
      : hasDiscoveredOllamaModels
        ? discoveredModels[activeProfileKey] || []
        : modelPreset.models;
  const modelInputGuidance = getModelInputGuidance(provider, customProtocol);

  const currentConfigSet = useMemo(
    () => configSets.find((set) => set.id === activeConfigSetId) || null,
    [configSets, activeConfigSetId]
  );
  const pendingConfigSet = useMemo(
    () =>
      pendingConfigSetAction?.type === 'switch'
        ? configSets.find((set) => set.id === pendingConfigSetAction.targetSetId) || null
        : null,
    [configSets, pendingConfigSetAction]
  );

  const apiKey = currentProfile.apiKey;
  const baseUrl = currentProfile.baseUrl;
  const model = currentProfile.model;
  const customModel = currentProfile.customModel;
  const useCustomModel = currentProfile.useCustomModel;
  const shouldShowOllamaManualModelToggle =
    provider !== 'ollama' || useCustomModel || Boolean(error) || modelOptions.length === 0;
  const contextWindow = currentProfile.contextWindow;
  const maxTokens = currentProfile.maxTokens;
  const detectedProviderSetup = useMemo(
    () => (provider === 'custom' ? detectCommonProviderSetup(baseUrl) : null),
    [baseUrl, provider]
  );
  const fallbackOpenAISetup = useMemo(() => getFallbackOpenAISetup(), []);
  const effectiveProviderSetup = useMemo(() => {
    if (detectedProviderSetup) {
      return detectedProviderSetup;
    }
    if (
      provider === 'custom' &&
      customProtocol === 'openai' &&
      baseUrl.trim() &&
      isParsableBaseUrl(baseUrl)
    ) {
      return fallbackOpenAISetup;
    }
    return null;
  }, [baseUrl, customProtocol, detectedProviderSetup, fallbackOpenAISetup, provider]);
  const setupDisplayProtocol = useCallback(
    (setup: CommonProviderSetup) =>
      setup.protocolLabel || protocolLabel(setup.recommendedProtocol, t),
    [t]
  );
  const protocolGuidanceTone = useMemo<'info' | 'warning' | undefined>(() => {
    if (provider !== 'custom' || !detectedProviderSetup) {
      return undefined;
    }
    if (detectedProviderSetup.preferProviderTab) {
      return 'warning';
    }
    return customProtocol === detectedProviderSetup.recommendedProtocol ? 'info' : 'warning';
  }, [customProtocol, detectedProviderSetup, provider]);
  const protocolGuidanceText = useMemo(() => {
    if (provider !== 'custom' || !detectedProviderSetup) {
      return '';
    }

    const serviceName = t(detectedProviderSetup.nameKey);
    if (detectedProviderSetup.preferProviderTab) {
      return t('api.guidance.preferProviderTab', {
        service: serviceName,
        provider: providerTabLabel(detectedProviderSetup.preferProviderTab, presets, t),
      });
    }

    if (customProtocol !== detectedProviderSetup.recommendedProtocol) {
      return t('api.guidance.protocolMismatch', {
        service: serviceName,
        recommendedProtocol: setupDisplayProtocol(detectedProviderSetup),
      });
    }

    return t('api.guidance.protocolLooksGood', {
      service: serviceName,
      recommendedProtocol: setupDisplayProtocol(detectedProviderSetup),
    });
  }, [customProtocol, detectedProviderSetup, presets, provider, setupDisplayProtocol, t]);
  const baseUrlGuidanceText = useMemo(() => {
    if (provider !== 'custom' || !effectiveProviderSetup) {
      return '';
    }

    if (!detectedProviderSetup && effectiveProviderSetup.id === fallbackOpenAISetup.id) {
      return t('api.guidance.genericBaseUrlHint', {
        recommendedProtocol: setupDisplayProtocol(effectiveProviderSetup),
        baseUrl: effectiveProviderSetup.recommendedBaseUrl,
        model: effectiveProviderSetup.exampleModel,
      });
    }

    return t('api.guidance.baseUrlHint', {
      service: t(effectiveProviderSetup.nameKey),
      recommendedProtocol: setupDisplayProtocol(effectiveProviderSetup),
      baseUrl: effectiveProviderSetup.recommendedBaseUrl,
      model: effectiveProviderSetup.exampleModel,
    });
  }, [
    detectedProviderSetup,
    effectiveProviderSetup,
    fallbackOpenAISetup.id,
    provider,
    setupDisplayProtocol,
    t,
  ]);
  const commonProviderSetups = useMemo(
    () =>
      provider === 'custom'
        ? orderCommonProviderSetups(detectedProviderSetup?.id).map((setup) => ({
            id: setup.id,
            name: t(setup.nameKey),
            protocolLabel: setupDisplayProtocol(setup),
            baseUrl: setup.recommendedBaseUrl,
            exampleModel: setup.exampleModel,
            notes: t(setup.noteKey),
            isDetected: setup.id === detectedProviderSetup?.id,
          }))
        : [],
    [detectedProviderSetup?.id, provider, setupDisplayProtocol, t]
  );
  const friendlyTestDetails = useMemo(() => {
    const hintKind = resolveProviderGuidanceErrorHint(testResult?.details, detectedProviderSetup);
    if (!hintKind) {
      return '';
    }

    if (hintKind === 'emptyProbePreferProvider' && detectedProviderSetup?.preferProviderTab) {
      return t('api.guidance.errorHints.emptyProbePreferProvider', {
        service: t(detectedProviderSetup.nameKey),
        provider: providerTabLabel(detectedProviderSetup.preferProviderTab, presets, t),
      });
    }
    if (hintKind === 'emptyProbeDetected' && effectiveProviderSetup) {
      return t('api.guidance.errorHints.emptyProbeDetected', {
        service: t(effectiveProviderSetup.nameKey),
        recommendedProtocol: setupDisplayProtocol(effectiveProviderSetup),
      });
    }
    if (hintKind === 'emptyProbeGeneric') {
      return t('api.guidance.errorHints.emptyProbeGeneric');
    }
    if (hintKind === 'probeMismatchDetected' && effectiveProviderSetup) {
      return t('api.guidance.errorHints.probeMismatchDetected', {
        service: t(effectiveProviderSetup.nameKey),
        recommendedProtocol: setupDisplayProtocol(effectiveProviderSetup),
      });
    }
    if (hintKind === 'probeMismatchGeneric') {
      return t('api.guidance.errorHints.probeMismatchGeneric');
    }

    return '';
  }, [
    detectedProviderSetup,
    effectiveProviderSetup,
    presets,
    setupDisplayProtocol,
    t,
    testResult?.details,
  ]);

  const allowEmptyApiKey =
    provider === 'ollama' ||
    (provider === 'custom' &&
      ((customProtocol === 'anthropic' && isCustomAnthropicLoopbackGateway(baseUrl)) ||
        (customProtocol === 'openai' && isCustomOpenAiLoopbackGateway(baseUrl)) ||
        (customProtocol === 'gemini' && isCustomGeminiLoopbackGateway(baseUrl))));
  const requiresApiKey = !allowEmptyApiKey;
  const currentDraftSignature = useMemo(
    () => buildApiConfigDraftSignature(activeProfileKey, profiles, enableThinking),
    [activeProfileKey, profiles, enableThinking]
  );
  const hasUnsavedChanges =
    savedDraftSignature !== '' && currentDraftSignature !== savedDraftSignature;

  const applyLoadedState = useCallback(
    (config: AppConfig | null | undefined, loadedPresets: ProviderPresets) => {
      const bootstrap = buildApiConfigBootstrap(config, loadedPresets);

      const activeMeta = profileKeyToProvider(bootstrap.snapshot.activeProfileKey);
      const resolvedLastCustomProtocol: CustomProtocolType =
        activeMeta.provider === 'custom'
          ? activeMeta.customProtocol
          : config?.customProtocol === 'openai'
            ? 'openai'
            : config?.customProtocol === 'gemini'
              ? 'gemini'
              : 'anthropic';

      dispatch({
        type: 'APPLY_LOADED_STATE',
        payload: {
          presets: loadedPresets,
          profiles: bootstrap.snapshot.profiles,
          activeProfileKey: bootstrap.snapshot.activeProfileKey,
          enableThinking: bootstrap.snapshot.enableThinking,
          configSets: bootstrap.configSets,
          activeConfigSetId: bootstrap.activeConfigSetId,
          lastCustomProtocol: resolvedLastCustomProtocol,
          savedDraftSignature: buildApiConfigDraftSignature(
            bootstrap.snapshot.activeProfileKey,
            bootstrap.snapshot.profiles,
            bootstrap.snapshot.enableThinking
          ),
        },
      });
    },
    []
  );

  const applyPersistedConfigToStore = useCallback(
    (config: AppConfig, loadedPresets: ProviderPresets) => {
      applyLoadedState(config, loadedPresets);
      setAppConfig(config);
      setIsConfigured(Boolean(config.isConfigured));
    },
    [applyLoadedState, setAppConfig, setIsConfigured]
  );

  const updateActiveProfile = useCallback(
    (updater: (prev: UIProviderProfile) => UIProviderProfile) => {
      dispatch({ type: 'UPDATE_PROFILE_FN', profileKey: activeProfileKey, updater });
    },
    [activeProfileKey]
  );

  const changeProvider = useCallback(
    (newProvider: ProviderType) => {
      const nextProfileKey = profileKeyFromProvider(
        newProvider,
        newProvider === 'custom' ? lastCustomProtocol : 'anthropic'
      );
      dispatch({ type: 'SET_ACTIVE_PROFILE_KEY', payload: nextProfileKey });
    },
    [lastCustomProtocol]
  );

  const changeProtocol = useCallback((newProtocol: CustomProtocolType) => {
    dispatch({ type: 'SET_LAST_CUSTOM_PROTOCOL', payload: newProtocol });
    dispatch({
      type: 'SET_ACTIVE_PROFILE_KEY',
      payload: profileKeyFromProvider('custom', newProtocol),
    });
  }, []);

  const setApiKey = useCallback(
    (value: string) => {
      updateActiveProfile((prev) => ({ ...prev, apiKey: value }));
    },
    [updateActiveProfile]
  );

  const setBaseUrl = useCallback(
    (value: string) => {
      updateActiveProfile((prev) => ({ ...prev, baseUrl: value }));
    },
    [updateActiveProfile]
  );

  const setModel = useCallback(
    (value: string) => {
      updateActiveProfile((prev) => ({ ...prev, model: value, useCustomModel: false }));
    },
    [updateActiveProfile]
  );

  const setCustomModel = useCallback(
    (value: string) => {
      updateActiveProfile((prev) => ({ ...prev, customModel: value, useCustomModel: true }));
    },
    [updateActiveProfile]
  );

  const setContextWindow = useCallback(
    (value: string) => {
      updateActiveProfile((prev) => ({ ...prev, contextWindow: value }));
    },
    [updateActiveProfile]
  );

  const setMaxTokens = useCallback(
    (value: string) => {
      updateActiveProfile((prev) => ({ ...prev, maxTokens: value }));
    },
    [updateActiveProfile]
  );

  const applyCommonProviderSetup = useCallback(
    (setupId: string) => {
      const setup = COMMON_PROVIDER_SETUPS.find((item) => item.id === setupId);
      if (!setup) {
        return;
      }

      const nextProvider = setup.applyProvider;
      const nextProfileKey = profileKeyFromProvider(nextProvider, setup.recommendedProtocol);
      const nextModelState = buildSetupModelState(setup, nextProfileKey, presets);

      if (nextProvider === 'custom') {
        dispatch({ type: 'SET_LAST_CUSTOM_PROTOCOL', payload: setup.recommendedProtocol });
      }

      dispatch({
        type: 'UPDATE_PROFILE_FN',
        profileKey: nextProfileKey,
        updater: (current) => ({
          ...current,
          baseUrl: setup.recommendedBaseUrl,
          ...nextModelState,
        }),
      });
      dispatch({ type: 'SET_ACTIVE_PROFILE_KEY', payload: nextProfileKey });
    },
    [presets]
  );

  const toggleCustomModel = useCallback(() => {
    updateActiveProfile((prev) => {
      if (!prev.useCustomModel) {
        return {
          ...prev,
          useCustomModel: true,
          customModel: prev.customModel || prev.model,
        };
      }
      return {
        ...prev,
        useCustomModel: false,
      };
    });
  }, [updateActiveProfile]);

  // Public setter exposed to consumers — wraps dispatch so the interface stays stable
  const setEnableThinking = useCallback((value: boolean) => {
    dispatch({ type: 'SET_ENABLE_THINKING', payload: value });
  }, []);

  useEffect(() => {
    if (!enabled) {
      dispatch({ type: 'SET_LAST_SAVE_COMPLETED_AT', payload: 0 });
      return;
    }

    let cancelled = false;
    async function load() {
      dispatch({ type: 'SET_IS_LOADING_CONFIG', payload: true });
      try {
        const loadedPresets = isElectron
          ? await window.electronAPI.config.getPresets()
          : FALLBACK_PROVIDER_PRESETS;
        const config = initialConfig || (isElectron ? await window.electronAPI.config.get() : null);
        if (cancelled) {
          return;
        }
        applyLoadedState(config, loadedPresets);
      } catch (loadError) {
        if (!cancelled) {
          console.error('Failed to load API config:', loadError);
          applyLoadedState(initialConfig, FALLBACK_PROVIDER_PRESETS);
        }
      } finally {
        if (!cancelled) {
          dispatch({ type: 'SET_IS_LOADING_CONFIG', payload: false });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, initialConfig, applyLoadedState]);

  useEffect(() => {
    clearError();
    dispatch({ type: 'SET_TEST_RESULT', payload: null });
    dispatch({ type: 'SET_DIAGNOSTIC_RESULT', payload: null });
  }, [
    activeConfigSetId,
    activeProfileKey,
    apiKey,
    baseUrl,
    clearError,
    customModel,
    model,
    useCustomModel,
  ]);

  useEffect(() => {
    latestOllamaTargetRef.current = {
      activeProfileKey,
      baseUrl: baseUrl.trim(),
      provider,
    };
  }, [activeProfileKey, baseUrl, provider]);

  useEffect(() => {
    if (provider !== 'ollama') {
      return;
    }
    // Drop stale discovered model list when baseUrl changes
    dispatch({ type: 'DELETE_DISCOVERED_MODELS', profileKey: activeProfileKey });

    // If the current model came from discovered models and is not in presets,
    // reset to an endpoint-selected model once discovery runs again.
    const preset = modelPresetForProfile(activeProfileKey, presets);
    dispatch({
      type: 'UPDATE_PROFILE_FN',
      profileKey: activeProfileKey,
      updater: (current) => {
        if (current && !current.useCustomModel && current.model) {
          const inPreset = preset.models.some((m) => m.id === current.model);
          if (!inPreset) {
            return {
              ...current,
              model: provider === 'ollama' ? '' : preset.models[0]?.id || '',
            };
          }
        }
        return current;
      },
    });
  }, [activeProfileKey, baseUrl, provider, presets]);

  const handleTest = useCallback(async () => {
    if (requiresApiKey && !apiKey.trim()) {
      showErrorKey('api.testError.missing_key');
      return;
    }

    const finalModel = useCustomModel ? customModel.trim() : model;
    if (!finalModel) {
      showErrorKey('api.selectModelRequired');
      return;
    }

    if (provider === 'ollama' && !baseUrl.trim()) {
      showErrorKey('api.testError.missing_base_url');
      return;
    }

    clearError();
    dispatch({ type: 'SET_IS_TESTING', payload: true });
    dispatch({ type: 'SET_TEST_RESULT', payload: null });
    try {
      const resolvedBaseUrl =
        provider === 'custom' || provider === 'ollama'
          ? baseUrl.trim()
          : (baseUrl.trim() || currentPreset.baseUrl || '').trim();

      const result = await window.electronAPI.config.test({
        provider,
        apiKey: apiKey.trim(),
        baseUrl: resolvedBaseUrl || undefined,
        customProtocol,
        model: finalModel,
      });
      dispatch({ type: 'SET_TEST_RESULT', payload: result });
      if (result.ok && hasUnsavedChanges) {
        showSuccessKey('api.testSuccessNeedSave');
        setTimeout(() => clearSuccessMessage(), 2500);
      }
    } catch (testError) {
      dispatch({
        type: 'SET_TEST_RESULT',
        payload: {
          ok: false,
          errorType: 'unknown',
          details: testError instanceof Error ? testError.message : String(testError),
        },
      });
    } finally {
      dispatch({ type: 'SET_IS_TESTING', payload: false });
    }
  }, [
    apiKey,
    baseUrl,
    currentPreset.baseUrl,
    customModel,
    customProtocol,
    model,
    provider,
    requiresApiKey,
    hasUnsavedChanges,
    clearError,
    clearSuccessMessage,
    useCustomModel,
    showErrorKey,
    showSuccessKey,
  ]);

  const handleDiagnose = useCallback(
    async (verificationLevel: 'fast' | 'deep' = 'fast') => {
      if (requiresApiKey && !apiKey.trim()) {
        showErrorKey('api.testError.missing_key');
        return;
      }

      clearError();
      dispatch({ type: 'SET_IS_DIAGNOSING', payload: true });
      dispatch({ type: 'SET_DIAGNOSTIC_RESULT', payload: null });
      dispatch({ type: 'SET_TEST_RESULT', payload: null });
      try {
        const resolvedBaseUrl =
          provider === 'custom' || provider === 'ollama'
            ? baseUrl.trim()
            : (baseUrl.trim() || currentPreset.baseUrl || '').trim();

        const finalModel = useCustomModel ? customModel.trim() : model;

        const result = await window.electronAPI.config.diagnose({
          provider,
          apiKey: apiKey.trim(),
          baseUrl: resolvedBaseUrl || undefined,
          customProtocol,
          model: finalModel || undefined,
          verificationLevel,
        });
        dispatch({ type: 'SET_DIAGNOSTIC_RESULT', payload: result });
      } catch (err) {
        showErrorText((err as Error).message || 'Diagnosis failed');
      } finally {
        dispatch({ type: 'SET_IS_DIAGNOSING', payload: false });
      }
    },
    [
      requiresApiKey,
      apiKey,
      baseUrl,
      provider,
      customProtocol,
      model,
      customModel,
      useCustomModel,
      currentPreset.baseUrl,
      clearError,
      showErrorKey,
      showErrorText,
    ]
  );

  const handleDeepDiagnose = useCallback(async () => {
    await handleDiagnose('deep');
  }, [handleDiagnose]);

  const refreshModelOptions = useCallback(async () => {
    if (!isElectron || provider !== 'ollama') {
      return [];
    }

    const requestedProfileKey = activeProfileKey;
    const requestedBaseUrl = baseUrl.trim();
    const requestId = ++ollamaRefreshRequestIdRef.current;

    dispatch({ type: 'SET_IS_REFRESHING_MODELS', payload: true });
    clearError();
    try {
      const models = await window.electronAPI.config.listModels({
        provider,
        apiKey: apiKey.trim(),
        baseUrl: requestedBaseUrl || undefined,
      });

      const latestTarget = latestOllamaTargetRef.current;
      if (
        requestId !== ollamaRefreshRequestIdRef.current ||
        latestTarget.provider !== 'ollama' ||
        latestTarget.activeProfileKey !== requestedProfileKey ||
        latestTarget.baseUrl !== requestedBaseUrl
      ) {
        return models;
      }

      dispatch({ type: 'SET_DISCOVERED_MODELS', profileKey: requestedProfileKey, models });

      dispatch({
        type: 'UPDATE_PROFILE_FN',
        profileKey: requestedProfileKey,
        updater: (current) => {
          const explicitManualModel = current.useCustomModel ? current.customModel.trim() : '';
          const currentModel = explicitManualModel || current.model.trim();
          const hasDiscoveredMatch = models.some((item) => item.id === currentModel);
          const shouldAutoSelectModel =
            Boolean(models[0]?.id) &&
            !explicitManualModel &&
            (!currentModel || !hasDiscoveredMatch);

          return {
            ...current,
            model: shouldAutoSelectModel ? models[0]!.id : current.model,
            useCustomModel: shouldAutoSelectModel ? false : current.useCustomModel,
          };
        },
      });
      return models;
    } catch (refreshError) {
      const latestTarget = latestOllamaTargetRef.current;
      if (
        requestId !== ollamaRefreshRequestIdRef.current ||
        latestTarget.provider !== 'ollama' ||
        latestTarget.activeProfileKey !== requestedProfileKey ||
        latestTarget.baseUrl !== requestedBaseUrl
      ) {
        return [];
      }
      dispatch({ type: 'CLEAR_DISCOVERED_MODELS', profileKey: requestedProfileKey });
      if (refreshError instanceof Error) {
        showErrorText(refreshError.message);
      } else {
        showErrorKey('api.refreshModelsFailed');
      }
      return [];
    } finally {
      if (requestId === ollamaRefreshRequestIdRef.current) {
        dispatch({ type: 'SET_IS_REFRESHING_MODELS', payload: false });
      }
    }
  }, [
    activeProfileKey,
    apiKey,
    baseUrl,
    presets,
    provider,
    clearError,
    showErrorKey,
    showErrorText,
  ]);

  const applyDiscoveredOllamaState = useCallback(
    (
      targetProfileKey: ProviderProfileKey,
      discoveredBaseUrl: string,
      models: ProviderModelInfo[],
      options?: { autoSelectModelId?: string }
    ) => {
      const normalizedBaseUrl =
        normalizeOllamaBaseUrl(discoveredBaseUrl) || DEFAULT_OLLAMA_BASE_URL;

      dispatch({
        type: 'UPDATE_PROFILE_FN',
        profileKey: targetProfileKey,
        updater: (current) => {
          const autoSelectModelId = options?.autoSelectModelId?.trim() || '';
          const explicitManualModel = current.useCustomModel ? current.customModel.trim() : '';
          const currentModel = explicitManualModel || current.model.trim();
          const hasDiscoveredMatch = models.some((item) => item.id === currentModel);
          const shouldAutoSelectModel =
            Boolean(autoSelectModelId) &&
            !explicitManualModel &&
            (!currentModel || !hasDiscoveredMatch);

          return {
            ...current,
            baseUrl: normalizedBaseUrl,
            model: shouldAutoSelectModel ? autoSelectModelId : current.model,
            useCustomModel: shouldAutoSelectModel ? false : current.useCustomModel,
          };
        },
      });

      dispatch({ type: 'SET_DISCOVERED_MODELS', profileKey: targetProfileKey, models });
    },
    []
  );

  const discoverLocalOllama = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!isElectron || provider !== 'ollama') {
        return null;
      }

      const requestedProfileKey = activeProfileKey;
      const requestedBaseUrl = baseUrl.trim();
      const shouldClearDiscoveredModels = !requestedBaseUrl || isLoopbackBaseUrl(requestedBaseUrl);
      const requestId = ++ollamaDiscoverRequestIdRef.current;
      dispatch({ type: 'SET_IS_DISCOVERING_LOCAL_OLLAMA', payload: true });
      if (!options?.silent) {
        clearError();
      }

      try {
        const result = await window.electronAPI.config.discoverLocal({
          baseUrl: requestedBaseUrl || undefined,
        });
        const latestTarget = latestOllamaTargetRef.current;
        if (
          requestId !== ollamaDiscoverRequestIdRef.current ||
          latestTarget.provider !== 'ollama' ||
          latestTarget.activeProfileKey !== requestedProfileKey ||
          latestTarget.baseUrl !== requestedBaseUrl
        ) {
          return result;
        }
        if (!result.available) {
          if (shouldClearDiscoveredModels) {
            dispatch({ type: 'CLEAR_DISCOVERED_MODELS', profileKey: requestedProfileKey });
          }
          if (!options?.silent) {
            showErrorKey('api.localOllamaNotFound');
          }
          return result;
        }

        const models = normalizeDiscoveredOllamaModels(result.models);
        applyDiscoveredOllamaState(requestedProfileKey, result.baseUrl, models, {
          autoSelectModelId: models[0]?.id,
        });

        if (!options?.silent) {
          if (result.status === 'service_available') {
            showErrorKey('api.localOllamaNoModels');
          } else {
            showSuccessKey('api.localOllamaDiscovered', { count: models.length });
            setTimeout(() => clearSuccessMessage(), 2500);
          }
        }
        return result;
      } catch (discoveryError) {
        const latestTarget = latestOllamaTargetRef.current;
        if (
          requestId !== ollamaDiscoverRequestIdRef.current ||
          latestTarget.provider !== 'ollama' ||
          latestTarget.activeProfileKey !== requestedProfileKey ||
          latestTarget.baseUrl !== requestedBaseUrl
        ) {
          return null;
        }
        if (shouldClearDiscoveredModels) {
          dispatch({ type: 'CLEAR_DISCOVERED_MODELS', profileKey: requestedProfileKey });
        }
        if (!options?.silent) {
          if (discoveryError instanceof Error) {
            showErrorText(discoveryError.message);
          } else {
            showErrorKey('api.localOllamaNotFound');
          }
        }
        return null;
      } finally {
        if (requestId === ollamaDiscoverRequestIdRef.current) {
          dispatch({ type: 'SET_IS_DISCOVERING_LOCAL_OLLAMA', payload: false });
        }
      }
    },
    [
      activeProfileKey,
      applyDiscoveredOllamaState,
      baseUrl,
      clearError,
      clearSuccessMessage,
      provider,
      showErrorKey,
      showErrorText,
      showSuccessKey,
    ]
  );

  // Auto-refresh model list when Ollama baseUrl changes (debounced).
  // Only fires for URLs that look plausible (start with http(s):// and have a host).
  useEffect(() => {
    if (provider !== 'ollama') return;
    const trimmed = baseUrl.trim();
    if (!trimmed || !/^https?:\/\/.{3,}/i.test(trimmed)) return;
    const timer = setTimeout(() => {
      void refreshModelOptions();
    }, 800);
    return () => clearTimeout(timer);
  }, [provider, baseUrl, refreshModelOptions]);

  const handleSave = useCallback(
    async (options?: { silentSuccess?: boolean }) => {
      if (requiresApiKey && !apiKey.trim()) {
        showErrorKey('api.testError.missing_key');
        return false;
      }

      const finalModel = useCustomModel ? customModel.trim() : model;
      if (!finalModel) {
        showErrorKey('api.selectModelRequired');
        return false;
      }

      if (provider === 'ollama' && !baseUrl.trim()) {
        showErrorKey('api.testError.missing_base_url');
        return false;
      }

      clearError();
      dispatch({ type: 'SET_IS_SAVING', payload: true });
      try {
        const resolvedBaseUrl =
          provider === 'custom' || provider === 'ollama'
            ? baseUrl.trim()
            : (currentPreset.baseUrl || baseUrl).trim();

        const persistedProfiles = toPersistedProfiles(profiles);

        const payload: Partial<AppConfig> = {
          provider,
          apiKey: apiKey.trim(),
          baseUrl: resolvedBaseUrl || undefined,
          customProtocol,
          model: finalModel,
          activeProfileKey,
          profiles: persistedProfiles,
          activeConfigSetId,
          enableThinking,
        };

        if (onSave) {
          await onSave(payload);
        } else {
          const result = await window.electronAPI.config.save(payload);
          applyPersistedConfigToStore(result.config, presets);
        }

        dispatch({ type: 'SET_SAVED_DRAFT_SIGNATURE', payload: currentDraftSignature });
        if (!options?.silentSuccess) {
          showSuccessKey('common.saved');
          dispatch({ type: 'SET_LAST_SAVE_COMPLETED_AT', payload: Date.now() });
          setTimeout(() => clearSuccessMessage(), 2000);
        }
        return true;
      } catch (saveError) {
        if (saveError instanceof Error) {
          showErrorText(translateApiConfigErrorMessage(saveError.message, t));
        } else {
          showErrorKey('api.saveFailed');
        }
        return false;
      } finally {
        dispatch({ type: 'SET_IS_SAVING', payload: false });
      }
    },
    [
      activeConfigSetId,
      activeProfileKey,
      apiKey,
      applyPersistedConfigToStore,
      baseUrl,
      currentDraftSignature,
      currentPreset.baseUrl,
      customModel,
      customProtocol,
      enableThinking,
      model,
      onSave,
      presets,
      profiles,
      provider,
      requiresApiKey,
      clearError,
      clearSuccessMessage,
      showErrorKey,
      showErrorText,
      showSuccessKey,
      t,
      useCustomModel,
    ]
  );

  const switchConfigSet = useCallback(
    async (setId: string, options?: { silentSuccess?: boolean }) => {
      if (!isElectron) {
        return false;
      }

      dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: true });
      clearError();
      try {
        const result = await window.electronAPI.config.switchSet({ id: setId });
        applyPersistedConfigToStore(result.config, presets);
        if (!options?.silentSuccess) {
          showSuccessKey('api.configSetSwitched');
          setTimeout(() => clearSuccessMessage(), 1500);
        }
        return true;
      } catch (switchError) {
        if (switchError instanceof Error) {
          showErrorText(translateApiConfigErrorMessage(switchError.message, t));
        } else {
          showErrorKey('api.saveFailed');
        }
        return false;
      } finally {
        dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: false });
      }
    },
    [
      applyPersistedConfigToStore,
      clearError,
      clearSuccessMessage,
      presets,
      showErrorKey,
      showErrorText,
      showSuccessKey,
      t,
    ]
  );

  const createConfigSet = useCallback(
    async (payload: { name: string; mode: CreateMode }) => {
      if (!isElectron) {
        return false;
      }

      if (configSets.length >= CONFIG_SET_LIMIT) {
        showErrorKey('api.configSetLimitReached', { count: CONFIG_SET_LIMIT });
        return false;
      }

      const trimmed = payload.name.trim();
      if (!trimmed) {
        showErrorKey('api.configSetNameRequired');
        return false;
      }

      dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: true });
      clearError();
      try {
        const result = await window.electronAPI.config.createSet({
          name: trimmed,
          mode: payload.mode,
          fromSetId: payload.mode === 'clone' ? activeConfigSetId : undefined,
        });
        applyPersistedConfigToStore(result.config, presets);
        showSuccessKey('api.configSetCreated');
        setTimeout(() => clearSuccessMessage(), 1500);
        return true;
      } catch (createError) {
        if (createError instanceof Error) {
          showErrorText(translateApiConfigErrorMessage(createError.message, t));
        } else {
          showErrorKey('api.saveFailed');
        }
        return false;
      } finally {
        dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: false });
      }
    },
    [
      activeConfigSetId,
      applyPersistedConfigToStore,
      clearError,
      clearSuccessMessage,
      configSets.length,
      presets,
      showErrorKey,
      showErrorText,
      showSuccessKey,
      t,
    ]
  );

  const createBlankConfigSet = useCallback(async () => {
    await createConfigSet({
      name: t('api.newSetDefaultName'),
      mode: 'blank',
    });
  }, [createConfigSet, t]);

  const requestConfigSetSwitch = useCallback(
    async (setId: string) => {
      if (!setId || setId === activeConfigSetId) {
        return;
      }

      const action: PendingConfigSetAction = { type: 'switch', targetSetId: setId };
      if (hasUnsavedChanges) {
        dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: action });
        return;
      }

      await switchConfigSet(setId);
    },
    [activeConfigSetId, hasUnsavedChanges, switchConfigSet]
  );

  const continuePendingConfigSetAction = useCallback(
    async (action: PendingConfigSetAction) => {
      await switchConfigSet(action.targetSetId);
    },
    [switchConfigSet]
  );

  const cancelPendingConfigSetAction = useCallback(() => {
    dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: null });
  }, []);

  const saveAndContinuePendingConfigSetAction = useCallback(async () => {
    if (!pendingConfigSetAction) {
      return;
    }
    const action = pendingConfigSetAction;
    const saved = await handleSave({ silentSuccess: true });
    if (!saved) {
      return;
    }
    dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: null });
    await continuePendingConfigSetAction(action);
  }, [continuePendingConfigSetAction, handleSave, pendingConfigSetAction]);

  const discardAndContinuePendingConfigSetAction = useCallback(async () => {
    if (!pendingConfigSetAction) {
      return;
    }
    const action = pendingConfigSetAction;
    dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: null });
    await continuePendingConfigSetAction(action);
  }, [continuePendingConfigSetAction, pendingConfigSetAction]);

  const requestCreateBlankConfigSet = useCallback(async () => {
    if (hasUnsavedChanges) {
      const saved = await handleSave({ silentSuccess: true });
      if (!saved) {
        return;
      }
    }
    await createBlankConfigSet();
  }, [createBlankConfigSet, handleSave, hasUnsavedChanges]);

  const renameConfigSet = useCallback(
    async (id: string, name: string) => {
      if (!isElectron) {
        return false;
      }

      const trimmed = name.trim();
      if (!trimmed) {
        showErrorKey('api.configSetNameRequired');
        return false;
      }

      dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: true });
      clearError();
      try {
        const result = await window.electronAPI.config.renameSet({ id, name: trimmed });
        applyPersistedConfigToStore(result.config, presets);
        showSuccessKey('api.configSetRenamed');
        setTimeout(() => clearSuccessMessage(), 1500);
        return true;
      } catch (renameError) {
        if (renameError instanceof Error) {
          showErrorText(translateApiConfigErrorMessage(renameError.message, t));
        } else {
          showErrorKey('api.saveFailed');
        }
        return false;
      } finally {
        dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: false });
      }
    },
    [
      applyPersistedConfigToStore,
      clearError,
      clearSuccessMessage,
      presets,
      showErrorKey,
      showErrorText,
      showSuccessKey,
      t,
    ]
  );

  const deleteConfigSet = useCallback(
    async (id: string) => {
      if (!isElectron) {
        return false;
      }

      dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: true });
      clearError();
      try {
        const result = await window.electronAPI.config.deleteSet({ id });
        applyPersistedConfigToStore(result.config, presets);
        showSuccessKey('api.configSetDeleted');
        setTimeout(() => clearSuccessMessage(), 1500);
        return true;
      } catch (deleteError) {
        if (deleteError instanceof Error) {
          showErrorText(translateApiConfigErrorMessage(deleteError.message, t));
        } else {
          showErrorKey('api.saveFailed');
        }
        return false;
      } finally {
        dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: false });
      }
    },
    [
      applyPersistedConfigToStore,
      clearError,
      clearSuccessMessage,
      presets,
      showErrorKey,
      showErrorText,
      showSuccessKey,
      t,
    ]
  );

  const canDeleteCurrentConfigSet = Boolean(
    currentConfigSet && !currentConfigSet.isSystem && configSets.length > 1
  );

  return {
    isLoadingConfig,
    presets,
    provider,
    customProtocol,
    modelOptions,
    currentPreset,
    apiKey,
    baseUrl,
    model,
    customModel,
    useCustomModel,
    contextWindow,
    maxTokens,
    modelInputPlaceholder: modelInputGuidance.placeholder,
    modelInputHint: modelInputGuidance.hint,
    enableThinking,
    isSaving,
    isTesting,
    isRefreshingModels,
    isDiscoveringLocalOllama,
    error,
    successMessage,
    lastSaveCompletedAt,
    testResult,
    friendlyTestDetails,
    diagnosticResult,
    isDiagnosing,
    handleDiagnose,
    handleDeepDiagnose,
    isOllamaMode: provider === 'ollama',
    shouldShowOllamaManualModelToggle,
    requiresApiKey,
    detectedProviderSetup,
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
    configSetLimit: CONFIG_SET_LIMIT,
    setApiKey,
    setBaseUrl,
    setModel,
    setCustomModel,
    setContextWindow,
    setMaxTokens,
    toggleCustomModel,
    setEnableThinking,
    applyCommonProviderSetup,
    changeProvider,
    changeProtocol,
    requestConfigSetSwitch,
    requestCreateBlankConfigSet,
    cancelPendingConfigSetAction,
    saveAndContinuePendingConfigSetAction,
    discardAndContinuePendingConfigSetAction,
    createConfigSet,
    renameConfigSet,
    deleteConfigSet,
    handleSave,
    handleTest,
    refreshModelOptions,
    discoverLocalOllama,
    setError: showErrorText,
    setSuccessMessage: showSuccessText,
  };
}
