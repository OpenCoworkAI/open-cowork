import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ApiConfigSet,
  AppConfig,
  ApiTestResult,
  CustomProtocolType,
  ProviderProfile,
  ProviderProfileKey,
  ProviderPresets,
  ProviderType,
} from '../types';
import { isLoopbackBaseUrl } from '../../shared/network/loopback';
import { API_PROVIDER_PRESETS, getModelInputGuidance } from '../../shared/api-model-presets';
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

type PendingConfigSetAction =
  | { type: 'switch'; targetSetId: string };

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
const CONFIG_SET_LIMIT = 20;
const DEFAULT_CONFIG_SET_ID = 'default';
const DEFAULT_CONFIG_SET_NAME_ZH = '默认方案';

export const FALLBACK_PROVIDER_PRESETS: ProviderPresets = API_PROVIDER_PRESETS;

const PROFILE_KEYS: ProviderProfileKey[] = [
  'openrouter',
  'anthropic',
  'openai',
  'gemini',
  'custom:anthropic',
  'custom:openai',
  'custom:gemini',
];

function isProfileKey(value: unknown): value is ProviderProfileKey {
  return typeof value === 'string' && PROFILE_KEYS.includes(value as ProviderProfileKey);
}

function isProviderType(value: unknown): value is ProviderType {
  return value === 'openrouter' || value === 'anthropic' || value === 'custom' || value === 'openai' || value === 'gemini';
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

function modelPresetForProfile(profileKey: ProviderProfileKey, presets: ProviderPresets) {
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

function defaultProfileForKey(profileKey: ProviderProfileKey, presets: ProviderPresets): UIProviderProfile {
  const preset = modelPresetForProfile(profileKey, presets);
  const prefersCustomInput = profileKey.startsWith('custom:');
  return {
    apiKey: '',
    baseUrl: preset.baseUrl,
    model: preset.models[0]?.id || '',
    customModel: '',
    useCustomModel: prefersCustomInput,
  };
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
    };
  }

  const modelValue = profile?.model?.trim() || fallback.model;
  const hasPresetModel = modelPresetForProfile(profileKey, presets).models.some((item) => item.id === modelValue);
  return {
    apiKey: profile?.apiKey || '',
    baseUrl: profile?.baseUrl?.trim() || fallback.baseUrl,
    model: hasPresetModel ? modelValue : fallback.model,
    customModel: hasPresetModel ? '' : modelValue,
    useCustomModel: !hasPresetModel,
  };
}

export function buildApiConfigSnapshot(config: AppConfig | null | undefined, presets: ProviderPresets): ConfigStateSnapshot {
  const provider = config?.provider || 'openrouter';
  const customProtocol: CustomProtocolType = config?.customProtocol === 'openai'
    ? 'openai'
    : config?.customProtocol === 'gemini'
      ? 'gemini'
      : 'anthropic';
  const derivedProfileKey = profileKeyFromProvider(provider, customProtocol);
  const activeProfileKey = isProfileKey(config?.activeProfileKey) ? config.activeProfileKey : derivedProfileKey;

  const profiles = {} as Record<ProviderProfileKey, UIProviderProfile>;
  for (const key of PROFILE_KEYS) {
    profiles[key] = normalizeProfile(key, config?.profiles?.[key], presets);
  }

  const hasProfilesFromConfig = Boolean(config?.profiles && Object.keys(config.profiles).length > 0);
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
      ? (profile.customModel.trim() || profile.model)
      : profile.model;
    persisted[key] = {
      apiKey: profile.apiKey,
      baseUrl: profile.baseUrl.trim() || undefined,
      model: finalModel,
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

export function buildApiConfigSets(config: AppConfig | null | undefined, presets: ProviderPresets): ApiConfigSet[] {
  const now = new Date().toISOString();

  if (config?.configSets && config.configSets.length > 0) {
    return config.configSets.map((set, index) => {
      const provider = isProviderType(set.provider) ? set.provider : 'openrouter';
      const customProtocol = isCustomProtocol(set.customProtocol) ? set.customProtocol : 'anthropic';
      const fallbackActive = profileKeyFromProvider(provider, customProtocol);
      const activeProfileKey = isProfileKey(set.activeProfileKey) ? set.activeProfileKey : fallbackActive;

      const normalizedProfiles = {} as Record<ProviderProfileKey, ProviderProfile>;
      for (const key of PROFILE_KEYS) {
        const uiProfile = normalizeProfile(key, set.profiles?.[key], presets);
        normalizedProfiles[key] = {
          apiKey: uiProfile.apiKey,
          baseUrl: uiProfile.baseUrl,
          model: uiProfile.useCustomModel ? (uiProfile.customModel.trim() || uiProfile.model) : uiProfile.model,
        };
      }

      return {
        ...set,
        id: typeof set.id === 'string' && set.id.trim() ? set.id : `set-${index + 1}`,
        name: typeof set.name === 'string' && set.name.trim() ? set.name : `配置方案 ${index + 1}`,
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
  const fallbackId = typeof config?.activeConfigSetId === 'string' && config.activeConfigSetId.trim()
    ? config.activeConfigSetId
    : DEFAULT_CONFIG_SET_ID;

  return [{
    id: fallbackId,
    name: DEFAULT_CONFIG_SET_NAME_ZH,
    isSystem: true,
    provider: activeMeta.provider,
    customProtocol: activeMeta.customProtocol,
    activeProfileKey: snapshot.activeProfileKey,
    profiles: toPersistedProfiles(snapshot.profiles),
    enableThinking: snapshot.enableThinking,
    updatedAt: now,
  }];
}

export function buildApiConfigBootstrap(
  config: AppConfig | null | undefined,
  presets: ProviderPresets
): ApiConfigBootstrap {
  const snapshot = buildApiConfigSnapshot(config, presets);
  const configSets = buildApiConfigSets(config, presets);
  const activeConfigSetId =
    typeof config?.activeConfigSetId === 'string' && configSets.some((set) => set.id === config.activeConfigSetId)
      ? config.activeConfigSetId
      : configSets[0]?.id || DEFAULT_CONFIG_SET_ID;

  return {
    snapshot,
    configSets,
    activeConfigSetId,
  };
}

export function useApiConfigState(options: UseApiConfigStateOptions = {}) {
  const { t } = useTranslation();
  const { enabled = true, initialConfig, onSave } = options;
  const initialBootstrapRef = useRef<ApiConfigBootstrap | null>(null);
  if (!initialBootstrapRef.current) {
    initialBootstrapRef.current = buildApiConfigBootstrap(initialConfig, FALLBACK_PROVIDER_PRESETS);
  }
  const initialBootstrap = initialBootstrapRef.current;

  const [presets, setPresets] = useState<ProviderPresets>(FALLBACK_PROVIDER_PRESETS);
  const [profiles, setProfiles] = useState<Record<ProviderProfileKey, UIProviderProfile>>(() => initialBootstrap.snapshot.profiles);
  const [activeProfileKey, setActiveProfileKey] = useState<ProviderProfileKey>(() => initialBootstrap.snapshot.activeProfileKey);

  const [configSets, setConfigSets] = useState<ApiConfigSet[]>(() => initialBootstrap.configSets);
  const [activeConfigSetId, setActiveConfigSetId] = useState<string>(() => initialBootstrap.activeConfigSetId);
  const [pendingConfigSetAction, setPendingConfigSetAction] = useState<PendingConfigSetAction | null>(null);
  const [isMutatingConfigSet, setIsMutatingConfigSet] = useState(false);

  const [lastCustomProtocol, setLastCustomProtocol] = useState<CustomProtocolType>(() => (
    initialConfig?.customProtocol === 'openai'
      ? 'openai'
      : initialConfig?.customProtocol === 'gemini'
        ? 'gemini'
        : 'anthropic'
  ));
  const [enableThinking, setEnableThinking] = useState(Boolean(initialConfig?.enableThinking));
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [savedDraftSignature, setSavedDraftSignature] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [testResult, setTestResult] = useState<ApiTestResult | null>(null);
  const [useLiveTest, setUseLiveTest] = useState(false);

  const providerMeta = useMemo(() => profileKeyToProvider(activeProfileKey), [activeProfileKey]);
  const provider = providerMeta.provider;
  const customProtocol = providerMeta.customProtocol;
  const currentProfile = profiles[activeProfileKey] || defaultProfileForKey(activeProfileKey, presets);
  const modelPreset = modelPresetForProfile(activeProfileKey, presets);
  const currentPreset = modelPreset;
  const modelOptions = modelPreset.models;
  const modelInputGuidance = getModelInputGuidance(provider, customProtocol);

  const currentConfigSet = useMemo(
    () => configSets.find((set) => set.id === activeConfigSetId) || null,
    [configSets, activeConfigSetId]
  );
  const pendingConfigSet = useMemo(
    () => pendingConfigSetAction?.type === 'switch'
      ? (configSets.find((set) => set.id === pendingConfigSetAction.targetSetId) || null)
      : null,
    [configSets, pendingConfigSetAction]
  );

  const apiKey = currentProfile.apiKey;
  const baseUrl = currentProfile.baseUrl;
  const model = currentProfile.model;
  const customModel = currentProfile.customModel;
  const useCustomModel = currentProfile.useCustomModel;

  const isOpenAIMode = provider === 'openai' || (provider === 'custom' && customProtocol === 'openai');
  const allowEmptyApiKey = provider === 'custom' && (
    (customProtocol === 'anthropic' && isCustomAnthropicLoopbackGateway(baseUrl))
    || (customProtocol === 'gemini' && isCustomGeminiLoopbackGateway(baseUrl))
  );
  const requiresApiKey = !isOpenAIMode && !allowEmptyApiKey;
  const showsCompatibilityProbeHint = provider === 'openrouter' || (provider === 'custom' && customProtocol === 'anthropic');

  const currentDraftSignature = useMemo(
    () => buildApiConfigDraftSignature(activeProfileKey, profiles, enableThinking),
    [activeProfileKey, profiles, enableThinking]
  );
  const hasUnsavedChanges = savedDraftSignature !== '' && currentDraftSignature !== savedDraftSignature;

  const applyLoadedState = useCallback((config: AppConfig | null | undefined, loadedPresets: ProviderPresets) => {
    const bootstrap = buildApiConfigBootstrap(config, loadedPresets);

    setPresets(loadedPresets);
    setProfiles(bootstrap.snapshot.profiles);
    setActiveProfileKey(bootstrap.snapshot.activeProfileKey);
    setEnableThinking(bootstrap.snapshot.enableThinking);
    setConfigSets(bootstrap.configSets);
    setActiveConfigSetId(bootstrap.activeConfigSetId);
    setPendingConfigSetAction(null);

    const activeMeta = profileKeyToProvider(bootstrap.snapshot.activeProfileKey);
    if (activeMeta.provider === 'custom') {
      setLastCustomProtocol(activeMeta.customProtocol);
    } else {
      setLastCustomProtocol(
        config?.customProtocol === 'openai'
          ? 'openai'
          : config?.customProtocol === 'gemini'
            ? 'gemini'
            : 'anthropic'
      );
    }

    setSavedDraftSignature(buildApiConfigDraftSignature(
      bootstrap.snapshot.activeProfileKey,
      bootstrap.snapshot.profiles,
      bootstrap.snapshot.enableThinking
    ));
  }, []);

  const updateActiveProfile = useCallback((updater: (prev: UIProviderProfile) => UIProviderProfile) => {
    setProfiles((prev) => ({
      ...prev,
      [activeProfileKey]: updater(prev[activeProfileKey] || defaultProfileForKey(activeProfileKey, presets)),
    }));
  }, [activeProfileKey, presets]);

  const changeProvider = useCallback((newProvider: ProviderType) => {
    const nextProfileKey = profileKeyFromProvider(
      newProvider,
      newProvider === 'custom' ? lastCustomProtocol : 'anthropic'
    );
    setActiveProfileKey(nextProfileKey);
  }, [lastCustomProtocol]);

  const changeProtocol = useCallback((newProtocol: CustomProtocolType) => {
    setLastCustomProtocol(newProtocol);
    setActiveProfileKey(profileKeyFromProvider('custom', newProtocol));
  }, []);

  const setApiKey = useCallback((value: string) => {
    updateActiveProfile((prev) => ({ ...prev, apiKey: value }));
  }, [updateActiveProfile]);

  const setBaseUrl = useCallback((value: string) => {
    updateActiveProfile((prev) => ({ ...prev, baseUrl: value }));
  }, [updateActiveProfile]);

  const setModel = useCallback((value: string) => {
    updateActiveProfile((prev) => ({ ...prev, model: value, useCustomModel: false }));
  }, [updateActiveProfile]);

  const setCustomModel = useCallback((value: string) => {
    updateActiveProfile((prev) => ({ ...prev, customModel: value, useCustomModel: true }));
  }, [updateActiveProfile]);

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

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    async function load() {
      setIsLoadingConfig(true);
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
          setIsLoadingConfig(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, initialConfig, applyLoadedState]);

  useEffect(() => {
    setError('');
    setTestResult(null);
  }, [activeConfigSetId, activeProfileKey, apiKey, baseUrl, model, customModel, useCustomModel]);

  const handleTest = useCallback(async () => {
    if (requiresApiKey && !apiKey.trim()) {
      setError(t('api.testError.missing_key'));
      return;
    }

    const finalModel = useCustomModel ? customModel.trim() : model;
    if (!finalModel) {
      setError(t('api.selectModelRequired'));
      return;
    }

    setError('');
    setIsTesting(true);
    setTestResult(null);
    try {
      const resolvedBaseUrl = provider === 'custom'
        ? baseUrl.trim()
        : (currentPreset.baseUrl || baseUrl).trim();

      const result = await window.electronAPI.config.test({
        provider,
        apiKey: apiKey.trim(),
        baseUrl: resolvedBaseUrl || undefined,
        customProtocol,
        model: finalModel,
        useLiveRequest: useLiveTest,
      });
      setTestResult(result);
      if (result.ok && hasUnsavedChanges) {
        setSuccessMessage(t('api.testSuccessNeedSave', { defaultValue: '连接测试成功，请点击“保存设置”后再开始会话。' }));
        setTimeout(() => setSuccessMessage(''), 2500);
      }
    } catch (testError) {
      setTestResult({
        ok: false,
        errorType: 'unknown',
        details: testError instanceof Error ? testError.message : String(testError),
      });
    } finally {
      setIsTesting(false);
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
    t,
    useCustomModel,
    useLiveTest,
  ]);

  const handleSave = useCallback(async (options?: { silentSuccess?: boolean }) => {
    if (requiresApiKey && !apiKey.trim()) {
      setError(t('api.testError.missing_key'));
      return false;
    }

    const finalModel = useCustomModel ? customModel.trim() : model;
    if (!finalModel) {
      setError(t('api.selectModelRequired'));
      return false;
    }

    setError('');
    setIsSaving(true);
    try {
      const resolvedBaseUrl = provider === 'custom'
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
        applyLoadedState(result.config, presets);
      }

      setSavedDraftSignature(currentDraftSignature);
      if (!options?.silentSuccess) {
        setSuccessMessage(t('common.saved'));
        setTimeout(() => setSuccessMessage(''), 2000);
      }
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('api.saveFailed'));
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [
    activeConfigSetId,
    activeProfileKey,
    apiKey,
    applyLoadedState,
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
    t,
    useCustomModel,
  ]);

  const switchConfigSet = useCallback(async (setId: string, options?: { silentSuccess?: boolean }) => {
    if (!isElectron) {
      return false;
    }

    setIsMutatingConfigSet(true);
    setError('');
    try {
      const result = await window.electronAPI.config.switchSet({ id: setId });
      applyLoadedState(result.config, presets);
      if (!options?.silentSuccess) {
        setSuccessMessage(t('api.configSetSwitched'));
        setTimeout(() => setSuccessMessage(''), 1500);
      }
      return true;
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : t('api.saveFailed'));
      return false;
    } finally {
      setIsMutatingConfigSet(false);
    }
  }, [applyLoadedState, presets, t]);

  const createConfigSet = useCallback(async (payload: { name: string; mode: CreateMode }) => {
    if (!isElectron) {
      return false;
    }

    if (configSets.length >= CONFIG_SET_LIMIT) {
      setError(t('api.configSetLimitReached', { count: CONFIG_SET_LIMIT }));
      return false;
    }

    const trimmed = payload.name.trim();
    if (!trimmed) {
      setError(t('api.configSetNameRequired'));
      return false;
    }

    setIsMutatingConfigSet(true);
    setError('');
    try {
      const result = await window.electronAPI.config.createSet({
        name: trimmed,
        mode: payload.mode,
        fromSetId: payload.mode === 'clone' ? activeConfigSetId : undefined,
      });
      applyLoadedState(result.config, presets);
      setSuccessMessage(t('api.configSetCreated'));
      setTimeout(() => setSuccessMessage(''), 1500);
      return true;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('api.saveFailed'));
      return false;
    } finally {
      setIsMutatingConfigSet(false);
    }
  }, [activeConfigSetId, applyLoadedState, configSets.length, presets, t]);

  const createBlankConfigSet = useCallback(async () => {
    await createConfigSet({
      name: t('api.newSetDefaultName'),
      mode: 'blank',
    });
  }, [createConfigSet, t]);

  const requestConfigSetSwitch = useCallback(async (setId: string) => {
    if (!setId || setId === activeConfigSetId) {
      return;
    }

    const action: PendingConfigSetAction = { type: 'switch', targetSetId: setId };
    if (hasUnsavedChanges) {
      setPendingConfigSetAction(action);
      return;
    }

    await switchConfigSet(setId);
  }, [activeConfigSetId, hasUnsavedChanges, switchConfigSet]);

  const continuePendingConfigSetAction = useCallback(async (action: PendingConfigSetAction) => {
    await switchConfigSet(action.targetSetId);
  }, [switchConfigSet]);

  const cancelPendingConfigSetAction = useCallback(() => {
    setPendingConfigSetAction(null);
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
    setPendingConfigSetAction(null);
    await continuePendingConfigSetAction(action);
  }, [continuePendingConfigSetAction, handleSave, pendingConfigSetAction]);

  const discardAndContinuePendingConfigSetAction = useCallback(async () => {
    if (!pendingConfigSetAction) {
      return;
    }
    const action = pendingConfigSetAction;
    setPendingConfigSetAction(null);
    await continuePendingConfigSetAction(action);
  }, [continuePendingConfigSetAction, pendingConfigSetAction]);

  const requestCreateBlankConfigSet = useCallback(async () => {
    if (hasUnsavedChanges) {
      await handleSave({ silentSuccess: true });
    }
    await createBlankConfigSet();
  }, [createBlankConfigSet, handleSave, hasUnsavedChanges]);

  const renameConfigSet = useCallback(async (id: string, name: string) => {
    if (!isElectron) {
      return false;
    }

    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('api.configSetNameRequired'));
      return false;
    }

    setIsMutatingConfigSet(true);
    setError('');
    try {
      const result = await window.electronAPI.config.renameSet({ id, name: trimmed });
      applyLoadedState(result.config, presets);
      setSuccessMessage(t('api.configSetRenamed'));
      setTimeout(() => setSuccessMessage(''), 1500);
      return true;
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : t('api.saveFailed'));
      return false;
    } finally {
      setIsMutatingConfigSet(false);
    }
  }, [applyLoadedState, presets, t]);

  const deleteConfigSet = useCallback(async (id: string) => {
    if (!isElectron) {
      return false;
    }

    setIsMutatingConfigSet(true);
    setError('');
    try {
      const result = await window.electronAPI.config.deleteSet({ id });
      applyLoadedState(result.config, presets);
      setSuccessMessage(t('api.configSetDeleted'));
      setTimeout(() => setSuccessMessage(''), 1500);
      return true;
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t('api.saveFailed'));
      return false;
    } finally {
      setIsMutatingConfigSet(false);
    }
  }, [applyLoadedState, presets, t]);

  const canDeleteCurrentConfigSet = Boolean(currentConfigSet && !currentConfigSet.isSystem && configSets.length > 1);

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
    modelInputPlaceholder: modelInputGuidance.placeholder,
    modelInputHint: modelInputGuidance.hint,
    enableThinking,
    isSaving,
    isTesting,
    error,
    successMessage,
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
    configSetLimit: CONFIG_SET_LIMIT,
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
    createConfigSet,
    renameConfigSet,
    deleteConfigSet,
    handleSave,
    handleTest,
    setError,
    setSuccessMessage,
  };
}
