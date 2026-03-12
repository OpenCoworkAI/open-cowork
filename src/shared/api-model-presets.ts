export type SharedProviderType = 'openrouter' | 'anthropic' | 'custom' | 'openai' | 'gemini';

export type SharedCustomProtocolType = 'anthropic' | 'openai' | 'gemini';

export interface SharedProviderPreset {
  name: string;
  baseUrl: string;
  models: Array<{ id: string; name: string }>;
  keyPlaceholder: string;
  keyHint: string;
}

export interface SharedProviderPresets {
  openrouter: SharedProviderPreset;
  anthropic: SharedProviderPreset;
  custom: SharedProviderPreset;
  openai: SharedProviderPreset;
  gemini: SharedProviderPreset;
}

export interface ModelInputGuidance {
  placeholder: string;
  hint: string;
}

export const API_PROVIDER_PRESETS: SharedProviderPresets = {
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'anthropic/claude-opus-4-6', name: 'anthropic/claude-opus-4-6' },
      { id: 'anthropic/claude-sonnet-4-6', name: 'anthropic/claude-sonnet-4-6' },
      { id: 'anthropic/claude-haiku-4-5', name: 'anthropic/claude-haiku-4-5' },
      { id: 'openai/gpt-5.4', name: 'openai/gpt-5.4' },
      { id: 'openai/gpt-5.3-codex', name: 'openai/gpt-5.3-codex' },
      { id: 'google/gemini-3.1-pro-preview', name: 'google/gemini-3.1-pro-preview' },
      { id: 'google/gemini-3-flash-preview', name: 'google/gemini-3-flash-preview' },
      { id: 'google/gemini-2.5-flash', name: 'google/gemini-2.5-flash' },
    ],
    keyPlaceholder: 'sk-or-v1-...',
    keyHint: '从 openrouter.ai/keys 获取',
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: [
      { id: 'claude-opus-4-6', name: 'claude-opus-4-6' },
      { id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6' },
      { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5' },
      { id: 'claude-sonnet-4-5', name: 'claude-sonnet-4-5' },
      { id: 'claude-3-7-sonnet-latest', name: 'claude-3-7-sonnet-latest' },
    ],
    keyPlaceholder: 'sk-ant-...',
    keyHint: '从 console.anthropic.com 获取',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5.4', name: 'gpt-5.4' },
      { id: 'gpt-5.4-pro', name: 'gpt-5.4-pro' },
      { id: 'gpt-5-mini', name: 'gpt-5-mini' },
      { id: 'gpt-5-nano', name: 'gpt-5-nano' },
      { id: 'gpt-5.3-codex', name: 'gpt-5.3-codex' },
      { id: 'o3', name: 'o3' },
      { id: 'gpt-4.1', name: 'gpt-4.1' },
    ],
    keyPlaceholder: 'sk-...',
    keyHint: '从 platform.openai.com 获取',
  },
  gemini: {
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    models: [
      { id: 'gemini-3.1-pro-preview', name: 'gemini-3.1-pro-preview' },
      { id: 'gemini-3-flash-preview', name: 'gemini-3-flash-preview' },
      { id: 'gemini-3.1-flash-lite-preview', name: 'gemini-3.1-flash-lite-preview' },
      { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro' },
      { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash' },
      { id: 'gemini-2.5-flash-lite', name: 'gemini-2.5-flash-lite' },
    ],
    keyPlaceholder: 'AIza...',
    keyHint: '从 aistudio.google.com 获取',
  },
  custom: {
    name: '更多模型',
    baseUrl: '',
    models: [
      { id: 'deepseek-chat', name: 'deepseek-chat' },
      { id: 'deepseek-reasoner', name: 'deepseek-reasoner' },
      { id: 'kimi-thinking-preview', name: 'kimi-thinking-preview' },
      { id: 'glm-5', name: 'glm-5' },
      { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5' },
      { id: 'qwen-max', name: 'qwen-max' },
      { id: 'grok-code-fast-1', name: 'grok-code-fast-1' },
      { id: 'mistral-large-latest', name: 'mistral-large-latest' },
    ],
    keyPlaceholder: 'sk-xxx',
    keyHint: '输入你的 API Key',
  },
};

export const PI_AI_CURATED_PRESETS: Record<string, { piProvider: string; pick: string[] }> = {
  openrouter: {
    piProvider: 'openrouter',
    pick: [
      'anthropic/claude-opus-4-6',
      'anthropic/claude-sonnet-4-6',
      'anthropic/claude-haiku-4-5',
      'openai/gpt-5.4',
      'openai/gpt-5.3-codex',
      'google/gemini-3.1-pro-preview',
      'google/gemini-3-flash-preview',
      'google/gemini-2.5-flash',
    ],
  },
  anthropic: {
    piProvider: 'anthropic',
    pick: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-3-7-sonnet-latest'],
  },
  openai: {
    piProvider: 'openai',
    pick: ['gpt-5.4', 'gpt-5.4-pro', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.3-codex', 'o3', 'gpt-4.1'],
  },
  gemini: {
    piProvider: 'google',
    pick: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  },
};

export function getModelInputGuidance(
  provider: SharedProviderType,
  customProtocol: SharedCustomProtocolType = 'anthropic'
): ModelInputGuidance {
  if (provider === 'openrouter') {
    return {
      placeholder: 'openai/gpt-5.4, anthropic/claude-sonnet-4-6, google/gemini-3-flash-preview',
      hint: 'Use the exact model ID from provider docs.',
    };
  }

  if (provider === 'custom' && customProtocol === 'openai') {
    return {
      placeholder: 'deepseek-chat, deepseek-reasoner, kimi-thinking-preview, glm-5',
      hint: 'Use the exact model ID from provider docs.',
    };
  }

  if (provider === 'custom' && customProtocol === 'gemini') {
    return {
      placeholder: 'gemini-3.1-pro-preview, gemini-3-flash-preview, gemini-2.5-flash',
      hint: 'Use the exact model ID from provider docs.',
    };
  }

  if (provider === 'custom') {
    return {
      placeholder: 'claude-sonnet-4-6, claude-opus-4-6, glm-5',
      hint: 'Use the exact model ID from provider docs.',
    };
  }

  if (provider === 'openai') {
    return {
      placeholder: 'gpt-5.4, gpt-5.3-codex, o3',
      hint: 'Use the exact model ID from provider docs.',
    };
  }

  if (provider === 'gemini') {
    return {
      placeholder: 'gemini-3.1-pro-preview, gemini-3-flash-preview, gemini-2.5-flash',
      hint: 'Use the exact model ID from provider docs.',
    };
  }

  return {
    placeholder: 'claude-sonnet-4-6, claude-opus-4-6',
    hint: 'Use the exact model ID from provider docs.',
  };
}
