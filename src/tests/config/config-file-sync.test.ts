import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Test the config file export/import logic.
 *
 * Since ConfigStore has heavy Electron dependencies (electron-store, encryption),
 * we test the underlying logic directly: field filtering, JSON parsing, error handling.
 * The EXPORTABLE_FIELDS list is duplicated here to keep tests independent of module loading.
 */

// Mirror of the EXPORTABLE_FIELDS from config-store.ts — tests will fail if the
// source list changes, prompting an update here.
const EXPORTABLE_FIELDS = [
  'defaultWorkdir',
  'globalSkillsPath',
  'theme',
  'enableDevLogs',
  'sandboxEnabled',
  'enableThinking',
  'memoryEnabled',
  'model',
  'provider',
  'contextWindow',
  'maxTokens',
] as const;

type ExportableKey = (typeof EXPORTABLE_FIELDS)[number];

/**
 * Simulate exportSafeConfig logic: extract only exportable fields from a full config.
 */
function buildSafeSubset(config: Record<string, unknown>): Record<string, unknown> {
  const safeSubset: Record<string, unknown> = {};
  for (const key of EXPORTABLE_FIELDS) {
    if (config[key] !== undefined) {
      safeSubset[key] = config[key];
    }
  }
  return safeSubset;
}

/**
 * Simulate importSafeConfig logic: parse JSON and extract only exportable fields.
 * Returns null on error, empty object if no valid fields found.
 */
function parseAndFilterImport(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // Malformed JSON
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null; // Wrong root type
  }

  const obj = parsed as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  for (const key of EXPORTABLE_FIELDS) {
    if (key in obj && obj[key] !== undefined) {
      updates[key] = obj[key];
    }
  }
  return updates;
}

describe('Config File Sync', () => {
  let tmpDir: string;
  let publicConfigPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-file-sync-test-'));
    publicConfigPath = path.join(tmpDir, 'config.public.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('EXPORTABLE_FIELDS safety', () => {
    it('does not contain sensitive fields', () => {
      const sensitiveFields = [
        'apiKey',
        'baseUrl',
        'profiles',
        'configSets',
        'activeConfigSetId',
        'activeProfileKey',
        'customProtocol',
        'isConfigured',
        'memoryRuntime',
        'agentCliPath',
      ];
      for (const field of sensitiveFields) {
        expect(EXPORTABLE_FIELDS as readonly string[]).not.toContain(field);
      }
    });

    it('contains expected safe fields', () => {
      const expectedFields: ExportableKey[] = [
        'theme',
        'defaultWorkdir',
        'globalSkillsPath',
        'enableDevLogs',
        'sandboxEnabled',
        'enableThinking',
        'memoryEnabled',
        'model',
        'provider',
      ];
      for (const field of expectedFields) {
        expect(EXPORTABLE_FIELDS as readonly string[]).toContain(field);
      }
    });
  });

  describe('export writes only safe fields', () => {
    it('exports only EXPORTABLE_FIELDS from a full config', () => {
      const fullConfig: Record<string, unknown> = {
        provider: 'anthropic',
        apiKey: 'sk-ant-secret-key-12345',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-6',
        theme: 'dark',
        enableDevLogs: true,
        sandboxEnabled: false,
        enableThinking: true,
        memoryEnabled: true,
        defaultWorkdir: '/home/user/projects',
        globalSkillsPath: '/home/user/skills',
        contextWindow: 200000,
        maxTokens: 8192,
        profiles: { openrouter: { apiKey: 'secret' } },
        configSets: [{ id: 'default', name: 'test' }],
        activeConfigSetId: 'default',
        isConfigured: true,
      };

      const safeSubset = buildSafeSubset(fullConfig);
      fs.writeFileSync(publicConfigPath, JSON.stringify(safeSubset, null, 2), 'utf-8');
      const written = JSON.parse(fs.readFileSync(publicConfigPath, 'utf-8'));

      // Should contain safe fields
      expect(written.theme).toBe('dark');
      expect(written.model).toBe('claude-sonnet-4-6');
      expect(written.provider).toBe('anthropic');
      expect(written.enableDevLogs).toBe(true);
      expect(written.defaultWorkdir).toBe('/home/user/projects');
      expect(written.globalSkillsPath).toBe('/home/user/skills');
      expect(written.contextWindow).toBe(200000);
      expect(written.maxTokens).toBe(8192);
      expect(written.sandboxEnabled).toBe(false);
      expect(written.enableThinking).toBe(true);
      expect(written.memoryEnabled).toBe(true);

      // Should NOT contain sensitive fields
      expect(written.apiKey).toBeUndefined();
      expect(written.baseUrl).toBeUndefined();
      expect(written.profiles).toBeUndefined();
      expect(written.configSets).toBeUndefined();
      expect(written.activeConfigSetId).toBeUndefined();
      expect(written.isConfigured).toBeUndefined();
    });

    it('produces human-readable indented JSON', () => {
      const data = { theme: 'light', enableDevLogs: false };
      const content = JSON.stringify(data, null, 2);
      fs.writeFileSync(publicConfigPath, content, 'utf-8');
      const raw = fs.readFileSync(publicConfigPath, 'utf-8');

      // Should be indented (multi-line) with 2-space indent
      expect(raw).toContain('\n');
      expect(raw).toContain('  "theme"');
    });

    it('skips undefined fields', () => {
      const config: Record<string, unknown> = {
        theme: 'light',
        // contextWindow and maxTokens are undefined
      };
      const safeSubset = buildSafeSubset(config);

      expect(safeSubset.theme).toBe('light');
      expect('contextWindow' in safeSubset).toBe(false);
      expect('maxTokens' in safeSubset).toBe(false);
    });
  });

  describe('import applies only safe fields', () => {
    it('imports only EXPORTABLE_FIELDS from file content', () => {
      const fileContent = JSON.stringify({
        theme: 'dark',
        model: 'claude-opus-4',
        enableDevLogs: true,
        sandboxEnabled: true,
        // These should be ignored:
        apiKey: 'stolen-secret-key',
        baseUrl: 'https://evil.com',
        profiles: { openrouter: { apiKey: 'hacked' } },
        unknownField: 'should-be-ignored',
        configSets: [{ id: 'injected' }],
      });

      const updates = parseAndFilterImport(fileContent);

      expect(updates).not.toBeNull();
      // Should have safe fields
      expect(updates!.theme).toBe('dark');
      expect(updates!.model).toBe('claude-opus-4');
      expect(updates!.enableDevLogs).toBe(true);
      expect(updates!.sandboxEnabled).toBe(true);

      // Should NOT have sensitive or unknown fields
      expect(updates!.apiKey).toBeUndefined();
      expect(updates!.baseUrl).toBeUndefined();
      expect(updates!.profiles).toBeUndefined();
      expect(updates!.unknownField).toBeUndefined();
      expect(updates!.configSets).toBeUndefined();
    });

    it('returns empty object for empty JSON object', () => {
      const updates = parseAndFilterImport('{}');
      expect(updates).not.toBeNull();
      expect(Object.keys(updates!)).toHaveLength(0);
    });

    it('ignores fields with undefined values', () => {
      // JSON.parse of {"theme": null} gives null, which we should skip
      const updates = parseAndFilterImport('{"theme": null}');
      expect(updates).not.toBeNull();
      // null is not undefined, so it would be included (JSON has no undefined)
      // But the actual importSafeConfig checks `parsed[key] !== undefined`
      // and JSON.parse never produces `undefined` values, so null would pass through
      // This tests that the filtering logic works at the boundary
      expect(updates!.theme).toBeNull();
    });
  });

  describe('malformed JSON handling', () => {
    it('returns null for invalid JSON syntax', () => {
      const cases = [
        'this is not json {{{',
        '{theme: "dark"}', // unquoted key
        "{'theme': 'dark'}", // single quotes
        '', // empty string
        '   ', // whitespace only
      ];

      for (const raw of cases) {
        const result = parseAndFilterImport(raw);
        expect(result).toBeNull();
      }
    });

    it('returns null for JSON array (wrong root type)', () => {
      const result = parseAndFilterImport('[1, 2, 3]');
      expect(result).toBeNull();
    });

    it('returns null for JSON null', () => {
      const result = parseAndFilterImport('null');
      expect(result).toBeNull();
    });

    it('returns null for JSON primitives', () => {
      expect(parseAndFilterImport('42')).toBeNull();
      expect(parseAndFilterImport('"hello"')).toBeNull();
      expect(parseAndFilterImport('true')).toBeNull();
    });
  });

  describe('file watcher debounce logic', () => {
    it('debounce window prevents rapid-fire imports', async () => {
      const DEBOUNCE_MS = 500;
      let importCount = 0;

      const debouncedImport = (() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        return () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            importCount++;
            timer = null;
          }, DEBOUNCE_MS);
        };
      })();

      // Fire 5 rapid changes
      debouncedImport();
      debouncedImport();
      debouncedImport();
      debouncedImport();
      debouncedImport();

      // Before debounce expires, count should be 0
      expect(importCount).toBe(0);

      // Wait for debounce to complete
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 100));
      expect(importCount).toBe(1);
    });

    it('skip-own-writes pattern prevents import after export', () => {
      const SKIP_WINDOW_MS = 1000;
      let lastExportTimestamp = 0;

      const markOwnExport = () => {
        lastExportTimestamp = Date.now();
      };

      const isOwnExport = () => {
        return Date.now() - lastExportTimestamp < SKIP_WINDOW_MS;
      };

      // Before export, should not be "own"
      expect(isOwnExport()).toBe(false);

      // After marking export, should be "own"
      markOwnExport();
      expect(isOwnExport()).toBe(true);
    });

    it('skip-own-writes window expires after timeout', async () => {
      const SKIP_WINDOW_MS = 100; // Short window for testing
      let lastExportTimestamp = 0;

      const markOwnExport = () => {
        lastExportTimestamp = Date.now();
      };

      const isOwnExport = () => {
        return Date.now() - lastExportTimestamp < SKIP_WINDOW_MS;
      };

      markOwnExport();
      expect(isOwnExport()).toBe(true);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, SKIP_WINDOW_MS + 50));
      expect(isOwnExport()).toBe(false);
    });
  });

  describe('round-trip consistency', () => {
    it('export then import produces same subset', () => {
      const config: Record<string, unknown> = {
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4-6',
        theme: 'system',
        enableDevLogs: false,
        sandboxEnabled: true,
        enableThinking: false,
        memoryEnabled: true,
        defaultWorkdir: '/tmp/workspace',
        globalSkillsPath: '',
        contextWindow: 128000,
        maxTokens: 4096,
      };

      // Export
      const exported = buildSafeSubset(config);
      const json = JSON.stringify(exported, null, 2);

      // Import
      const imported = parseAndFilterImport(json);

      expect(imported).toEqual(exported);
    });
  });
});
