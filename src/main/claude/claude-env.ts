import type { AppConfig } from '../config/config-store';

const CLAUDE_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'CLAUDE_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_API_MODE',
  'CLAUDE_CODE_PATH',
];

export function getClaudeEnvOverrides(config: AppConfig): NodeJS.ProcessEnv {
  const overrides: NodeJS.ProcessEnv = {};
  const useOpenAI =
    config.provider === 'openai' ||
    (config.provider === 'custom' && config.customProtocol === 'openai');

  if (config.model) {
    overrides.CLAUDE_MODEL = config.model;
  }

  if (useOpenAI) {
    if (config.apiKey) overrides.OPENAI_API_KEY = config.apiKey;
    if (config.baseUrl) overrides.OPENAI_BASE_URL = config.baseUrl;
    if (config.openaiMode) overrides.OPENAI_API_MODE = config.openaiMode;
    if (config.model) overrides.OPENAI_MODEL = config.model;
    return overrides;
  }

  if (config.apiKey) {
    if (config.provider === 'openrouter') {
      overrides.ANTHROPIC_AUTH_TOKEN = config.apiKey;
    } else {
      overrides.ANTHROPIC_API_KEY = config.apiKey;
    }
  }
  if (config.baseUrl) overrides.ANTHROPIC_BASE_URL = config.baseUrl;
  if (config.model) overrides.ANTHROPIC_DEFAULT_SONNET_MODEL = config.model;

  return overrides;
}

export function buildClaudeEnv(
  shellEnv: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const envOverrides: NodeJS.ProcessEnv = {};
  for (const key of CLAUDE_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      envOverrides[key] = process.env[key];
    }
  }
  return {
    ...shellEnv,
    ...envOverrides,
    ...overrides,
  };
}
