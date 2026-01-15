import Store from 'electron-store';

/**
 * Application configuration schema
 */
export interface AppConfig {
  // API Provider
  provider: 'openrouter' | 'anthropic' | 'custom';
  
  // API credentials
  apiKey: string;
  baseUrl?: string;
  
  // Model selection
  model: string;
  
  // Optional: Claude Code CLI path override
  claudeCodePath?: string;
  
  // Optional: Default working directory
  defaultWorkdir?: string;
  
  // First run flag
  isConfigured: boolean;
}

const defaultConfig: AppConfig = {
  provider: 'openrouter',
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api',
  model: 'anthropic/claude-sonnet-4.5',
  claudeCodePath: '',
  defaultWorkdir: '',
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
      { id: 'z-ai/glm-4.7', name: 'GLM-4.7' },
    ],
    keyPlaceholder: 'sk-or-v1-...',
    keyHint: '从 openrouter.ai/keys 获取',
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: [
      { id: 'claude-sonnet-4-5-20250514', name: 'Claude Sonnet 4.5' },
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
    ],
    keyPlaceholder: 'sk-ant-...',
    keyHint: '从 console.anthropic.com 获取',
  },
  custom: {
    name: '自定义',
    baseUrl: '',
    models: [],
    keyPlaceholder: '',
    keyHint: '填写你的 API 地址和密钥',
  },
};

class ConfigStore {
  private store: Store<AppConfig>;

  constructor() {
    this.store = new Store<AppConfig>({
      name: 'config',
      defaults: defaultConfig,
      // Encrypt the API key for basic security
      encryptionKey: 'open-cowork-config-v1',
    });
  }

  /**
   * Get all config
   */
  getAll(): AppConfig {
    return {
      provider: this.store.get('provider'),
      apiKey: this.store.get('apiKey'),
      baseUrl: this.store.get('baseUrl'),
      model: this.store.get('model'),
      claudeCodePath: this.store.get('claudeCodePath'),
      defaultWorkdir: this.store.get('defaultWorkdir'),
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
   * Environment variable mapping by provider:
   * - Anthropic direct: ANTHROPIC_API_KEY = apiKey (standard SDK var)
   * - OpenRouter/Custom: ANTHROPIC_AUTH_TOKEN = apiKey, ANTHROPIC_API_KEY = '' (proxy mode)
   */
  applyToEnv(): void {
    const config = this.getAll();
    
    // Clear all API-related env vars first to ensure clean state when switching providers
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;
    
    if (config.provider === 'anthropic') {
      // Anthropic direct API: use ANTHROPIC_API_KEY (standard SDK behavior)
      if (config.apiKey) {
        process.env.ANTHROPIC_API_KEY = config.apiKey;
      }
      // No base URL needed, SDK uses default https://api.anthropic.com
    } else {
      // OpenRouter / Custom: use ANTHROPIC_AUTH_TOKEN for proxy authentication
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
    
    // Only set CLAUDE_CODE_PATH if the configured path actually exists
    // This allows auto-detection to work when the configured path is invalid
    if (config.claudeCodePath) {
      const fs = require('fs');
      if (fs.existsSync(config.claudeCodePath)) {
        process.env.CLAUDE_CODE_PATH = config.claudeCodePath;
        console.log('[Config] Using configured Claude Code path:', config.claudeCodePath);
      } else {
        console.log('[Config] Configured Claude Code path not found, will use auto-detection:', config.claudeCodePath);
        // Don't set the env var, let auto-detection find it
      }
    }
    
    if (config.defaultWorkdir) {
      process.env.COWORK_WORKDIR = config.defaultWorkdir;
    }
    
    console.log('[Config] Applied env vars for provider:', config.provider, {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '✓ Set' : '(empty/unset)',
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ? '✓ Set' : '(empty/unset)',
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '(default)',
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

