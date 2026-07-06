/**
 * Tests for src/main/config/config-extension.
 *
 * Focus areas:
 *   - config_read tool returns non-sensitive fields when called without a key
 *   - config_read filters out API keys, tokens, profiles, and other secrets
 *   - config_read with a specific key returns that field's value
 *   - config_read rejects requests for sensitive keys
 *   - config_write writes a safe field and reports old -> new value
 *   - config_write rejects sensitive/blocked fields
 *   - config_write rejects values that fail type validation
 *   - config_write blocklist pattern matching (fields containing key/secret/token/password)
 *   - ConfigExtension.beforeSessionRun registers both config_read and config_write
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConfigExtension,
  buildSafeConfigSnapshot,
  isKeyReadable,
  isKeyWritable,
  isKeyBlocked,
} from '../../main/config/config-extension';
import type { AppConfig } from '../../main/config/config-store';

// Minimal mock of ConfigStore — getAll/get/set backed by a shared mutable
// state object so config_write's effects are observable in tests.
function createMockConfigStore(overrides: Partial<AppConfig> = {}) {
  const defaults: AppConfig = {
    provider: 'anthropic',
    apiKey: 'sk-ant-secret-key-12345',
    baseUrl: 'https://api.anthropic.com',
    customProtocol: 'anthropic',
    model: 'claude-sonnet-4-6',
    contextWindow: 200000,
    maxTokens: 8192,
    activeProfileKey: 'anthropic',
    profiles: {
      anthropic: {
        apiKey: 'sk-ant-secret-key-12345',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-6',
      },
    },
    activeConfigSetId: 'default',
    configSets: [],
    agentCliPath: '',
    defaultWorkdir: '/home/user/projects',
    globalSkillsPath: '',
    enableDevLogs: false,
    theme: 'dark',
    sandboxEnabled: true,
    memoryEnabled: true,
    memoryRuntime: {
      llm: {
        inheritFromActive: true,
        apiKey: 'secret-llm-key',
        baseUrl: '',
        model: '',
        timeoutMs: 180000,
      },
      embedding: {
        inheritFromActive: true,
        apiKey: 'secret-embedding-key',
        baseUrl: '',
        model: 'text-embedding-3-small',
        timeoutMs: 180000,
      },
      useEmbedding: false,
      maxNavSteps: 2,
      ingestionConcurrency: 4,
      storageRoot: '',
    },
    enableThinking: true,
    isConfigured: true,
    ...overrides,
  };

  return {
    getAll: vi.fn(() => defaults),
    get: vi.fn((key: keyof AppConfig) => defaults[key]),
    set: vi.fn((key: keyof AppConfig, value: AppConfig[keyof AppConfig]) => {
      (defaults as unknown as Record<string, unknown>)[key] = value;
    }),
  };
}

describe('config-extension', () => {
  describe('buildSafeConfigSnapshot', () => {
    it('includes only safe top-level keys', () => {
      const config = createMockConfigStore().getAll();
      const snapshot = buildSafeConfigSnapshot(config);

      // Should include these safe keys
      expect(snapshot).toHaveProperty('provider', 'anthropic');
      expect(snapshot).toHaveProperty('model', 'claude-sonnet-4-6');
      expect(snapshot).toHaveProperty('sandboxEnabled', true);
      expect(snapshot).toHaveProperty('memoryEnabled', true);
      expect(snapshot).toHaveProperty('enableThinking', true);
      expect(snapshot).toHaveProperty('theme', 'dark');
      expect(snapshot).toHaveProperty('isConfigured', true);
      expect(snapshot).toHaveProperty('defaultWorkdir', '/home/user/projects');
    });

    it('excludes API key from snapshot', () => {
      const config = createMockConfigStore().getAll();
      const snapshot = buildSafeConfigSnapshot(config);

      expect(snapshot).not.toHaveProperty('apiKey');
    });

    it('excludes profiles (contains API keys) from snapshot', () => {
      const config = createMockConfigStore().getAll();
      const snapshot = buildSafeConfigSnapshot(config);

      expect(snapshot).not.toHaveProperty('profiles');
    });

    it('excludes configSets from snapshot', () => {
      const config = createMockConfigStore().getAll();
      const snapshot = buildSafeConfigSnapshot(config);

      expect(snapshot).not.toHaveProperty('configSets');
    });

    it('excludes baseUrl from snapshot', () => {
      const config = createMockConfigStore().getAll();
      const snapshot = buildSafeConfigSnapshot(config);

      expect(snapshot).not.toHaveProperty('baseUrl');
    });

    it('excludes memoryRuntime (contains API keys) from snapshot', () => {
      const config = createMockConfigStore().getAll();
      const snapshot = buildSafeConfigSnapshot(config);

      expect(snapshot).not.toHaveProperty('memoryRuntime');
    });
  });

  describe('isKeyReadable', () => {
    it('returns true for safe keys', () => {
      expect(isKeyReadable('provider')).toBe(true);
      expect(isKeyReadable('model')).toBe(true);
      expect(isKeyReadable('sandboxEnabled')).toBe(true);
      expect(isKeyReadable('memoryEnabled')).toBe(true);
      expect(isKeyReadable('enableThinking')).toBe(true);
      expect(isKeyReadable('theme')).toBe(true);
      expect(isKeyReadable('enableDevLogs')).toBe(true);
      expect(isKeyReadable('contextWindow')).toBe(true);
      expect(isKeyReadable('maxTokens')).toBe(true);
    });

    it('returns false for apiKey', () => {
      expect(isKeyReadable('apiKey')).toBe(false);
    });

    it('returns false for profiles', () => {
      expect(isKeyReadable('profiles')).toBe(false);
    });

    it('returns false for configSets', () => {
      expect(isKeyReadable('configSets')).toBe(false);
    });

    it('returns false for memoryRuntime', () => {
      expect(isKeyReadable('memoryRuntime')).toBe(false);
    });

    it('returns false for any key containing "key"', () => {
      expect(isKeyReadable('someApiKey')).toBe(false);
      expect(isKeyReadable('encryptionKey')).toBe(false);
    });

    it('returns false for any key containing "token"', () => {
      expect(isKeyReadable('authToken')).toBe(false);
      expect(isKeyReadable('refreshToken')).toBe(false);
    });

    it('returns false for any key containing "secret"', () => {
      expect(isKeyReadable('clientSecret')).toBe(false);
    });

    it('returns false for any key containing "password"', () => {
      expect(isKeyReadable('userPassword')).toBe(false);
    });

    it('returns false for unknown keys not in safe list', () => {
      expect(isKeyReadable('nonExistentField')).toBe(false);
      expect(isKeyReadable('internalState')).toBe(false);
    });
  });

  describe('ConfigExtension', () => {
    let mockConfigStore: ReturnType<typeof createMockConfigStore>;

    beforeEach(() => {
      mockConfigStore = createMockConfigStore();
    });

    it('has name "config"', () => {
      // Cast is needed because mock only implements getAll/get, not full ConfigStore
      const ext = new ConfigExtension(mockConfigStore as never);
      expect(ext.name).toBe('config');
    });

    it('beforeSessionRun returns config_read and config_write tools', async () => {
      const ext = new ConfigExtension(mockConfigStore as never);
      const result = await ext.beforeSessionRun();

      expect(result).toBeDefined();
      expect(result.customTools).toHaveLength(2);
      const toolNames = result.customTools!.map((t) => t.name);
      expect(toolNames).toContain('config_read');
      expect(toolNames).toContain('config_write');
    });

    it('declares config_write with permission: always-ask', async () => {
      const ext = new ConfigExtension(mockConfigStore as never);
      const result = await ext.beforeSessionRun();

      const configWriteTool = result.customTools!.find((t) => t.name === 'config_write') as {
        permission?: string;
      };
      expect(configWriteTool).toBeDefined();
      expect(configWriteTool.permission).toBe('always-ask');
    });
  });

  describe('config_read tool execution', () => {
    let configReadTool: {
      execute: (id: string, params: unknown, ...rest: unknown[]) => Promise<unknown>;
    };

    beforeEach(async () => {
      const mockStore = createMockConfigStore();
      const ext = new ConfigExtension(mockStore as never);
      const result = await ext.beforeSessionRun();
      configReadTool = result.customTools!.find(
        (t) => t.name === 'config_read'
      ) as unknown as typeof configReadTool;
    });

    it('returns all non-sensitive fields when no key is specified', async () => {
      const result = (await configReadTool.execute('test-call', {})) as {
        content: { type: string; text: string }[];
      };

      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse(result.content[0].text);

      // Should include safe fields
      expect(parsed).toHaveProperty('provider', 'anthropic');
      expect(parsed).toHaveProperty('model', 'claude-sonnet-4-6');
      expect(parsed).toHaveProperty('sandboxEnabled', true);
      expect(parsed).toHaveProperty('memoryEnabled', true);
      expect(parsed).toHaveProperty('enableThinking', true);
      expect(parsed).toHaveProperty('activeProfileKey', 'anthropic');
      expect(parsed).toHaveProperty('activeConfigSetId', 'default');

      // Should NOT include sensitive fields
      expect(parsed).not.toHaveProperty('apiKey');
      expect(parsed).not.toHaveProperty('profiles');
      expect(parsed).not.toHaveProperty('configSets');
      expect(parsed).not.toHaveProperty('memoryRuntime');
    });

    it('reads activeProfileKey individually', async () => {
      const result = (await configReadTool.execute('test-call', { key: 'activeProfileKey' })) as {
        content: { type: string; text: string }[];
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({ activeProfileKey: 'anthropic' });
    });

    it('reads activeConfigSetId individually', async () => {
      const result = (await configReadTool.execute('test-call', {
        key: 'activeConfigSetId',
      })) as {
        content: { type: string; text: string }[];
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({ activeConfigSetId: 'default' });
    });

    it('returns a specific field when key is provided', async () => {
      const result = (await configReadTool.execute('test-call', { key: 'provider' })) as {
        content: { type: string; text: string }[];
      };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({ provider: 'anthropic' });
    });

    it('returns contextWindow when requested', async () => {
      const result = (await configReadTool.execute('test-call', { key: 'contextWindow' })) as {
        content: { type: string; text: string }[];
      };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({ contextWindow: 200000 });
    });

    it('rejects reading apiKey', async () => {
      const result = (await configReadTool.execute('test-call', { key: 'apiKey' })) as {
        content: { type: string; text: string }[];
      };

      expect(result.content[0].text).toContain('not readable');
    });

    it('rejects reading profiles', async () => {
      const result = (await configReadTool.execute('test-call', { key: 'profiles' })) as {
        content: { type: string; text: string }[];
      };

      expect(result.content[0].text).toContain('not readable');
    });

    it('rejects reading configSets', async () => {
      const result = (await configReadTool.execute('test-call', { key: 'configSets' })) as {
        content: { type: string; text: string }[];
      };

      expect(result.content[0].text).toContain('not readable');
    });

    it('rejects reading memoryRuntime', async () => {
      const result = (await configReadTool.execute('test-call', { key: 'memoryRuntime' })) as {
        content: { type: string; text: string }[];
      };

      expect(result.content[0].text).toContain('not readable');
    });

    it('rejects reading keys with sensitive patterns', async () => {
      const result = (await configReadTool.execute('test-call', { key: 'authToken' })) as {
        content: { type: string; text: string }[];
      };

      expect(result.content[0].text).toContain('not readable');
    });

    it('handles null/undefined params gracefully', async () => {
      const result = (await configReadTool.execute('test-call', null)) as {
        content: { type: string; text: string }[];
      };

      // Should return full snapshot without crashing
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('provider');
      expect(parsed).not.toHaveProperty('apiKey');
    });
  });

  describe('isKeyWritable', () => {
    it('returns true for the documented safe writable fields', () => {
      expect(isKeyWritable('defaultWorkdir')).toBe(true);
      expect(isKeyWritable('theme')).toBe(true);
      expect(isKeyWritable('enableDevLogs')).toBe(true);
      expect(isKeyWritable('sandboxEnabled')).toBe(true);
      expect(isKeyWritable('enableThinking')).toBe(true);
      expect(isKeyWritable('memoryEnabled')).toBe(true);
      expect(isKeyWritable('model')).toBe(true);
      expect(isKeyWritable('contextWindow')).toBe(true);
      expect(isKeyWritable('maxTokens')).toBe(true);
    });

    it('returns false for sensitive/container fields', () => {
      expect(isKeyWritable('apiKey')).toBe(false);
      expect(isKeyWritable('profiles')).toBe(false);
      expect(isKeyWritable('configSets')).toBe(false);
      expect(isKeyWritable('memoryRuntime')).toBe(false);
    });

    it('returns false for fields not in the write allow-list', () => {
      expect(isKeyWritable('provider')).toBe(false);
      expect(isKeyWritable('baseUrl')).toBe(false);
      expect(isKeyWritable('activeProfileKey')).toBe(false);
      expect(isKeyWritable('isConfigured')).toBe(false);
      expect(isKeyWritable('nonExistentField')).toBe(false);
    });
  });

  describe('isKeyBlocked (blocklist pattern matching)', () => {
    it('blocks the explicit top-level sensitive fields', () => {
      expect(isKeyBlocked('apiKey')).toBe(true);
      expect(isKeyBlocked('profiles')).toBe(true);
      expect(isKeyBlocked('configSets')).toBe(true);
      expect(isKeyBlocked('memoryRuntime')).toBe(true);
    });

    it('blocks any field name containing "key" (case-insensitive)', () => {
      expect(isKeyBlocked('someApiKey')).toBe(true);
      expect(isKeyBlocked('encryptionKey')).toBe(true);
      expect(isKeyBlocked('APIKEY')).toBe(true);
    });

    it('blocks any field name containing "token" (case-insensitive)', () => {
      expect(isKeyBlocked('authToken')).toBe(true);
      expect(isKeyBlocked('refreshToken')).toBe(true);
    });

    it('blocks any field name containing "secret" (case-insensitive)', () => {
      expect(isKeyBlocked('clientSecret')).toBe(true);
      expect(isKeyBlocked('SECRET_VALUE')).toBe(true);
    });

    it('blocks any field name containing "password" (case-insensitive)', () => {
      expect(isKeyBlocked('userPassword')).toBe(true);
    });

    it('does NOT block manually-vetted writable fields that coincidentally match the pattern', () => {
      // "maxTokens" contains "Tokens" (matches /token/i) but is a numeric
      // limit, not a credential — it must remain writable.
      expect(isKeyBlocked('maxTokens')).toBe(false);
      expect(isKeyWritable('maxTokens')).toBe(true);
    });

    it('does not block arbitrary unknown fields with no sensitive pattern', () => {
      expect(isKeyBlocked('someUnknownField')).toBe(false);
    });
  });

  describe('config_write tool execution', () => {
    let mockStore: ReturnType<typeof createMockConfigStore>;
    let configWriteTool: {
      execute: (id: string, params: unknown, ...rest: unknown[]) => Promise<unknown>;
    };

    beforeEach(async () => {
      mockStore = createMockConfigStore();
      const ext = new ConfigExtension(mockStore as never);
      const result = await ext.beforeSessionRun();
      configWriteTool = result.customTools!.find(
        (t) => t.name === 'config_write'
      ) as unknown as typeof configWriteTool;
    });

    it('writes a safe field and reports old -> new value', async () => {
      const result = (await configWriteTool.execute('test-call', {
        key: 'theme',
        value: 'light',
      })) as { content: { type: string; text: string }[] };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({ key: 'theme', oldValue: 'dark', newValue: 'light' });
      expect(mockStore.set).toHaveBeenCalledWith('theme', 'light');
      // The store must reflect the write for subsequent reads.
      expect(mockStore.get('theme' as keyof AppConfig)).toBe('light');
    });

    it('writes sandboxEnabled (boolean field) and reports old -> new value', async () => {
      const result = (await configWriteTool.execute('test-call', {
        key: 'sandboxEnabled',
        value: false,
      })) as { content: { type: string; text: string }[] };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({ key: 'sandboxEnabled', oldValue: true, newValue: false });
    });

    it('rejects writing apiKey', async () => {
      const result = (await configWriteTool.execute('test-call', {
        key: 'apiKey',
        value: 'sk-should-not-work',
      })) as { content: { type: string; text: string }[] };

      expect(result.content[0].text).toContain('sensitive');
      expect(mockStore.set).not.toHaveBeenCalled();
    });

    it('rejects writing profiles', async () => {
      const result = (await configWriteTool.execute('test-call', {
        key: 'profiles',
        value: {},
      })) as { content: { type: string; text: string }[] };

      expect(result.content[0].text).toContain('sensitive');
      expect(mockStore.set).not.toHaveBeenCalled();
    });

    it('rejects writing configSets', async () => {
      const result = (await configWriteTool.execute('test-call', {
        key: 'configSets',
        value: [],
      })) as { content: { type: string; text: string }[] };

      expect(result.content[0].text).toContain('sensitive');
      expect(mockStore.set).not.toHaveBeenCalled();
    });

    it('rejects writing memoryRuntime', async () => {
      const result = (await configWriteTool.execute('test-call', {
        key: 'memoryRuntime',
        value: {},
      })) as { content: { type: string; text: string }[] };

      expect(result.content[0].text).toContain('sensitive');
      expect(mockStore.set).not.toHaveBeenCalled();
    });

    it('rejects writing a field with a sensitive-pattern name not in AppConfig', async () => {
      const result = (await configWriteTool.execute('test-call', {
        key: 'authToken',
        value: 'x',
      })) as { content: { type: string; text: string }[] };

      expect(result.content[0].text).toContain('sensitive');
      expect(mockStore.set).not.toHaveBeenCalled();
    });

    it('rejects a field not in the writable allow-list with a generic message', async () => {
      const result = (await configWriteTool.execute('test-call', {
        key: 'provider',
        value: 'anthropic',
      })) as { content: { type: string; text: string }[] };

      expect(result.content[0].text).toContain('not writable');
      expect(mockStore.set).not.toHaveBeenCalled();
    });

    it('rejects an invalid type for a boolean field', async () => {
      const result = (await configWriteTool.execute('test-call', {
        key: 'sandboxEnabled',
        value: 'yes',
      })) as { content: { type: string; text: string }[] };

      expect(result.content[0].text).toContain('invalid value');
      expect(mockStore.set).not.toHaveBeenCalled();
    });

    it('rejects an invalid type for a numeric field', async () => {
      const result = (await configWriteTool.execute('test-call', {
        key: 'contextWindow',
        value: 'a lot',
      })) as { content: { type: string; text: string }[] };

      expect(result.content[0].text).toContain('invalid value');
      expect(mockStore.set).not.toHaveBeenCalled();
    });

    it('rejects a negative number for contextWindow', async () => {
      const result = (await configWriteTool.execute('test-call', {
        key: 'contextWindow',
        value: -1,
      })) as { content: { type: string; text: string }[] };

      expect(result.content[0].text).toContain('invalid value');
      expect(mockStore.set).not.toHaveBeenCalled();
    });

    it('rejects a missing key parameter', async () => {
      const result = (await configWriteTool.execute('test-call', { value: 'x' })) as {
        content: { type: string; text: string }[];
      };

      expect(result.content[0].text).toContain('Error');
      expect(mockStore.set).not.toHaveBeenCalled();
    });

    it('rejects a missing value parameter', async () => {
      const result = (await configWriteTool.execute('test-call', { key: 'theme' })) as {
        content: { type: string; text: string }[];
      };

      expect(result.content[0].text).toContain('Error');
      expect(mockStore.set).not.toHaveBeenCalled();
    });

    it('handles null/undefined params gracefully', async () => {
      const result = (await configWriteTool.execute('test-call', null)) as {
        content: { type: string; text: string }[];
      };

      expect(result.content[0].text).toContain('Error');
      expect(mockStore.set).not.toHaveBeenCalled();
    });
  });
});
