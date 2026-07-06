/**
 * @module main/config/config-extension
 *
 * Agent runtime extension that exposes:
 *  - a read-only `config_read` tool, allowing the agent to inspect its own
 *    non-sensitive configuration.
 *  - a `config_write` tool, allowing the agent to change a small allow-list
 *    of non-sensitive settings. Every `config_write` call is always gated
 *    behind interactive user approval (see `permission: 'always-ask'`
 *    below and the subagent permission wiring in `src/main/index.ts`) — it
 *    can never be auto-allowed or silently invoked by a background
 *    subagent.
 *
 * Sensitive fields (API keys, tokens, secrets, passwords) are always
 * filtered out on read, and can never be targeted by a write — they are
 * never returned to, or mutated by, the agent.
 */
import { Type } from '@sinclair/typebox';
import type {
  AgentRuntimeExtension,
  BeforeSessionRunResult,
  AgentRuntimeCustomTool,
} from '../extensions/agent-runtime-extension';
import type { ConfigStore, AppConfig } from './config-store';
import { FIELD_VALIDATORS } from './config-store';

/**
 * A custom tool definition extended with a `permission` marker. The
 * pi-coding-agent SDK does not read this field — it only exists to declare,
 * at the point the tool is defined, that it must always require interactive
 * approval. The actual enforcement lives in two places:
 *  - the main-process permission gate (`decidePermission` in
 *    `permission-rules-store.ts`), which already defaults to `'ask'` for
 *    any tool name that has no explicit rule — `config_write` has none;
 *  - the subagent permission callback in `src/main/index.ts`, which
 *    special-cases `config_write` to always deny rather than silently
 *    allow, since a background subagent cannot show an interactive dialog.
 */
export interface PermissionAwareTool extends AgentRuntimeCustomTool {
  permission?: 'always-ask';
}

/**
 * Top-level keys that are safe to expose to the agent. This allow-list is
 * the sole trust boundary for both buildSafeConfigSnapshot and
 * isKeyReadable below — every entry has been manually vetted as
 * non-sensitive, even when its name coincidentally contains a
 * credential-like substring (e.g. `maxTokens` is a numeric limit,
 * `activeProfileKey` is a profile identifier like "anthropic" — neither
 * is a credential).
 */
const SAFE_TOP_LEVEL_KEYS = new Set<keyof AppConfig>([
  'provider',
  'model',
  'contextWindow',
  'maxTokens',
  'enableThinking',
  'sandboxEnabled',
  'memoryEnabled',
  'theme',
  'enableDevLogs',
  'defaultWorkdir',
  'activeProfileKey',
  'activeConfigSetId',
  'isConfigured',
]);

/**
 * Build a filtered view of the config that excludes sensitive data.
 * Every key in SAFE_TOP_LEVEL_KEYS has already been manually vetted as
 * non-sensitive (see the set's docstring above), so no further
 * name-pattern filtering is applied here.
 */
export function buildSafeConfigSnapshot(config: AppConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of SAFE_TOP_LEVEL_KEYS) {
    if (key in config) {
      result[key] = config[key];
    }
  }
  return result;
}

/**
 * Check whether a specific key is safe to read.
 * Keys in the explicit SAFE_TOP_LEVEL_KEYS set always pass, even if
 * their name happens to match the sensitive pattern (e.g. `maxTokens`
 * contains "token" but is a numeric limit, not a secret).
 */
export function isKeyReadable(key: string): boolean {
  // Explicit safe list takes precedence
  if (SAFE_TOP_LEVEL_KEYS.has(key as keyof AppConfig)) {
    return true;
  }
  // Everything else is blocked
  return false;
}

/**
 * Build the config_read tool definition.
 */
function createConfigReadTool(configStore: ConfigStore): AgentRuntimeCustomTool {
  return {
    name: 'config_read',
    label: 'config_read',
    description:
      'Read the current application configuration. Returns non-sensitive config fields. ' +
      'Provide an optional `key` parameter to read a specific field, or omit to get all readable fields.',
    parameters: Type.Object({
      key: Type.Optional(
        Type.String({
          description:
            'A specific config field name to read (e.g. "provider", "model", "sandboxEnabled"). ' +
            'Omit to read all non-sensitive fields.',
        })
      ),
    }),
    async execute(_toolCallId: string, params: unknown) {
      const { key } = (params || {}) as { key?: string };
      const config = configStore.getAll();

      if (key) {
        // Single key read
        if (!isKeyReadable(key)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: field "${key}" is not readable.`,
              },
            ],
            details: undefined,
          };
        }

        const value = config[key as keyof AppConfig];
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ [key]: value }, null, 2),
            },
          ],
          details: undefined,
        };
      }

      // Full snapshot
      const snapshot = buildSafeConfigSnapshot(config);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(snapshot, null, 2),
          },
        ],
        details: undefined,
      };
    },
  };
}

/**
 * Top-level AppConfig fields the agent is allowed to write. Every entry here
 * has been manually vetted as non-sensitive, even when its name
 * coincidentally matches SENSITIVE_KEY_PATTERN below (e.g. `maxTokens`
 * contains "token" but is a numeric limit, not a credential — same
 * reasoning as SAFE_TOP_LEVEL_KEYS above). This is checked *before* the
 * blocklist, so a manually-vetted field is never rejected by the pattern
 * check.
 */
const WRITABLE_KEYS = new Set<keyof AppConfig>([
  'defaultWorkdir',
  'theme',
  'enableDevLogs',
  'sandboxEnabled',
  'enableThinking',
  'memoryEnabled',
  'model',
  'contextWindow',
  'maxTokens',
]);

/**
 * Top-level fields that are always blocked from being written, regardless
 * of the pattern check below. These hold credentials directly or are
 * containers for nested credential-bearing structures (e.g. `profiles`
 * holds `profiles[*].apiKey`, `configSets` holds
 * `configSets[*].profiles[*].apiKey`, `memoryRuntime` holds
 * `memoryRuntime.llm.apiKey` / `memoryRuntime.embedding.apiKey`).
 */
const BLOCKED_TOP_LEVEL_KEYS = new Set<string>([
  'apiKey',
  'profiles',
  'configSets',
  'memoryRuntime',
]);

/**
 * Case-insensitive substring pattern for sensitive field names. Used as a
 * defense-in-depth check for keys that aren't already in WRITABLE_KEYS or
 * BLOCKED_TOP_LEVEL_KEYS — e.g. a future field literally named `authToken`
 * or `clientSecret` is blocked automatically without needing a code change
 * here.
 */
const SENSITIVE_KEY_PATTERN = /secret|token|password|key/i;

/**
 * Check whether a specific key may be written by the agent.
 * Keys in the explicit WRITABLE_KEYS set always pass, even if their name
 * happens to match the sensitive pattern (e.g. `maxTokens`).
 */
export function isKeyWritable(key: string): boolean {
  return WRITABLE_KEYS.has(key as keyof AppConfig);
}

/**
 * Check whether a specific key is explicitly blocked from being written.
 * A manually-vetted writable key is never treated as blocked. Everything
 * else is checked against the explicit blocklist and the sensitive-name
 * pattern.
 */
export function isKeyBlocked(key: string): boolean {
  if (WRITABLE_KEYS.has(key as keyof AppConfig)) {
    return false;
  }
  if (BLOCKED_TOP_LEVEL_KEYS.has(key)) {
    return true;
  }
  return SENSITIVE_KEY_PATTERN.test(key);
}

function toolTextResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    details: undefined,
  };
}

/**
 * Build the config_write tool definition.
 *
 * This tool always requires interactive user approval (see
 * `permission: 'always-ask'` and the module docstring above) — it can never
 * be auto-allowed by a permission rule or silently invoked by a background
 * subagent.
 */
function createConfigWriteTool(configStore: ConfigStore): PermissionAwareTool {
  return {
    name: 'config_write',
    label: 'config_write',
    permission: 'always-ask',
    description:
      'Write a single non-sensitive application configuration field. Always requires explicit ' +
      'user approval before executing. Sensitive fields (API keys, tokens, secrets, passwords, ' +
      'and any credential-bearing structure such as `profiles`, `configSets`, or `memoryRuntime`) ' +
      'can never be written and are rejected. ' +
      'Writable fields: defaultWorkdir, theme, enableDevLogs, sandboxEnabled, enableThinking, ' +
      'memoryEnabled, model, contextWindow, maxTokens.',
    parameters: Type.Object({
      key: Type.String({
        description:
          'The config field to write (e.g. "theme", "model", "sandboxEnabled"). Must be one of ' +
          'the writable fields listed in the tool description.',
      }),
      value: Type.Any({
        description: "The new value for the field. Must match the field's expected type.",
      }),
    }),
    async execute(_toolCallId: string, params: unknown) {
      const { key, value } = (params || {}) as { key?: string; value?: unknown };

      if (!key || typeof key !== 'string') {
        return toolTextResult('Error: "key" parameter is required and must be a string.');
      }

      if (isKeyBlocked(key)) {
        return toolTextResult(
          `Error: field "${key}" is a sensitive field and cannot be written by the agent.`
        );
      }

      if (!isKeyWritable(key)) {
        return toolTextResult(`Error: field "${key}" is not writable.`);
      }

      if (value === undefined) {
        return toolTextResult('Error: "value" parameter is required.');
      }

      const validator = FIELD_VALIDATORS[key];
      if (validator && !validator(value)) {
        return toolTextResult(`Error: invalid value for field "${key}": ${JSON.stringify(value)}.`);
      }

      const typedKey = key as keyof AppConfig;
      const oldValue = configStore.get(typedKey);
      configStore.set(typedKey, value as AppConfig[keyof AppConfig]);
      const newValue = configStore.get(typedKey);

      return toolTextResult(JSON.stringify({ key, oldValue, newValue }, null, 2));
    },
  };
}

export class ConfigExtension implements AgentRuntimeExtension {
  readonly name = 'config';

  constructor(private readonly configStore: ConfigStore) {}

  async beforeSessionRun(): Promise<BeforeSessionRunResult> {
    return {
      customTools: [
        createConfigReadTool(this.configStore),
        createConfigWriteTool(this.configStore),
      ],
    };
  }
}
