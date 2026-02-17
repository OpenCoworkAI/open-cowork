import type { AppConfig } from './config-store';
import { importLocalAuthToken } from '../auth/local-auth';

const API_KEY_PREFIX_RE = /^sk-/i;
const CHATGPT_ACCOUNT_ID_RE = /^[-_a-zA-Z0-9]{6,}$/;

export const OPENAI_PLATFORM_BASE_URL = 'https://api.openai.com/v1';
export const OPENAI_CODEX_BACKEND_BASE_URL = 'https://chatgpt.com/backend-api/codex';

type OpenAIConfigLike = Pick<AppConfig, 'provider' | 'customProtocol' | 'apiKey' | 'baseUrl'>;

export interface ResolvedOpenAICredentials {
  apiKey: string;
  baseUrl?: string;
  accountId?: string;
  useCodexOAuth: boolean;
  source: 'apiKey' | 'localCodex';
}

export function isLikelyOAuthAccessToken(token: string | undefined | null): boolean {
  const value = token?.trim();
  if (!value) {
    return false;
  }
  return !API_KEY_PREFIX_RE.test(value);
}

export function shouldUseAnthropicAuthToken(config: Pick<AppConfig, 'provider' | 'customProtocol' | 'apiKey'>): boolean {
  if (config.provider === 'openrouter') {
    return true;
  }
  if (config.provider !== 'anthropic') {
    return false;
  }
  return isLikelyOAuthAccessToken(config.apiKey);
}

export function isOpenAIProvider(config: Pick<AppConfig, 'provider' | 'customProtocol'>): boolean {
  return config.provider === 'openai' || (config.provider === 'custom' && config.customProtocol === 'openai');
}

function sanitizeChatGPTAccountId(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value || value.includes('@')) {
    return undefined;
  }
  if (!CHATGPT_ACCOUNT_ID_RE.test(value)) {
    return undefined;
  }
  return value;
}

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  const value = baseUrl?.trim();
  if (!value) {
    return undefined;
  }
  return value.replace(/\/+$/, '');
}

function shouldUseCodexOAuthForProvidedToken(config: OpenAIConfigLike, token: string): boolean {
  if (!isLikelyOAuthAccessToken(token)) {
    return false;
  }

  // OpenAI 官方 provider 下，非 sk- token 视为 Codex OAuth token
  if (config.provider === 'openai') {
    return true;
  }

  // 自定义 OpenAI 协议仅在明确使用 Codex backend 时按 OAuth 处理
  const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl);
  return config.provider === 'custom'
    && config.customProtocol === 'openai'
    && normalizedBaseUrl === OPENAI_CODEX_BACKEND_BASE_URL;
}

export function resolveOpenAICredentials(config: OpenAIConfigLike): ResolvedOpenAICredentials | null {
  const trimmedApiKey = config.apiKey?.trim();
  if (trimmedApiKey) {
    if (shouldUseCodexOAuthForProvidedToken(config, trimmedApiKey)) {
      const localCodex = importLocalAuthToken('codex');
      return {
        apiKey: trimmedApiKey,
        baseUrl: OPENAI_CODEX_BACKEND_BASE_URL,
        accountId: sanitizeChatGPTAccountId(localCodex?.account),
        useCodexOAuth: true,
        source: 'apiKey',
      };
    }

    return {
      apiKey: trimmedApiKey,
      baseUrl: normalizeBaseUrl(config.baseUrl),
      useCodexOAuth: false,
      source: 'apiKey',
    };
  }

  if (!isOpenAIProvider(config)) {
    return null;
  }

  const localCodex = importLocalAuthToken('codex');
  const localToken = localCodex?.token?.trim();
  if (!localToken) {
    return null;
  }

  return {
    apiKey: localToken,
    baseUrl: OPENAI_CODEX_BACKEND_BASE_URL,
    accountId: sanitizeChatGPTAccountId(localCodex?.account),
    useCodexOAuth: true,
    source: 'localCodex',
  };
}

export function buildOpenAICodexHeaders(accountId?: string): Record<string, string> {
  return {
    'User-Agent': 'CodexBar',
    ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
  };
}
