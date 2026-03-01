import Store from 'electron-store';
import { log } from '../utils/logger';

/**
 * Application configuration schema
 */
export interface AppConfig {
  // API Provider
  provider: 'openrouter' | 'anthropic' | 'custom' | 'openai';
  
  // API credentials
  apiKey: string;
  baseUrl?: string;
  customProtocol?: 'anthropic' | 'openai';
  
  // Model selection
  model: string;

  // OpenAI API mode
  openaiMode: 'responses' | 'chat';
  
  // Optional: Claude Code CLI path override
  claudeCodePath?: string;
  
  // Optional: Default working directory
  defaultWorkdir?: string;
  
  // Developer logs
  enableDevLogs: boolean;
  
  // Sandbox mode (WSL/Lima isolation)
  sandboxEnabled: boolean;
  
  // Enable thinking mode (show thinking steps)
  enableThinking: boolean;
  
  // First run flag
  isConfigured: boolean;
}

const defaultConfig: AppConfig = {
  provider: 'openrouter',
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api',
  customProtocol: 'anthropic',
  model: 'anthropic/claude-sonnet-4.5',
  openaiMode: 'responses',
  claudeCodePath: '',
  defaultWorkdir: '',
  enableDevLogs: true,
  sandboxEnabled: false,
  enableThinking: false,
  isConfigured: false,
};

// Provider presets
export const PROVIDER_PRESETS = {
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api',
    models: [
      { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
      { id: 'moonshotai/kimi-k2-0905', name: 'Kimi K2' },
      { id: 'z-ai/glm-4.7', name: 'GLM-4.7' },
    ],
    keyPlaceholder: 'sk-or-v1-...',
    keyHint: '从 openrouter.ai/keys 获取',
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: [
      { id: 'claude-sonnet-4-5', name: 'claude-sonnet-4-5' },
      { id: 'claude-opus-4-5', name: 'claude-opus-4-5' },
      { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5' },
    ],
    keyPlaceholder: 'sk-ant-...',
    keyHint: '从 console.anthropic.com 获取',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5.2', name: 'gpt-5.2' },
      { id: 'gpt-5.2-codex', name: 'gpt-5.2-codex' },
      { id: 'gpt-5.2-mini', name: 'gpt-5.2-mini' },
    ],
    keyPlaceholder: 'sk-...',
    keyHint: '从 platform.openai.com 获取',
  },
  custom: {
    name: '更多模型',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    models: [
      { id: 'glm-4.7', name: 'GLM-4.7' },
      { id: 'glm-4-plus', name: 'GLM-4-Plus' },
      { id: 'glm-4-air', name: 'GLM-4-Air' },
    ],
    keyPlaceholder: 'sk-xxx',
    keyHint: '输入你的 API Key',
  },
};

class ConfigStore {
  private store: Store<AppConfig>;

  constructor() {
    const storeOptions: any = {
      name: 'config',
      defaults: defaultConfig,
      // Encrypt the API key for basic security
      encryptionKey: 'open-cowork-config-v1',
    };
    
    // Add projectName for non-Electron environments (e.g., MCP servers)
    // This is required by the underlying 'conf' package
    if (typeof process !== 'undefined' && !process.versions.electron) {
      storeOptions.projectName = 'open-cowork';
    }
    
    this.store = new Store<AppConfig>(storeOptions);
  }

  /**
   * Get all config
   */
  getAll(): AppConfig {
    return {
      provider: this.store.get('provider'),
      apiKey: this.store.get('apiKey'),
      baseUrl: this.store.get('baseUrl'),
      customProtocol: this.store.get('customProtocol'),
      model: this.store.get('model'),
      openaiMode: this.store.get('openaiMode'),
      claudeCodePath: this.store.get('claudeCodePath'),
      defaultWorkdir: this.store.get('defaultWorkdir'),
      enableDevLogs: this.store.get('enableDevLogs'),
      sandboxEnabled: this.store.get('sandboxEnabled'),
      enableThinking: this.store.get('enableThinking'),
      isConfigured: this.store.get('isConfigured'),
    };
  }

  /**
   * Get a specific config value
   */
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.store.get(key);
  }

  /**
   * Set a specific config value
   */
  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.store.set(key, value);
  }

  /**
   * Update multiple config values
   */
  update(updates: Partial<AppConfig>): void {
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        this.store.set(key as keyof AppConfig, value);
      }
    }
  }

  /**
   * Check if the app is configured (has API key)
   */
  isConfigured(): boolean {
    return this.store.get('isConfigured') && !!this.store.get('apiKey');
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
    
    const useOpenAI =
      config.provider === 'openai' ||
      (config.provider === 'custom' && config.customProtocol === 'openai');

    if (useOpenAI) {
      if (config.apiKey) {
        process.env.OPENAI_API_KEY = config.apiKey;
      }
      if (config.baseUrl) {
        process.env.OPENAI_BASE_URL = config.baseUrl;
      }
      if (config.model) {
        process.env.OPENAI_MODEL = config.model;
      }
      process.env.OPENAI_API_MODE = 'responses';
    } else {
      if (config.provider === 'anthropic' || (config.provider === 'custom' && config.customProtocol !== 'openai')) {
        // Anthropic direct API or Anthropic-compatible custom: use ANTHROPIC_API_KEY
        if (config.apiKey) {
          process.env.ANTHROPIC_API_KEY = config.apiKey;
        }
        if (config.baseUrl) {
          process.env.ANTHROPIC_BASE_URL = config.baseUrl;
        }
        delete process.env.ANTHROPIC_AUTH_TOKEN;
      } else {
        // OpenRouter: use ANTHROPIC_AUTH_TOKEN for proxy authentication
        if (config.apiKey) {
          process.env.ANTHROPIC_AUTH_TOKEN = config.apiKey;
        }
        if (config.baseUrl) {
          process.env.ANTHROPIC_BASE_URL = config.baseUrl;
        }
        // ANTHROPIC_API_KEY must be empty to prevent SDK from using it
        process.env.ANTHROPIC_API_KEY = '';
      }

      if (config.model) {
        process.env.CLAUDE_MODEL = config.model;
        process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = config.model;
      }
    }
    
    // Only set CLAUDE_CODE_PATH if the configured path actually exists
    // This allows auto-detection to work when the configured path is invalid
    if (config.claudeCodePath) {
      const fs = require('fs');
      if (fs.existsSync(config.claudeCodePath)) {
        process.env.CLAUDE_CODE_PATH = config.claudeCodePath;
        log('[Config] Using configured Claude Code path:', config.claudeCodePath);
      } else {
        log('[Config] Configured Claude Code path not found, will use auto-detection:', config.claudeCodePath);
        // Don't set the env var, let auto-detection find it
      }
    }
    
    if (config.defaultWorkdir) {
      process.env.COWORK_WORKDIR = config.defaultWorkdir;
    }
    
    log('[Config] Applied env vars for provider:', config.provider, {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '✓ Set' : '(empty/unset)',
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ? '✓ Set' : '(empty/unset)',
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '(default)',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? '✓ Set' : '(empty/unset)',
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || '(default)',
      OPENAI_MODEL: process.env.OPENAI_MODEL || '(not set)',
      OPENAI_API_MODE: process.env.OPENAI_API_MODE || '(default)',
    });
  }

  /**
   * Reset config to defaults
   */
  reset(): void {
    this.store.clear();
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
