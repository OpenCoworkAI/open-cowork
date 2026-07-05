/**
 * Tests for src/main/config/config-extension.
 *
 * Focus areas:
 *   - config_read tool returns non-sensitive fields when called without a key
 *   - config_read filters out API keys, tokens, profiles, and other secrets
 *   - config_read with a specific key returns that field's value
 *   - config_read rejects requests for sensitive keys
 *   - ConfigExtension.beforeSessionRun registers the config_read tool
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConfigExtension,
  buildSafeConfigSnapshot,
  isKeyReadable,
} from '../../main/config/config-extension';
import type { AppConfig } from '../../main/config/config-store';

// Minimal mock of ConfigStore — only getAll() is used by the extension
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

    it('beforeSessionRun returns config_read tool', async () => {
      const ext = new ConfigExtension(mockConfigStore as never);
      const result = await ext.beforeSessionRun();

      expect(result).toBeDefined();
      expect(result.customTools).toHaveLength(1);
      expect(result.customTools![0].name).toBe('config_read');
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
      configReadTool = result.customTools![0] as unknown as typeof configReadTool;
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
});
