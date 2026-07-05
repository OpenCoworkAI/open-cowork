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

export class ConfigExtension implements AgentRuntimeExtension {
  readonly name = 'config';

  constructor(private readonly configStore: ConfigStore) {}

  async beforeSessionRun(): Promise<BeforeSessionRunResult> {
    return {
      customTools: [createConfigReadTool(this.configStore)],
    };
  }
}
