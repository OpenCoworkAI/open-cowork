/**
 * @module main/config/config-store
 *
 * Persistent application configuration (1373 lines).
 *
 * Responsibilities:
 * - electron-store backed config persistence (API keys, model presets, settings)
 * - Config set management: create, rename, delete, switch between config profiles
 * - API key validation and provider credential resolution
 * - Model preset definitions (Anthropic, OpenAI, Gemini, OpenRouter, Ollama)
 *
 * Dependencies: electron-store, auth-utils, api-model-presets
 */
import Store, { type Options as StoreOptions } from 'electron-store';
import { log, logWarn } from '../utils/logger';
import {
  createEncryptedStoreWithKeyRotation,
  getLegacyDerivedKeyHexes,
} from '../utils/store-encryption';
import {
  isOpenAIProvider,
  isOllamaLegacyCustomOpenAIConfig,
  normalizeAnthropicBaseUrl,
  normalizeOllamaBaseUrl,
  resolveOllamaCredentials,
  resolveOpenAICredentials,
  shouldAllowEmptyOllamaApiKey,
  shouldAllowEmptyAnthropicApiKey,
  shouldAllowEmptyGeminiApiKey,
  shouldUseAnthropicAuthToken,
} from './auth-utils';
import { API_PROVIDER_PRESETS, PI_AI_CURATED_PRESETS } from '../../shared/api-model-presets';
import {
  setGetCurrentLanguageFn as setErrorLanguageFn,
  createError,
  ERROR_CODES,
} from '../../shared/error-messages';

/**
 * Application configuration schema
 */
export type ProviderType = 'openrouter' | 'anthropic' | 'custom' | 'openai' | 'gemini' | 'ollama';
export type CustomProtocolType = 'anthropic' | 'openai' | 'gemini';
export type AppTheme = 'dark' | 'light' | 'system';
export type ProviderProfileKey =
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'ollama'
  | 'custom:anthropic'
  | 'custom:openai'
  | 'custom:gemini';
export type ConfigSetId = string;
export type CreateSetMode = 'blank' | 'clone';

export interface CreateConfigSetPayload {
  name: string;
  mode?: CreateSetMode;
  fromSetId?: string;
}

export interface ProviderProfile {
  apiKey: string;
  baseUrl?: string;
  model: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ApiConfigSet {
  id: ConfigSetId;
  name: string;
  isSystem?: boolean;
  provider: ProviderType;
  customProtocol: CustomProtocolType;
  activeProfileKey: ProviderProfileKey;
  profiles: Partial<Record<ProviderProfileKey, ProviderProfile>>;
  enableThinking: boolean;
  updatedAt: string;
}

export interface AppConfig {
  // API Provider
  provider: ProviderType;

  // API credentials
  apiKey: string;
  baseUrl?: string;
  customProtocol?: CustomProtocolType;

  // Model selection
  model: string;
  contextWindow?: number;
  maxTokens?: number;

  // Active profile
  activeProfileKey: ProviderProfileKey;
  profiles: Partial<Record<ProviderProfileKey, ProviderProfile>>;

  // Active config set
  activeConfigSetId: ConfigSetId;
  configSets: ApiConfigSet[];

  // Optional: Claude Code CLI path override
  claudeCodePath?: string;

  // Optional: Default working directory
  defaultWorkdir?: string;

  // Optional: Global skills storage directory
  globalSkillsPath?: string;

  // Developer logs
  enableDevLogs: boolean;

  // UI theme preference
  theme: AppTheme;

  // Sandbox mode (WSL/Lima isolation)
  sandboxEnabled: boolean;

  // Enable thinking mode (show thinking steps)
  enableThinking: boolean;

  // First run flag
  isConfigured: boolean;

  // Agent runner messages (multilingual support)
  agentRunnerMessages?: AgentRunnerMessages;

  // App-level messages for UI and system
  appMessages?: AppMessages;
}

export interface AgentRunnerMessages {
  en: AgentRunnerMessageStrings;
  zh: AgentRunnerMessageStrings;
}

export interface AgentRunnerMessageStrings {
  processingRequest: string;
  waitingForModel: string;
  contextCompaction: string;
  requestTimedOut: string;
  cancelled: string;
  errorOccurred: string;
  sandboxSyncing: string;
  sandboxConfiguring: string;
  sandboxReady: string;
  sandboxSyncFailed: string;
  sandboxFallback: string;
  taskCompleted: string;
  requestFailed: string;
  commandCancelled: string;
}

export interface AppMessages {
  en: AppMessageStrings;
  zh: AppMessageStrings;
}

export interface AppMessageStrings {
  defaultSession: string;
  newSession: string;
  untitledSession: string;
  directoryNotFound: string;
  chromeNotReady: string;
  channelNotFound: string;
  channelTypeNotFound: string;
  requestBodyTooLarge: string;
  internalServerError: string;
  notFound: string;
  sessionBuildTitlePrompt: string;
  sessionBuildTitlePromptNew: string;
  sessionBuildTitlePromptRename: string;
  toolNoMountedWorkspace: string;
  toolInvalidOrUnauthorizedPath: string;
  toolPathOutsideWorkspace: string;
  toolCommandFailed: string;
  toolFileNotFound: string;
  toolStringNotFound: string;
  toolEditFailed: string;
  toolSearchFailed: string;
  toolGlobFailed: string;
  toolGrepFailed: string;
  toolUrlRequired: string;
  toolInvalidUrl: string;
  toolOnlyHttpsSupported: string;
  toolRequestTimeout: string;
  toolQueryRequired: string;
  apiKeyPlaceholder: string;
  apiKeyHint: string;
  baseUrlHint: string;
  taskDefaultTitle: string;
  // Remote manager messages
  yourAnswerNeeded: string;
  yourAuthorizationNeeded: string;
  toolParameters: string;
  replyToAuthorize: string;
  replyToDeny: string;
  replyToAlways: string;
  replyDirectly: string;
  replyWithOptionNumber: string;
  multipleSelectionAllowed: string;
  skipToSkip: string;
  // Session title messages
  generateTitleRules: string;
  generateTitleFromPrompt: string;
}

const DEFAULT_CONFIG_SET_ID = 'default';
const MAX_CONFIG_SET_COUNT = 20;
const LOCAL_ANTHROPIC_PLACEHOLDER_KEY = 'sk-ant-local-proxy';
const DIRECT_READ_KEYS = new Set<keyof AppConfig>([
  'provider',
  'apiKey',
  'baseUrl',
  'customProtocol',
  'activeProfileKey',
  'activeConfigSetId',
  'claudeCodePath',
  'defaultWorkdir',
  'globalSkillsPath',
  'enableDevLogs',
  'theme',
  'sandboxEnabled',
  'enableThinking',
  'isConfigured',
]);

const defaultProfiles: Record<ProviderProfileKey, ProviderProfile> = {
  openrouter: {
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4-6',
  },
  anthropic: {
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-6',
  },
  openai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4',
  },
  ollama: {
    apiKey: '',
    baseUrl: 'http://localhost:11434/v1',
    model: '',
  },
  gemini: {
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
  },
  'custom:anthropic': {
    apiKey: '',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    model: 'glm-5',
  },
  'custom:openai': {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4',
  },
  'custom:gemini': {
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
  },
};

const defaultConfigSet: ApiConfigSet = {
  id: DEFAULT_CONFIG_SET_ID,
  name: 'Default Config',
  isSystem: true,
  provider: 'openrouter',
  customProtocol: 'anthropic',
  activeProfileKey: 'openrouter',
  profiles: defaultProfiles,
  enableThinking: false,
  updatedAt: '1970-01-01T00:00:00.000Z',
};

const defaultConfig: AppConfig = {
  provider: defaultConfigSet.provider,
  apiKey: defaultProfiles.openrouter.apiKey,
  baseUrl: defaultProfiles.openrouter.baseUrl,
  customProtocol: defaultConfigSet.customProtocol,
  model: defaultProfiles.openrouter.model,
  activeProfileKey: defaultConfigSet.activeProfileKey,
  profiles: defaultProfiles,
  activeConfigSetId: DEFAULT_CONFIG_SET_ID,
  configSets: [defaultConfigSet],
  claudeCodePath: '',
  defaultWorkdir: '',
  globalSkillsPath: '',
  enableDevLogs: false,
  theme: 'light',
  sandboxEnabled: false,
  enableThinking: false,
  isConfigured: false,
  agentRunnerMessages: {
    en: {
      processingRequest: 'Processing request...',
      waitingForModel: 'Waiting for model to load into memory...',
      contextCompaction: 'Compacting context ({{reason}})...',
      requestTimedOut: 'Request timed out',
      cancelled: 'Cancelled',
      errorOccurred: 'Error occurred',
      sandboxSyncing: 'Syncing files to sandbox...',
      sandboxConfiguring: 'Configuring skills...',
      sandboxReady: 'Sandbox ready',
      sandboxSyncFailed: 'Sandbox sync failed',
      sandboxFallback: 'Falling back to direct access mode (less secure)',
      taskCompleted: 'Task completed',
      requestFailed: 'Request failed',
      commandCancelled: 'Command cancelled: user denied sudo password.',
    },
    zh: {
      processingRequest: '正在处理请求...',
      waitingForModel: '正在加载模型到内存...',
      contextCompaction: '正在压缩上下文 ({{reason}})...',
      requestTimedOut: '请求超时',
      cancelled: '已取消',
      errorOccurred: '发生错误',
      sandboxSyncing: '正在同步文件到沙盒...',
      sandboxConfiguring: '正在配置技能...',
      sandboxReady: '沙盒就绪',
      sandboxSyncFailed: '沙盒同步失败',
      sandboxFallback: '正在回退到直接访问模式（安全性较低）',
      taskCompleted: '任务完成',
      requestFailed: '请求失败',
      commandCancelled: '命令已取消：用户拒绝提供 sudo 密码。',
    },
  },
  appMessages: {
    en: {
      defaultSession: 'Default Session',
      newSession: 'New Session',
      untitledSession: 'Untitled Session',
      directoryNotFound: 'Directory does not exist',
      chromeNotReady: 'Chrome is not ready',
      channelNotFound: 'Channel not found',
      channelTypeNotFound: 'Channel type not found',
      requestBodyTooLarge: 'Request body too large',
      internalServerError: 'Internal server error',
      notFound: 'Not found',
      sessionBuildTitlePrompt: 'What would you like to name this session?',
      sessionBuildTitlePromptNew: 'Name your new session',
      sessionBuildTitlePromptRename: 'What would you like to rename this session to?',
      toolNoMountedWorkspace: 'No mounted workspace for this session',
      toolInvalidOrUnauthorizedPath: 'Invalid or unauthorized path',
      toolPathOutsideWorkspace: 'Path is outside the mounted workspace',
      toolCommandFailed: 'Command failed',
      toolFileNotFound: 'File not found',
      toolStringNotFound: 'String not found in file',
      toolEditFailed: 'Edit failed',
      toolSearchFailed: 'Search failed',
      toolGlobFailed: 'Glob failed',
      toolGrepFailed: 'Grep failed',
      toolUrlRequired: 'URL is required',
      toolInvalidUrl: 'Invalid URL',
      toolOnlyHttpsSupported: 'Only http/https URLs are supported',
      toolRequestTimeout: 'Request timeout',
      toolQueryRequired: 'Query is required',
      apiKeyPlaceholder: 'sk-...',
      apiKeyHint: 'API key for authentication',
      baseUrlHint: 'API base URL',
      taskDefaultTitle: 'Untitled Task',
      yourAnswerNeeded: '🤔 **Your answer is needed**\n\n',
      yourAuthorizationNeeded: '⚠️ **Your authorization is needed**\n\n',
      toolParameters: 'Tool:',
      replyToAuthorize: 'Reply "allow" or "y" to authorize',
      replyToDeny: 'Reply "deny" or "n" to deny',
      replyToAlways: 'Reply "always" to always allow this tool',
      replyDirectly: '*(please reply directly with your answer)*',
      replyWithOptionNumber: '*(please reply with option number, e.g. 1)*',
      multipleSelectionAllowed: '*(multiple selection allowed, comma separated, e.g. 1,3)*',
      skipToSkip: '*Reply to this message to answer, or send "skip" to skip the question*',
      generateTitleRules:
        'Generate a short title for the following user request. Rules:\n- Max 15 characters (Chinese) or 6 words (English)\n- Reply in the same language as the user request\n- No quotes, numbering, or punctuation at the end',
      generateTitleFromPrompt:
        'Generate a short conversation title based on the user request:\n- No more than 15 characters\n- Same language as the request\n- No quotes or numbering',
    },
    zh: {
      defaultSession: '默认会话',
      newSession: '新会话',
      untitledSession: '无标题会话',
      directoryNotFound: '目录不存在',
      chromeNotReady: 'Chrome 未就绪',
      channelNotFound: '未找到通道',
      channelTypeNotFound: '未找到通道类型',
      requestBodyTooLarge: '请求体过大',
      internalServerError: '内部服务器错误',
      notFound: '未找到',
      sessionBuildTitlePrompt: '您想将此会话命名为什么？',
      sessionBuildTitlePromptNew: '为新会话命名',
      sessionBuildTitlePromptRename: '您想将此会话重命名为什么？',
      toolNoMountedWorkspace: '此会话没有挂载工作区',
      toolInvalidOrUnauthorizedPath: '无效或未授权的路径',
      toolPathOutsideWorkspace: '路径超出挂载的工作区',
      toolCommandFailed: '命令执行失败',
      toolFileNotFound: '文件未找到',
      toolStringNotFound: '文件中未找到字符串',
      toolEditFailed: '编辑失败',
      toolSearchFailed: '搜索失败',
      toolGlobFailed: 'Glob 失败',
      toolGrepFailed: 'Grep 失败',
      toolUrlRequired: 'URL 是必需的',
      toolInvalidUrl: '无效的 URL',
      toolOnlyHttpsSupported: '只支持 http/https URL',
      toolRequestTimeout: '请求超时',
      toolQueryRequired: '查询是必需的',
      apiKeyPlaceholder: 'sk-...',
      apiKeyHint: '用于认证的 API 密钥',
      baseUrlHint: 'API 基础 URL',
      taskDefaultTitle: '无标题任务',
      yourAnswerNeeded: '🤔 **需要您的回答**\n\n',
      yourAuthorizationNeeded: '⚠️ **需要您的授权**\n\n',
      toolParameters: '工具：',
      replyToAuthorize: '回复 "allow" 或 "y" 以授权',
      replyToDeny: '回复 "deny" 或 "n" 以拒绝',
      replyToAlways: '回复 "always" 以始终允许此工具',
      replyDirectly: '*(请直接回复您的答案)*',
      replyWithOptionNumber: '*(请回复选项编号，例如 1)*',
      multipleSelectionAllowed: '*(支持多选，用逗号分隔，例如 1,3)*',
      skipToSkip: '*回复此消息以回答，或发送 "skip" 跳过问题*',
      generateTitleRules:
        '请根据以下用户请求生成一个简短的标题。规则：\n- 最长15个字符（中文）或6个单词（英文）\n- 使用与用户请求相同的语言回复\n- 不要加引号、编号或结尾标点',
      generateTitleFromPrompt:
        '根据用户请求生成一个简短的会话标题：\n- 不超过15个字符\n- 使用与请求相同的语言\n- 不要加引号或编号',
    },
  },
};

export const PROVIDER_PRESETS = API_PROVIDER_PRESETS;
const PI_AI_CURATED: Record<string, { piProvider: string; pick: string[] }> = PI_AI_CURATED_PRESETS;

// Cached dynamic presets — populated once by async import.
let cachedDynamicPresets: typeof PROVIDER_PRESETS | null = null;

/**
 * Build model presets dynamically from pi-ai registry.
 * Returns PROVIDER_PRESETS with models arrays replaced by registry data where available.
 * Uses async import() because pi-ai is ESM-only.
 */
export async function getPiAiModelPresets(): Promise<typeof PROVIDER_PRESETS> {
  if (cachedDynamicPresets) return cachedDynamicPresets;

  try {
    const { getModels } = (await import('@mariozechner/pi-ai')) as {
      getModels: (provider: string) => Array<{ id: string; name: string }> | undefined;
    };

    const result = { ...PROVIDER_PRESETS } as Record<
      string,
      (typeof PROVIDER_PRESETS)[keyof typeof PROVIDER_PRESETS]
    >;

    for (const [providerKey, curated] of Object.entries(PI_AI_CURATED)) {
      const preset = PROVIDER_PRESETS[providerKey as keyof typeof PROVIDER_PRESETS];
      if (!preset) continue;

      const registryModels = getModels(curated.piProvider);
      if (!registryModels || registryModels.length === 0) continue;

      const registryIds = new Set(registryModels.map((m) => m.id));
      const picked = curated.pick
        .filter((id) => registryIds.has(id))
        .map((id) => {
          const reg = registryModels.find((m) => m.id === id);
          return { id, name: reg?.name || id };
        });

      if (picked.length > 0) {
        result[providerKey] = { ...preset, models: picked };
      }
    }

    cachedDynamicPresets = result as unknown as typeof PROVIDER_PRESETS;
    return cachedDynamicPresets;
  } catch (err) {
    logWarn('[ConfigStore] Failed to load pi-ai model presets, using hardcoded fallback:', err);
    return PROVIDER_PRESETS;
  }
}

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
const VALID_THEMES: AppTheme[] = ['dark', 'light', 'system'];

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

function isProfileKey(value: unknown): value is ProviderProfileKey {
  return typeof value === 'string' && PROFILE_KEYS.includes(value as ProviderProfileKey);
}

function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === 'string' && VALID_THEMES.includes(value as AppTheme);
}

function profileKeyFromProvider(
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

function profileKeyToProvider(profileKey: ProviderProfileKey): {
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
  if (profileKey === 'ollama') {
    return { provider: 'ollama', customProtocol: 'openai' };
  }
  return { provider: profileKey, customProtocol: 'anthropic' };
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nowISO(): string {
  return new Date().toISOString();
}

function normalizeCustomProtocol(
  value: CustomProtocolType | undefined,
  fallback: CustomProtocolType = 'anthropic'
): CustomProtocolType {
  if (value === 'openai' || value === 'gemini' || value === 'anthropic') {
    return value;
  }
  return fallback;
}

function defaultProtocolForProvider(provider: ProviderType): CustomProtocolType {
  if (provider === 'openai' || provider === 'ollama') {
    return 'openai';
  }
  if (provider === 'gemini') {
    return 'gemini';
  }
  return 'anthropic';
}

export class ConfigStore {
  private store: Store<AppConfig>;

  constructor() {
    const storeOptions: StoreOptions<AppConfig> & { projectName?: string } = {
      name: 'config',
      projectName: 'open-cowork',
      defaults: defaultConfig,
    };

    // Cast to satisfy the Record<string, unknown> constraint of the encrypted store utility;
    // AppConfig is a structurally compatible object type at runtime.
    type AppConfigRecord = AppConfig & Record<string, unknown>;
    this.store = createEncryptedStoreWithKeyRotation<AppConfigRecord>({
      stableKey: 'open-cowork-config-stable-v1',
      legacyKeys: [
        'open-cowork-config-v1',
        ...getLegacyDerivedKeyHexes({
          moduleDirname: __dirname,
          stableSeed: 'open-cowork-config-stable-v1',
          legacySeed: 'open-cowork-config-v1',
          salt: 'open-cowork-config-salt',
        }),
      ],
      storeOptions: storeOptions as StoreOptions<AppConfigRecord> & { projectName?: string },
      logPrefix: '[ConfigStore]',
      log,
      warn: logWarn,
    }) as unknown as Store<AppConfig>;
    this.ensureNormalized();
  }

  private ensureNormalized(): void {
    const normalized = this.normalizeConfig(this.store.store as Partial<AppConfig>);
    this.store.set(normalized);
  }

  /**
   * Auto-fix model IDs that don't match pi-ai registry format.
   * Non-destructive: only applies known safe transformations at read time.
   */
  private normalizeModelIds(config: AppConfig): void {
    // Fix legacy "gemini/gemini-*" → "gemini-*" for gemini profiles
    // (pi-ai google provider uses bare model IDs, not prefixed)
    for (const key of ['gemini', 'custom:gemini'] as const) {
      const profile = config.profiles?.[key];
      if (profile?.model?.startsWith('gemini/')) {
        profile.model = profile.model.slice('gemini/'.length);
      }
    }
    // Fix openrouter baseUrl: /api → /api/v1
    const orProfile = config.profiles?.openrouter;
    if (orProfile?.baseUrl === 'https://openrouter.ai/api') {
      orProfile.baseUrl = 'https://openrouter.ai/api/v1';
    }
    // Fix openrouter model IDs: dashes → dots for claude models
    // Registry uses "anthropic/claude-sonnet-4.5", old config had "anthropic/claude-sonnet-4-5"
    if (orProfile?.model) {
      orProfile.model = orProfile.model.replace(
        /^(anthropic\/claude-(?:sonnet|opus|haiku)-\d+)-(\d+)/,
        '$1.$2'
      );
    }
    // Also fix the flat model field (legacy compat)
    if (config.model?.startsWith('gemini/')) {
      config.model = config.model.slice('gemini/'.length);
    }
    // Fix flat baseUrl for openrouter
    if (config.baseUrl === 'https://openrouter.ai/api' && config.provider === 'openrouter') {
      config.baseUrl = 'https://openrouter.ai/api/v1';
    }
  }

  private getDefaultProfile(profileKey: ProviderProfileKey): ProviderProfile {
    const fallback = defaultProfiles[profileKey];
    return {
      apiKey: fallback.apiKey,
      baseUrl: fallback.baseUrl,
      model: fallback.model,
    };
  }

  private normalizeProfile(
    profileKey: ProviderProfileKey,
    profile: Partial<ProviderProfile> | undefined
  ): ProviderProfile {
    const fallback = this.getDefaultProfile(profileKey);
    const model =
      typeof profile?.model === 'string' && profile.model.trim()
        ? profile.model.trim()
        : fallback.model;
    const rawBaseUrl =
      typeof profile?.baseUrl === 'string' && profile.baseUrl.trim()
        ? profile.baseUrl.trim()
        : fallback.baseUrl;
    const baseUrl =
      profileKey === 'ollama' ? normalizeOllamaBaseUrl(rawBaseUrl) || fallback.baseUrl : rawBaseUrl;
    const result: ProviderProfile = {
      apiKey: typeof profile?.apiKey === 'string' ? profile.apiKey : '',
      baseUrl,
      model,
    };
    // Preserve optional numeric fields so callers don't silently lose user-set values
    if (typeof profile?.contextWindow === 'number' && profile.contextWindow > 0) {
      result.contextWindow = profile.contextWindow;
    }
    if (typeof profile?.maxTokens === 'number' && profile.maxTokens > 0) {
      result.maxTokens = profile.maxTokens;
    }
    return result;
  }

  private cloneProfiles(
    profiles: Partial<Record<ProviderProfileKey, ProviderProfile>> | undefined
  ): Record<ProviderProfileKey, ProviderProfile> {
    const cloned = {} as Record<ProviderProfileKey, ProviderProfile>;
    for (const key of PROFILE_KEYS) {
      cloned[key] = this.normalizeProfile(key, profiles?.[key]);
    }
    return cloned;
  }

  private normalizeLegacyProjection(raw: Partial<AppConfig>): {
    provider: ProviderType;
    customProtocol: CustomProtocolType;
    activeProfileKey: ProviderProfileKey;
    profiles: Record<ProviderProfileKey, ProviderProfile>;
    enableThinking: boolean;
  } {
    const provider = isProviderType(raw.provider) ? raw.provider : defaultConfig.provider;
    const customProtocol: CustomProtocolType = isCustomProtocol(raw.customProtocol)
      ? raw.customProtocol
      : defaultProtocolForProvider(provider);
    const derivedProfileKey = profileKeyFromProvider(provider, customProtocol);

    const hasAnyRawProfiles = Boolean(raw.profiles && Object.keys(raw.profiles).length > 0);
    const hasProfileUserData = PROFILE_KEYS.some((key) => {
      const rawProfile = raw.profiles?.[key];
      if (!rawProfile) {
        return false;
      }
      const fallback = this.getDefaultProfile(key);
      if (typeof rawProfile.apiKey === 'string' && rawProfile.apiKey.trim()) {
        return true;
      }
      if (
        typeof rawProfile.baseUrl === 'string' &&
        rawProfile.baseUrl.trim() &&
        rawProfile.baseUrl.trim() !== fallback.baseUrl
      ) {
        return true;
      }
      if (
        typeof rawProfile.model === 'string' &&
        rawProfile.model.trim() &&
        rawProfile.model.trim() !== fallback.model
      ) {
        return true;
      }
      return false;
    });
    const shouldUseLegacyProjection = !hasAnyRawProfiles || !hasProfileUserData;

    let activeProfileKey: ProviderProfileKey = shouldUseLegacyProjection
      ? derivedProfileKey
      : isProfileKey(raw.activeProfileKey)
        ? raw.activeProfileKey
        : derivedProfileKey;

    const profiles = this.cloneProfiles(raw.profiles);
    const hasLegacyProjection =
      typeof raw.apiKey === 'string' ||
      typeof raw.baseUrl === 'string' ||
      typeof raw.model === 'string';

    if (shouldUseLegacyProjection && hasLegacyProjection) {
      profiles[derivedProfileKey] = this.normalizeProfile(derivedProfileKey, {
        apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
        baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : undefined,
        model: typeof raw.model === 'string' ? raw.model : undefined,
      });
      activeProfileKey = derivedProfileKey;
    }

    if (
      activeProfileKey === 'custom:openai' &&
      isOllamaLegacyCustomOpenAIConfig({
        provider,
        customProtocol,
        baseUrl: profiles['custom:openai']?.baseUrl,
      })
    ) {
      profiles.ollama = this.normalizeProfile('ollama', profiles['custom:openai']);
    }

    if (!profiles[activeProfileKey]) {
      activeProfileKey = derivedProfileKey;
    }

    return {
      provider,
      customProtocol,
      activeProfileKey,
      profiles,
      enableThinking: toBoolean(raw.enableThinking, defaultConfig.enableThinking),
    };
  }

  private projectFromConfigSet(configSet: ApiConfigSet): {
    provider: ProviderType;
    customProtocol: CustomProtocolType;
    activeProfileKey: ProviderProfileKey;
    profiles: Record<ProviderProfileKey, ProviderProfile>;
    apiKey: string;
    baseUrl?: string;
    model: string;
    contextWindow?: number;
    maxTokens?: number;
    enableThinking: boolean;
  } {
    const profiles = this.cloneProfiles(configSet.profiles);
    const activeProfileKey = isProfileKey(configSet.activeProfileKey)
      ? configSet.activeProfileKey
      : profileKeyFromProvider(configSet.provider, configSet.customProtocol);
    const activeProfile = profiles[activeProfileKey] || this.getDefaultProfile(activeProfileKey);

    return {
      provider: configSet.provider,
      customProtocol: configSet.customProtocol,
      activeProfileKey,
      profiles,
      apiKey: activeProfile.apiKey,
      baseUrl: activeProfile.baseUrl,
      model: activeProfile.model,
      contextWindow: activeProfile.contextWindow,
      maxTokens: activeProfile.maxTokens,
      enableThinking: toBoolean(configSet.enableThinking, false),
    };
  }

  private normalizeConfigSet(
    rawSet: Partial<ApiConfigSet> | undefined,
    fallback: {
      id: string;
      name: string;
      provider: ProviderType;
      customProtocol: CustomProtocolType;
      activeProfileKey: ProviderProfileKey;
      profiles: Record<ProviderProfileKey, ProviderProfile>;
      enableThinking: boolean;
      isSystem?: boolean;
    }
  ): ApiConfigSet {
    const provider = isProviderType(rawSet?.provider) ? rawSet.provider : fallback.provider;
    const customProtocol: CustomProtocolType = isCustomProtocol(rawSet?.customProtocol)
      ? rawSet.customProtocol
      : defaultProtocolForProvider(provider);

    const derivedProfileKey = profileKeyFromProvider(provider, customProtocol);
    const activeProfileKey = isProfileKey(rawSet?.activeProfileKey)
      ? rawSet.activeProfileKey
      : fallback.activeProfileKey || derivedProfileKey;

    const profiles = this.cloneProfiles(rawSet?.profiles || fallback.profiles);

    if (!profiles[activeProfileKey]) {
      profiles[activeProfileKey] = this.getDefaultProfile(activeProfileKey);
    }

    const id = toNonEmptyString(rawSet?.id) || fallback.id;
    const name = toNonEmptyString(rawSet?.name) || fallback.name;
    const updatedAt = toNonEmptyString(rawSet?.updatedAt) || nowISO();

    return {
      id,
      name,
      isSystem: toBoolean(rawSet?.isSystem, Boolean(fallback.isSystem)),
      provider,
      customProtocol,
      activeProfileKey,
      profiles,
      enableThinking: toBoolean(rawSet?.enableThinking, fallback.enableThinking),
      updatedAt,
    };
  }

  private makeDefaultConfigSetFromLegacy(legacy: {
    provider: ProviderType;
    customProtocol: CustomProtocolType;
    activeProfileKey: ProviderProfileKey;
    profiles: Record<ProviderProfileKey, ProviderProfile>;
    enableThinking: boolean;
  }): ApiConfigSet {
    return this.normalizeConfigSet(
      {
        id: DEFAULT_CONFIG_SET_ID,
        name: defaultConfigSet.name,
        isSystem: true,
        provider: legacy.provider,
        customProtocol: legacy.customProtocol,
        activeProfileKey: legacy.activeProfileKey,
        profiles: legacy.profiles,
        enableThinking: legacy.enableThinking,
        updatedAt: nowISO(),
      },
      {
        id: DEFAULT_CONFIG_SET_ID,
        name: defaultConfigSet.name,
        isSystem: true,
        provider: legacy.provider,
        customProtocol: legacy.customProtocol,
        activeProfileKey: legacy.activeProfileKey,
        profiles: legacy.profiles,
        enableThinking: legacy.enableThinking,
      }
    );
  }

  private normalizeConfigSets(
    rawSets: unknown,
    legacy: {
      provider: ProviderType;
      customProtocol: CustomProtocolType;
      activeProfileKey: ProviderProfileKey;
      profiles: Record<ProviderProfileKey, ProviderProfile>;
      enableThinking: boolean;
    }
  ): ApiConfigSet[] {
    const list = Array.isArray(rawSets) ? rawSets : [];
    if (list.length === 0) {
      return [this.makeDefaultConfigSetFromLegacy(legacy)];
    }

    const normalized: ApiConfigSet[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < list.length; index += 1) {
      const rawSet = (list[index] || {}) as Partial<ApiConfigSet>;
      const seedId = toNonEmptyString(rawSet.id) || `set-${index + 1}`;
      let nextId = seedId;
      let suffix = 2;
      while (usedIds.has(nextId)) {
        nextId = `${seedId}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(nextId);

      const normalizedSet = this.normalizeConfigSet(rawSet, {
        id: nextId,
        name: toNonEmptyString(rawSet.name) || `Config ${index + 1}`,
        provider: legacy.provider,
        customProtocol: legacy.customProtocol,
        activeProfileKey: legacy.activeProfileKey,
        profiles: legacy.profiles,
        enableThinking: legacy.enableThinking,
        isSystem: Boolean(rawSet.isSystem),
      });
      normalizedSet.id = nextId;
      normalized.push(normalizedSet);
    }

    const hasSystemSet = normalized.some((set) => set.isSystem);
    if (!hasSystemSet) {
      normalized.unshift(this.makeDefaultConfigSetFromLegacy(legacy));
    }

    return normalized;
  }

  private hasLegacySignal(legacy: {
    provider: ProviderType;
    customProtocol: CustomProtocolType;
    activeProfileKey: ProviderProfileKey;
    profiles: Record<ProviderProfileKey, ProviderProfile>;
    enableThinking: boolean;
  }): boolean {
    if (
      legacy.provider !== defaultConfig.provider ||
      legacy.customProtocol !== (defaultConfig.customProtocol || 'anthropic') ||
      legacy.activeProfileKey !== defaultConfig.activeProfileKey ||
      legacy.enableThinking !== defaultConfig.enableThinking
    ) {
      return true;
    }

    const activeProfile = legacy.profiles[legacy.activeProfileKey];
    const fallbackActive = this.getDefaultProfile(legacy.activeProfileKey);
    return Boolean(
      activeProfile.apiKey.trim() ||
      (activeProfile.baseUrl || '') !== (fallbackActive.baseUrl || '') ||
      activeProfile.model !== fallbackActive.model
    );
  }

  private shouldPreferLegacyConfigSetProjection(
    normalizedSets: ApiConfigSet[],
    legacy: {
      provider: ProviderType;
      customProtocol: CustomProtocolType;
      activeProfileKey: ProviderProfileKey;
      profiles: Record<ProviderProfileKey, ProviderProfile>;
      enableThinking: boolean;
    }
  ): boolean {
    if (!this.hasLegacySignal(legacy)) {
      return false;
    }
    if (normalizedSets.length !== 1) {
      return false;
    }

    const onlySet = normalizedSets[0];
    if (!(onlySet.id === DEFAULT_CONFIG_SET_ID && onlySet.isSystem)) {
      return false;
    }

    const projected = this.projectFromConfigSet(onlySet);
    const legacyActive = legacy.profiles[legacy.activeProfileKey];
    return !(
      projected.provider === legacy.provider &&
      projected.customProtocol === legacy.customProtocol &&
      projected.activeProfileKey === legacy.activeProfileKey &&
      projected.enableThinking === legacy.enableThinking &&
      projected.apiKey === legacyActive.apiKey &&
      (projected.baseUrl || '') === (legacyActive.baseUrl || '') &&
      projected.model === legacyActive.model
    );
  }

  private normalizeConfig(rawConfig: Partial<AppConfig> | undefined): AppConfig {
    const raw = rawConfig || {};
    const legacy = this.normalizeLegacyProjection(raw);
    const normalizedFromRaw = this.normalizeConfigSets(raw.configSets, legacy);
    const configSets = this.shouldPreferLegacyConfigSetProjection(normalizedFromRaw, legacy)
      ? [this.makeDefaultConfigSetFromLegacy(legacy)]
      : normalizedFromRaw;

    const requestedActiveSetId = toNonEmptyString(raw.activeConfigSetId);
    const activeConfigSetId = configSets.some((set) => set.id === requestedActiveSetId)
      ? (requestedActiveSetId as string)
      : configSets[0].id;

    const activeConfigSet = configSets.find((set) => set.id === activeConfigSetId) || configSets[0];
    const projected = this.projectFromConfigSet(activeConfigSet);

    const result: AppConfig = {
      provider: projected.provider,
      customProtocol: projected.customProtocol,
      apiKey: projected.apiKey,
      baseUrl: projected.baseUrl,
      model: projected.model,
      activeProfileKey: projected.activeProfileKey,
      profiles: projected.profiles,
      activeConfigSetId,
      configSets,
      claudeCodePath:
        typeof raw.claudeCodePath === 'string' ? raw.claudeCodePath : defaultConfig.claudeCodePath,
      defaultWorkdir:
        typeof raw.defaultWorkdir === 'string' ? raw.defaultWorkdir : defaultConfig.defaultWorkdir,
      globalSkillsPath:
        typeof raw.globalSkillsPath === 'string'
          ? raw.globalSkillsPath
          : defaultConfig.globalSkillsPath,
      enableDevLogs: toBoolean(raw.enableDevLogs, defaultConfig.enableDevLogs),
      theme: isAppTheme(raw.theme) ? raw.theme : defaultConfig.theme,
      sandboxEnabled: toBoolean(raw.sandboxEnabled, defaultConfig.sandboxEnabled),
      enableThinking: projected.enableThinking,
      isConfigured: toBoolean(raw.isConfigured, defaultConfig.isConfigured),
    };
    this.normalizeModelIds(result);
    return result;
  }

  private cloneConfigSet(configSet: ApiConfigSet): ApiConfigSet {
    return {
      ...configSet,
      profiles: this.cloneProfiles(configSet.profiles),
      updatedAt: toNonEmptyString(configSet.updatedAt) || nowISO(),
    };
  }

  private saveConfig(config: AppConfig): void {
    const normalized = this.normalizeConfig(config);
    this.store.set(normalized);
  }

  private composeProjectedConfig(
    base: AppConfig,
    nextConfigSets: ApiConfigSet[],
    requestedActiveConfigSetId: string
  ): AppConfig {
    const activeConfigSet =
      nextConfigSets.find((set) => set.id === requestedActiveConfigSetId) || nextConfigSets[0];
    const projected = this.projectFromConfigSet(activeConfigSet);
    return {
      ...base,
      provider: projected.provider,
      customProtocol: projected.customProtocol,
      apiKey: projected.apiKey,
      baseUrl: projected.baseUrl,
      model: projected.model,
      activeProfileKey: projected.activeProfileKey,
      profiles: projected.profiles,
      enableThinking: projected.enableThinking,
      activeConfigSetId: activeConfigSet.id,
      configSets: nextConfigSets,
    };
  }

  private buildUniqueConfigSetName(
    name: string,
    existingSets: ApiConfigSet[],
    excludeId?: string
  ): string {
    const trimmed = name.trim();
    if (!trimmed) {
      throw createError(ERROR_CODES.CONFIG_SET_NAME_REQUIRED);
    }

    const usedNames = new Set(
      existingSets.filter((set) => set.id !== excludeId).map((set) => set.name)
    );

    if (!usedNames.has(trimmed)) {
      return trimmed;
    }

    let suffix = 2;
    let candidate = `${trimmed} (${suffix})`;
    while (usedNames.has(candidate) && suffix <= 100) {
      suffix += 1;
      candidate = `${trimmed} (${suffix})`;
    }
    return candidate;
  }

  private generateConfigSetId(existingSets: ApiConfigSet[]): ConfigSetId {
    let index = existingSets.length + 1;
    let candidate = `set-${index}`;
    const used = new Set(existingSets.map((set) => set.id));
    while (used.has(candidate)) {
      index += 1;
      candidate = `set-${index}`;
    }
    return candidate;
  }

  private buildBlankConfigSet(payload: {
    id: ConfigSetId;
    name: string;
    provider: ProviderType;
    customProtocol: CustomProtocolType;
  }): ApiConfigSet {
    const activeProfileKey = profileKeyFromProvider(payload.provider, payload.customProtocol);
    const profiles = this.cloneProfiles(undefined);
    const defaultProfile = this.getDefaultProfile(activeProfileKey);
    profiles[activeProfileKey] = this.normalizeProfile(activeProfileKey, {
      apiKey: '',
      baseUrl: defaultProfile.baseUrl,
      model: defaultProfile.model,
    });

    return {
      id: payload.id,
      name: payload.name,
      isSystem: false,
      provider: payload.provider,
      customProtocol: payload.customProtocol,
      activeProfileKey,
      profiles,
      enableThinking: false,
      updatedAt: nowISO(),
    };
  }

  /**
   * Get all config
   */
  getAll(): AppConfig {
    return this.normalizeConfig(this.store.store as Partial<AppConfig>);
  }

  /**
   * Get a specific config value
   */
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    if (DIRECT_READ_KEYS.has(key)) {
      const rawValue = this.store.get(key as string) as AppConfig[K] | undefined;
      if (rawValue !== undefined) {
        // Per-field guards: reject raw values that fail type/range checks
        if (key === 'provider' && !isProviderType(rawValue)) {
          return defaultConfig[key];
        }
        if (key === 'customProtocol' && !isCustomProtocol(rawValue)) {
          return defaultConfig[key];
        }
        if (key === 'activeProfileKey' && !isProfileKey(rawValue)) {
          return defaultConfig[key];
        }
        if (key === 'theme' && !isAppTheme(rawValue)) {
          return defaultConfig[key];
        }
        if (
          (key === 'enableDevLogs' ||
            key === 'sandboxEnabled' ||
            key === 'enableThinking' ||
            key === 'isConfigured') &&
          typeof rawValue !== 'boolean'
        ) {
          return defaultConfig[key];
        }
        return rawValue;
      }
      return defaultConfig[key];
    }
    return this.getAll()[key];
  }

  /**
   * Set a specific config value
   */
  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.update({ [key]: value } as Partial<AppConfig>);
  }

  /**
   * Create a new named config set.
   * - mode=blank: create a fresh set from current provider/protocol defaults
   * - mode=clone: clone current/selected set
   */
  createSet(payload: CreateConfigSetPayload): AppConfig {
    const current = this.getAll();
    if (current.configSets.length >= MAX_CONFIG_SET_COUNT) {
      const err = createError(ERROR_CODES.CONFIG_SET_LIMIT_REACHED);
      err.message = `Config set limit reached: max ${MAX_CONFIG_SET_COUNT}`;
      throw err;
    }

    const id = this.generateConfigSetId(current.configSets);
    const name = this.buildUniqueConfigSetName(payload.name, current.configSets);
    const mode: CreateSetMode = payload.mode === 'blank' ? 'blank' : 'clone';
    let newSet: ApiConfigSet;

    if (mode === 'blank') {
      const activeSet =
        current.configSets.find((set) => set.id === current.activeConfigSetId) ||
        current.configSets[0];
      const seedProvider = activeSet?.provider || current.provider;
      const seedProtocol: CustomProtocolType = normalizeCustomProtocol(
        activeSet?.customProtocol,
        defaultProtocolForProvider(seedProvider)
      );
      newSet = this.buildBlankConfigSet({
        id,
        name,
        provider: seedProvider,
        customProtocol: seedProtocol,
      });
    } else {
      const source =
        current.configSets.find((set) => set.id === payload.fromSetId) ||
        current.configSets.find((set) => set.id === current.activeConfigSetId) ||
        current.configSets[0];

      if (!source) {
        throw createError(ERROR_CODES.CONFIG_SET_CLONE_SOURCE_NOT_FOUND);
      }

      const cloned = this.cloneConfigSet(source);
      newSet = {
        ...cloned,
        id,
        name,
        isSystem: false,
        updatedAt: nowISO(),
      };
    }

    this.saveConfig({
      ...this.composeProjectedConfig(current, [...current.configSets, newSet], id),
    } as AppConfig);

    return this.getAll();
  }

  renameSet(payload: { id: string; name: string }): AppConfig {
    const current = this.getAll();
    const target = current.configSets.find((set) => set.id === payload.id);
    if (!target) {
      throw createError(ERROR_CODES.CONFIG_SET_NOT_FOUND);
    }

    const nextName = this.buildUniqueConfigSetName(payload.name, current.configSets, payload.id);
    const nextSets = current.configSets.map((set) => {
      if (set.id !== payload.id) {
        return this.cloneConfigSet(set);
      }
      return {
        ...this.cloneConfigSet(set),
        name: nextName,
        updatedAt: nowISO(),
      };
    });

    this.saveConfig(this.composeProjectedConfig(current, nextSets, current.activeConfigSetId));

    return this.getAll();
  }

  deleteSet(payload: { id: string }): AppConfig {
    const current = this.getAll();
    const target = current.configSets.find((set) => set.id === payload.id);
    if (!target) {
      throw createError(ERROR_CODES.CONFIG_SET_NOT_FOUND);
    }
    if (target.isSystem) {
      throw createError(ERROR_CODES.SYSTEM_CONFIG_SET_CANNOT_BE_DELETED);
    }
    if (current.configSets.length <= 1) {
      throw createError(ERROR_CODES.AT_LEAST_ONE_CONFIG_SET_MUST_BE_KEPT);
    }

    const nextSets = current.configSets
      .filter((set) => set.id !== payload.id)
      .map((set) => this.cloneConfigSet(set));

    const fallbackActive = nextSets.find((set) => set.isSystem)?.id || nextSets[0]?.id;
    const nextActiveConfigSetId =
      current.activeConfigSetId === payload.id ? fallbackActive : current.activeConfigSetId;

    this.saveConfig(this.composeProjectedConfig(current, nextSets, nextActiveConfigSetId));

    return this.getAll();
  }

  switchSet(payload: { id: string }): AppConfig {
    const current = this.getAll();
    if (!current.configSets.some((set) => set.id === payload.id)) {
      throw createError(ERROR_CODES.CONFIG_SET_NOT_FOUND);
    }

    this.saveConfig(this.composeProjectedConfig(current, current.configSets, payload.id));

    return this.getAll();
  }

  /**
   * Update multiple config values
   */
  update(updates: Partial<AppConfig>): void {
    const current = this.getAll();
    let nextConfigSets = current.configSets.map((set) => this.cloneConfigSet(set));

    if (Array.isArray(updates.configSets) && updates.configSets.length > 0) {
      const normalizedSets = this.normalizeConfigSets(updates.configSets, {
        provider: current.provider,
        customProtocol: normalizeCustomProtocol(
          current.customProtocol,
          defaultProtocolForProvider(current.provider)
        ),
        activeProfileKey: current.activeProfileKey,
        profiles: this.cloneProfiles(current.profiles),
        enableThinking: current.enableThinking,
      });
      nextConfigSets = normalizedSets;
    }

    const requestedActiveConfigSetId =
      toNonEmptyString(updates.activeConfigSetId) || current.activeConfigSetId;
    const activeConfigSetId = nextConfigSets.some((set) => set.id === requestedActiveConfigSetId)
      ? requestedActiveConfigSetId
      : nextConfigSets[0].id;

    const targetIndex = nextConfigSets.findIndex((set) => set.id === activeConfigSetId);
    const targetSet =
      targetIndex >= 0
        ? this.cloneConfigSet(nextConfigSets[targetIndex])
        : this.cloneConfigSet(nextConfigSets[0]);

    const nextProfiles = this.cloneProfiles(targetSet.profiles);
    let nextActiveProfileKey = targetSet.activeProfileKey;
    let nextProvider = targetSet.provider;
    let nextCustomProtocol: CustomProtocolType = normalizeCustomProtocol(
      targetSet.customProtocol,
      defaultProtocolForProvider(targetSet.provider)
    );

    const mutatesActiveSet =
      updates.profiles !== undefined ||
      updates.activeProfileKey !== undefined ||
      updates.provider !== undefined ||
      updates.customProtocol !== undefined ||
      updates.apiKey !== undefined ||
      updates.baseUrl !== undefined ||
      updates.model !== undefined ||
      updates.enableThinking !== undefined;

    if (mutatesActiveSet) {
      if (updates.profiles) {
        for (const key of PROFILE_KEYS) {
          if (updates.profiles[key]) {
            nextProfiles[key] = this.normalizeProfile(key, updates.profiles[key]);
          }
        }
      }

      if (isProfileKey(updates.activeProfileKey)) {
        nextActiveProfileKey = updates.activeProfileKey;
        const fromProfile = profileKeyToProvider(nextActiveProfileKey);
        nextProvider = fromProfile.provider;
        nextCustomProtocol = fromProfile.customProtocol;
      }

      if (updates.provider || updates.customProtocol) {
        const requestedProvider = isProviderType(updates.provider)
          ? updates.provider
          : nextProvider;
        const requestedProtocol =
          requestedProvider === 'custom'
            ? isCustomProtocol(updates.customProtocol)
              ? updates.customProtocol
              : nextCustomProtocol
            : defaultProtocolForProvider(requestedProvider);
        nextActiveProfileKey = profileKeyFromProvider(requestedProvider, requestedProtocol);
        const fromProfile = profileKeyToProvider(nextActiveProfileKey);
        nextProvider = fromProfile.provider;
        nextCustomProtocol = fromProfile.customProtocol;
      }

      const nextActiveProfile = {
        ...nextProfiles[nextActiveProfileKey],
      };
      if (updates.apiKey !== undefined) {
        nextActiveProfile.apiKey = updates.apiKey;
      }
      if (updates.baseUrl !== undefined) {
        const baseUrl = updates.baseUrl?.trim();
        nextActiveProfile.baseUrl = baseUrl ?? '';
      }
      if (updates.model !== undefined) {
        const model = updates.model?.trim();
        nextActiveProfile.model = model ?? '';
      }
      nextProfiles[nextActiveProfileKey] = this.normalizeProfile(
        nextActiveProfileKey,
        nextActiveProfile
      );

      const updatedSet: ApiConfigSet = {
        ...targetSet,
        provider: nextProvider,
        customProtocol: nextCustomProtocol,
        activeProfileKey: nextActiveProfileKey,
        profiles: nextProfiles,
        enableThinking:
          updates.enableThinking !== undefined ? updates.enableThinking : targetSet.enableThinking,
        updatedAt: nowISO(),
      };

      if (targetIndex >= 0) {
        nextConfigSets[targetIndex] = updatedSet;
      }
    }

    const projectedConfig = this.composeProjectedConfig(current, nextConfigSets, activeConfigSetId);
    this.saveConfig({
      ...projectedConfig,
      claudeCodePath:
        updates.claudeCodePath !== undefined ? updates.claudeCodePath : current.claudeCodePath,
      defaultWorkdir:
        updates.defaultWorkdir !== undefined ? updates.defaultWorkdir : current.defaultWorkdir,
      globalSkillsPath:
        updates.globalSkillsPath !== undefined
          ? updates.globalSkillsPath
          : current.globalSkillsPath,
      enableDevLogs:
        updates.enableDevLogs !== undefined ? updates.enableDevLogs : current.enableDevLogs,
      theme: updates.theme !== undefined ? updates.theme : current.theme,
      sandboxEnabled:
        updates.sandboxEnabled !== undefined ? updates.sandboxEnabled : current.sandboxEnabled,
      isConfigured:
        updates.isConfigured !== undefined ? updates.isConfigured : current.isConfigured,
    });
  }

  /**
   * Check if the app is configured (has API key)
   */
  isConfigured(): boolean {
    return this.hasAnyUsableCredentials(this.getAll());
  }

  private hasUsableCredentialsForProjection(projection: {
    provider: ProviderType;
    customProtocol?: CustomProtocolType;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  }): boolean {
    if (projection.provider === 'ollama' && !projection.model?.trim()) {
      return false;
    }
    const apiKey = projection.apiKey?.trim();
    if (apiKey) {
      return true;
    }
    if (
      shouldAllowEmptyAnthropicApiKey({
        provider: projection.provider,
        customProtocol: projection.customProtocol,
        baseUrl: projection.baseUrl,
      })
    ) {
      return true;
    }
    if (
      shouldAllowEmptyGeminiApiKey({
        provider: projection.provider,
        customProtocol: projection.customProtocol,
        baseUrl: projection.baseUrl,
      })
    ) {
      return true;
    }
    if (
      shouldAllowEmptyOllamaApiKey({
        provider: projection.provider,
        customProtocol: projection.customProtocol,
        baseUrl: projection.baseUrl,
      })
    ) {
      return true;
    }
    const protocol: CustomProtocolType = normalizeCustomProtocol(
      projection.customProtocol,
      defaultProtocolForProvider(projection.provider)
    );
    if (!isOpenAIProvider({ provider: projection.provider, customProtocol: protocol })) {
      return false;
    }
    return (
      (projection.provider === 'ollama'
        ? resolveOllamaCredentials({
            provider: projection.provider,
            customProtocol: protocol,
            apiKey: projection.apiKey ?? '',
            baseUrl: projection.baseUrl,
          })
        : resolveOpenAICredentials({
            provider: projection.provider,
            customProtocol: protocol,
            apiKey: projection.apiKey ?? '',
            baseUrl: projection.baseUrl,
          })) !== null
    );
  }

  hasUsableCredentials(config: AppConfig = this.getAll()): boolean {
    return this.hasUsableCredentialsForActiveSet(config);
  }

  hasUsableCredentialsForActiveSet(config: AppConfig = this.getAll()): boolean {
    const normalized = this.normalizeConfig(config);
    return this.hasUsableCredentialsForProjection({
      provider: normalized.provider,
      customProtocol: normalized.customProtocol,
      apiKey: normalized.apiKey,
      baseUrl: normalized.baseUrl,
      model: normalized.model,
    });
  }

  hasAnyUsableCredentials(config: AppConfig = this.getAll()): boolean {
    const normalized = this.normalizeConfig(config);
    return normalized.configSets.some((configSet) => {
      const projected = this.projectFromConfigSet(configSet);
      return this.hasUsableCredentialsForProjection({
        provider: projected.provider,
        customProtocol: projected.customProtocol,
        apiKey: projected.apiKey,
        baseUrl: projected.baseUrl,
        model: projected.model,
      });
    });
  }

  /**
   * Apply config to environment variables
   * This should be called before creating sessions
   *
   * 环境变量映射：
   * - OpenAI 直连: OPENAI_API_KEY = apiKey, OPENAI_BASE_URL 可选
   * - Anthropic 直连: ANTHROPIC_API_KEY = apiKey
   * - Custom Anthropic: ANTHROPIC_API_KEY = apiKey
   * - OpenRouter: ANTHROPIC_AUTH_TOKEN = apiKey, ANTHROPIC_API_KEY = '' (proxy mode)
   */
  applyToEnv(): void {
    const config = this.getAll();
    const activeProfile = config.profiles?.[config.activeProfileKey] || {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    };
    const projectedConfig: AppConfig = {
      ...config,
      apiKey: activeProfile.apiKey || '',
      baseUrl: activeProfile.baseUrl,
      model: activeProfile.model || '',
    };

    // Clear all API-related env vars first to ensure clean state when switching providers
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.CLAUDE_MODEL;
    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_API_MODE;
    delete process.env.OPENAI_ACCOUNT_ID;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_BASE_URL;
    delete process.env.CLAUDE_CODE_PATH;
    delete process.env.COWORK_WORKDIR;

    const useOpenAI =
      projectedConfig.provider === 'openai' ||
      projectedConfig.provider === 'ollama' ||
      (projectedConfig.provider === 'custom' && projectedConfig.customProtocol === 'openai');
    const useGemini =
      projectedConfig.provider === 'gemini' ||
      (projectedConfig.provider === 'custom' && projectedConfig.customProtocol === 'gemini');

    if (useOpenAI) {
      const resolvedOpenAI =
        projectedConfig.provider === 'ollama'
          ? resolveOllamaCredentials(projectedConfig)
          : resolveOpenAICredentials(projectedConfig);
      if (resolvedOpenAI?.apiKey) {
        process.env.OPENAI_API_KEY = resolvedOpenAI.apiKey;
      }
      const openAIBaseUrl = resolvedOpenAI?.baseUrl || projectedConfig.baseUrl;
      if (openAIBaseUrl) {
        process.env.OPENAI_BASE_URL = openAIBaseUrl;
      }
      if (resolvedOpenAI?.accountId) {
        process.env.OPENAI_ACCOUNT_ID = resolvedOpenAI.accountId;
      }
      if (projectedConfig.model) {
        process.env.OPENAI_MODEL = projectedConfig.model;
      }
    } else if (useGemini) {
      const trimmedApiKey = projectedConfig.apiKey?.trim();
      if (trimmedApiKey) {
        process.env.GEMINI_API_KEY = trimmedApiKey;
      }
      const normalizedGeminiBaseUrl = projectedConfig.baseUrl?.trim().replace(/\/+$/, '');
      if (normalizedGeminiBaseUrl) {
        process.env.GEMINI_BASE_URL = normalizedGeminiBaseUrl;
      }
      if (projectedConfig.model) {
        process.env.CLAUDE_MODEL = projectedConfig.model;
      }
    } else {
      const effectiveAnthropicApiKey =
        projectedConfig.apiKey?.trim() ||
        (shouldAllowEmptyAnthropicApiKey(projectedConfig) ? LOCAL_ANTHROPIC_PLACEHOLDER_KEY : '');
      if (
        projectedConfig.provider === 'anthropic' ||
        (projectedConfig.provider === 'custom' && projectedConfig.customProtocol !== 'openai')
      ) {
        const useAuthToken = shouldUseAnthropicAuthToken({
          ...projectedConfig,
          apiKey: effectiveAnthropicApiKey,
        });
        if (effectiveAnthropicApiKey) {
          if (useAuthToken) {
            process.env.ANTHROPIC_AUTH_TOKEN = effectiveAnthropicApiKey;
          } else {
            process.env.ANTHROPIC_API_KEY = effectiveAnthropicApiKey;
          }
        }
        const normalizedAnthropicBaseUrl = normalizeAnthropicBaseUrl(projectedConfig.baseUrl);
        if (normalizedAnthropicBaseUrl) {
          process.env.ANTHROPIC_BASE_URL = normalizedAnthropicBaseUrl;
        }
        if (useAuthToken) {
          delete process.env.ANTHROPIC_API_KEY;
        } else {
          delete process.env.ANTHROPIC_AUTH_TOKEN;
        }
      } else {
        // OpenRouter: use ANTHROPIC_AUTH_TOKEN for proxy authentication
        if (effectiveAnthropicApiKey) {
          process.env.ANTHROPIC_AUTH_TOKEN = effectiveAnthropicApiKey;
        }
        const normalizedAnthropicBaseUrl = normalizeAnthropicBaseUrl(projectedConfig.baseUrl);
        if (normalizedAnthropicBaseUrl) {
          process.env.ANTHROPIC_BASE_URL = normalizedAnthropicBaseUrl;
        }
        // ANTHROPIC_API_KEY must be absent to prevent SDK from using it
        delete process.env.ANTHROPIC_API_KEY;
      }

      if (projectedConfig.model) {
        process.env.CLAUDE_MODEL = projectedConfig.model;
        process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = projectedConfig.model;
      }
    }

    // claudeCodePath is no longer used (pi-coding-agent handles model routing natively)

    if (projectedConfig.defaultWorkdir) {
      process.env.COWORK_WORKDIR = projectedConfig.defaultWorkdir;
    }

    log('[Config] Applied env vars for provider:', projectedConfig.provider, {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '✓ Set' : '(empty/unset)',
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ? '✓ Set' : '(empty/unset)',
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '(default)',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? '✓ Set' : '(empty/unset)',
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || '(default)',
      OPENAI_MODEL: process.env.OPENAI_MODEL || '(not set)',
      OPENAI_API_MODE: process.env.OPENAI_API_MODE || '(default)',
      OPENAI_ACCOUNT_ID: process.env.OPENAI_ACCOUNT_ID || '(not set)',
      GEMINI_API_KEY: process.env.GEMINI_API_KEY ? '✓ Set' : '(empty/unset)',
      GEMINI_BASE_URL: process.env.GEMINI_BASE_URL || '(default)',
    });
  }

  /**
   * Reset config to defaults
   */
  reset(): void {
    this.store.clear();
    this.ensureNormalized();
  }

  /**
   * Get the store file path (for debugging)
   */
  getPath(): string {
    return this.store.path;
  }
}

// Singleton instance
export const configStore = new ConfigStore();

function detectLanguage(): 'en' | 'zh' {
  try {
    const locale =
      Intl.DateTimeFormat().resolvedOptions().locale ||
      (typeof navigator !== 'undefined' ? navigator.language : null) ||
      'en';
    if (locale.startsWith('zh')) return 'zh';
  } catch {
    // Intl not available
  }
  return 'en';
}

export function getAgentRunnerMessages(): AgentRunnerMessageStrings {
  const stored = configStore.get('agentRunnerMessages');
  const lang = detectLanguage();
  if (stored?.en && stored?.zh) {
    return stored[lang];
  }
  return defaultMessages[lang];
}

export function getAppMessages(): AppMessageStrings {
  const stored = configStore.get('appMessages');
  const lang = detectLanguage();
  if (stored?.en && stored?.zh) {
    return stored[lang];
  }
  return defaultAppMessages[lang];
}

const defaultAppMessages: AppMessages = {
  en: {
    defaultSession: 'Default Session',
    newSession: 'New Session',
    untitledSession: 'Untitled Session',
    directoryNotFound: 'Directory does not exist',
    chromeNotReady: 'Chrome is not ready',
    channelNotFound: 'Channel not found',
    channelTypeNotFound: 'Channel type not found',
    requestBodyTooLarge: 'Request body too large',
    internalServerError: 'Internal server error',
    notFound: 'Not found',
    sessionBuildTitlePrompt: 'What would you like to name this session?',
    sessionBuildTitlePromptNew: 'Name your new session',
    sessionBuildTitlePromptRename: 'What would you like to rename this session to?',
    toolNoMountedWorkspace: 'No mounted workspace for this session',
    toolInvalidOrUnauthorizedPath: 'Invalid or unauthorized path',
    toolPathOutsideWorkspace: 'Path is outside the mounted workspace',
    toolCommandFailed: 'Command failed',
    toolFileNotFound: 'File not found',
    toolStringNotFound: 'String not found in file',
    toolEditFailed: 'Edit failed',
    toolSearchFailed: 'Search failed',
    toolGlobFailed: 'Glob failed',
    toolGrepFailed: 'Grep failed',
    toolUrlRequired: 'URL is required',
    toolInvalidUrl: 'Invalid URL',
    toolOnlyHttpsSupported: 'Only http/https URLs are supported',
    toolRequestTimeout: 'Request timeout',
    toolQueryRequired: 'Query is required',
    apiKeyPlaceholder: 'sk-...',
    apiKeyHint: 'API key for authentication',
    baseUrlHint: 'API base URL',
    taskDefaultTitle: 'Untitled Task',
    yourAnswerNeeded: '🤔 **Your answer is needed**\n\n',
    yourAuthorizationNeeded: '⚠️ **Your authorization is needed**\n\n',
    toolParameters: 'Tool:',
    replyToAuthorize: 'Reply "allow" or "y" to authorize',
    replyToDeny: 'Reply "deny" or "n" to deny',
    replyToAlways: 'Reply "always" to always allow this tool',
    replyDirectly: '*(please reply directly with your answer)*',
    replyWithOptionNumber: '*(please reply with option number, e.g. 1)*',
    multipleSelectionAllowed: '*(multiple selection allowed, comma separated, e.g. 1,3)*',
    skipToSkip: '*Reply to this message to answer, or send "skip" to skip the question*',
    generateTitleRules:
      'Generate a short title for the following user request. Rules:\n- Max 15 characters (Chinese) or 6 words (English)\n- Reply in the same language as the user request\n- No quotes, numbering, or punctuation at the end',
    generateTitleFromPrompt:
      'Generate a short conversation title based on the user request:\n- No more than 15 characters\n- Same language as the request\n- No quotes or numbering',
  },
  zh: {
    defaultSession: '默认会话',
    newSession: '新会话',
    untitledSession: '无标题会话',
    directoryNotFound: '目录不存在',
    chromeNotReady: 'Chrome 未就绪',
    channelNotFound: '未找到通道',
    channelTypeNotFound: '未找到通道类型',
    requestBodyTooLarge: '请求体过大',
    internalServerError: '内部服务器错误',
    notFound: '未找到',
    sessionBuildTitlePrompt: '您想将此会话命名为什么？',
    sessionBuildTitlePromptNew: '为新会话命名',
    sessionBuildTitlePromptRename: '您想将此会话重命名为什么？',
    toolNoMountedWorkspace: '此会话没有挂载工作区',
    toolInvalidOrUnauthorizedPath: '无效或未授权的路径',
    toolPathOutsideWorkspace: '路径超出挂载的工作区',
    toolCommandFailed: '命令执行失败',
    toolFileNotFound: '文件未找到',
    toolStringNotFound: '文件中未找到字符串',
    toolEditFailed: '编辑失败',
    toolSearchFailed: '搜索失败',
    toolGlobFailed: 'Glob 失败',
    toolGrepFailed: 'Grep 失败',
    toolUrlRequired: 'URL 是必需的',
    toolInvalidUrl: '无效的 URL',
    toolOnlyHttpsSupported: '只支持 http/https URL',
    toolRequestTimeout: '请求超时',
    toolQueryRequired: '查询是必需的',
    apiKeyPlaceholder: 'sk-...',
    apiKeyHint: '用于认证的 API 密钥',
    baseUrlHint: 'API 基础 URL',
    taskDefaultTitle: '无标题任务',
    yourAnswerNeeded: '🤔 **需要您的回答**\n\n',
    yourAuthorizationNeeded: '⚠️ **需要您的授权**\n\n',
    toolParameters: '工具：',
    replyToAuthorize: '回复 "allow" 或 "y" 以授权',
    replyToDeny: '回复 "deny" 或 "n" 以拒绝',
    replyToAlways: '回复 "always" 以始终允许此工具',
    replyDirectly: '*(请直接回复您的答案)*',
    replyWithOptionNumber: '*(请回复选项编号，例如 1)*',
    multipleSelectionAllowed: '*(支持多选，用逗号分隔，例如 1,3)*',
    skipToSkip: '*回复此消息以回答，或发送 "skip" 跳过问题*',
    generateTitleRules:
      '请根据以下用户请求生成一个简短的标题。规则：\n- 最长15个字符（中文）或6个单词（英文）\n- 使用与用户请求相同的语言回复\n- 不要加引号、编号或结尾标点',
    generateTitleFromPrompt:
      '根据用户请求生成一个简短的会话标题：\n- 不超过15个字符\n- 使用与请求相同的语言\n- 不要加引号或编号',
  },
};

const defaultMessages: AgentRunnerMessages = {
  en: {
    processingRequest: 'Processing request...',
    waitingForModel: 'Waiting for model to load into memory...',
    contextCompaction: 'Compacting context ({{reason}})...',
    requestTimedOut: 'Request timed out',
    cancelled: 'Cancelled',
    errorOccurred: 'Error occurred',
    sandboxSyncing: 'Syncing files to sandbox...',
    sandboxConfiguring: 'Configuring skills...',
    sandboxReady: 'Sandbox ready',
    sandboxSyncFailed: 'Sandbox sync failed',
    sandboxFallback: 'Falling back to direct access mode (less secure)',
    taskCompleted: 'Task completed',
    requestFailed: 'Request failed',
    commandCancelled: 'Command cancelled: user denied sudo password.',
  },
  zh: {
    processingRequest: '正在处理请求...',
    waitingForModel: '正在加载模型到内存...',
    contextCompaction: '正在压缩上下文 ({{reason}})...',
    requestTimedOut: '请求超时',
    cancelled: '已取消',
    errorOccurred: '发生错误',
    sandboxSyncing: '正在同步文件到沙盒...',
    sandboxConfiguring: '正在配置技能...',
    sandboxReady: '沙盒就绪',
    sandboxSyncFailed: '沙盒同步失败',
    sandboxFallback: '正在回退到直接访问模式（安全性较低）',
    taskCompleted: '任务完成',
    requestFailed: '请求失败',
    commandCancelled: '命令已取消：用户拒绝提供 sudo 密码。',
  },
};

export function setGetCurrentLanguageFn(fn: () => 'en' | 'zh'): void {
  setErrorLanguageFn(fn);
}
