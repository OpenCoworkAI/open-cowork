export interface LLMProviderConfig {
  name: string;
  baseUrl: string;
  authType: 'bearer' | 'api-key';
  authHeader: string;
  models: Record<string, string>;
  defaultModel: string;
}

export const deepseekConfig: LLMProviderConfig = {
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  authType: 'bearer',
  authHeader: 'Authorization',
  models: {
    'deepseek-chat': 'deepseek-chat',
    'deepseek-coder': 'deepseek-coder',
    'deepseek-reasoner': 'deepseek-reasoner'
  },
  defaultModel: 'deepseek-chat'
};

export const qwenConfig: LLMProviderConfig = {
  name: 'Qwen',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  authType: 'bearer',
  authHeader: 'Authorization',
  models: {
    'qwen-turbo': 'qwen-turbo',
    'qwen-plus': 'qwen-plus',
    'qwen-max': 'qwen-max',
    'qwen-coder-plus': 'qwen-coder-plus'
  },
  defaultModel: 'qwen-turbo'
};

export const llmProviders: Record<string, LLMProviderConfig> = {
  deepseek: deepseekConfig,
  qwen: qwenConfig
};
