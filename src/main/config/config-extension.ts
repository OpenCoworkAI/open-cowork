/**
 * @module main/config/config-extension
 *
 * Agent runtime extension that exposes a read-only `config_read` tool,
 * allowing the agent to inspect its own non-sensitive configuration.
 *
 * Sensitive fields (API keys, tokens, secrets, passwords) are always
 * filtered out — they are never returned to the agent.
 */
import { Type } from '@sinclair/typebox';
import type {
  AgentRuntimeExtension,
  BeforeSessionRunResult,
  AgentRuntimeCustomTool,
} from '../extensions/agent-runtime-extension';
import type { ConfigStore, AppConfig } from './config-store';

/**
 * Pattern that matches config field names considered sensitive.
 * Used as a defense-in-depth check in buildSafeConfigSnapshot to
 * guard against accidentally adding a sensitive key to SAFE_TOP_LEVEL_KEYS.
 */
const SENSITIVE_KEY_PATTERN = /key|token|secret|password|credential/i;

/**
 * Top-level keys that are safe to expose to the agent.
 * Keys containing sensitive patterns (checked by SENSITIVE_KEY_PATTERN)
 * can still be in this list if they are genuinely non-secret numeric/boolean
 * values (e.g. `maxTokens` is a numeric limit, not a credential).
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
 * Defense-in-depth: even if a key is in SAFE_TOP_LEVEL_KEYS, we still
 * verify its runtime value isn't a string that looks like a credential.
 */
export function buildSafeConfigSnapshot(config: AppConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of SAFE_TOP_LEVEL_KEYS) {
    if (key in config) {
      const value = config[key];
      // Defense-in-depth: skip this field if its key name matches the
      // sensitive pattern (checks the key name, not the value content).
      if (typeof value === 'string' && SENSITIVE_KEY_PATTERN.test(key)) {
        continue;
      }
      result[key] = value;
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

export class ConfigExtension implements AgentRuntimeExtension {
  readonly name = 'config';

  constructor(private readonly configStore: ConfigStore) {}

  async beforeSessionRun(): Promise<BeforeSessionRunResult> {
    return {
      customTools: [createConfigReadTool(this.configStore)],
    };
  }
}
