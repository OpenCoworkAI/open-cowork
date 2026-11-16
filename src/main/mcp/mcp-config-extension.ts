import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import type {
  AgentRuntimeCustomTool,
  AgentRuntimeExtension,
  BeforeSessionRunResult,
} from '../extensions/agent-runtime-extension';
import type { MCPManager, MCPServerConfig } from './mcp-manager';
import { isPlainObject, normalizeMcpServerEntry } from '../../shared/mcp-config';

interface McpConfigurationStore {
  getServersForSettings(): MCPServerConfig[];
  getServer(id: string): MCPServerConfig | undefined;
  saveServer(config: MCPServerConfig): void;
}

class McpConfigurationValidationError extends Error {}

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: undefined };
}

function describeServer(server: MCPServerConfig) {
  // Do not echo credentials, command arguments, URL query strings or headers
  // from an existing connector into a conversation.
  return {
    id: server.id,
    name: server.name,
    type: server.type,
    enabled: server.enabled,
    envKeys: Object.keys(server.env || {}),
    headerKeys: Object.keys(server.headers || {}),
  };
}

function stringRecord(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every((item) => typeof item === 'string');
}

/** A connected old instance does not prove a deferred configuration was applied. */
export async function activateMcpConfiguration(
  manager: Pick<MCPManager, 'updateServer' | 'getServerStatus'>,
  config: MCPServerConfig
): Promise<void> {
  const applied = await manager.updateServer(config);
  const status = manager.getServerStatus().find((server) => server.id === config.id);
  if (!applied || !status || (config.enabled ? !status.connected : status.status !== 'disabled')) {
    throw new Error('MCP activation is still pending.');
  }
}

export function validateMcpConfiguration(
  input: unknown,
  existing?: MCPServerConfig
): MCPServerConfig {
  if (!isPlainObject(input))
    throw new McpConfigurationValidationError('A server configuration object is required.');
  if (typeof input.name !== 'string' || !input.name.trim())
    throw new McpConfigurationValidationError('A server name is required.');
  if (input.id !== undefined && (typeof input.id !== 'string' || !input.id.trim()))
    throw new McpConfigurationValidationError('Server id must be a non-empty string.');
  if (!['stdio', 'sse', 'streamable-http'].includes(String(input.type)))
    throw new McpConfigurationValidationError('Server type must be stdio, sse or streamable-http.');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean')
    throw new McpConfigurationValidationError('enabled must be a boolean.');
  if (input.type === 'stdio') {
    if (typeof input.command !== 'string' || !input.command.trim())
      throw new McpConfigurationValidationError('A stdio command is required.');
    if (
      input.args !== undefined &&
      (!Array.isArray(input.args) || !input.args.every((arg) => typeof arg === 'string'))
    )
      throw new McpConfigurationValidationError('args must be an array of strings.');
  } else {
    if (typeof input.url !== 'string')
      throw new McpConfigurationValidationError('An HTTP server URL is required.');
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw new McpConfigurationValidationError('A valid HTTP server URL is required.');
    }
    if (!['http:', 'https:'].includes(url.protocol))
      throw new McpConfigurationValidationError('Only HTTP and HTTPS server URLs are supported.');
  }
  for (const field of ['env', 'headers']) {
    if (input[field] !== undefined && !stringRecord(input[field]))
      throw new McpConfigurationValidationError(`${field} must contain string values.`);
  }
  const merged: Record<string, unknown> = {
    ...existing,
    ...input,
    id: input.id ?? `mcp-${randomUUID()}`,
    enabled: input.enabled ?? existing?.enabled ?? false,
  };
  const sameTarget =
    existing !== undefined &&
    existing.type === input.type &&
    (input.type === 'stdio'
      ? existing.command?.trim() === String(input.command).trim() &&
        JSON.stringify(existing.args ?? []) === JSON.stringify(input.args ?? existing.args ?? []) &&
        existing.cwd === (input.cwd ?? existing.cwd)
      : existing.url?.trim() === String(input.url).trim());
  if (!sameTarget) {
    // Every env/header value may be a secret, including unrecognised key names.
    // Omitted credentials may only follow edits to the same transport target.
    if (!Object.hasOwn(input, 'env')) delete merged.env;
    if (!Object.hasOwn(input, 'headers')) delete merged.headers;
    // A different executable must not inherit potentially secret CLI arguments.
    if (existing?.command !== input.command && !Object.hasOwn(input, 'args')) delete merged.args;
  }
  const { server } = normalizeMcpServerEntry(merged, undefined, new Set());
  if (!server) throw new McpConfigurationValidationError('Invalid MCP server configuration.');
  return server;
}

/** Chat configuration uses the normal permission hook; it never executes a shell command. */
export class McpConfigExtension implements AgentRuntimeExtension {
  readonly name = 'mcp-config';
  private readonly pending = new Map<string, MCPServerConfig>();
  private activation: Promise<boolean> | null = null;

  constructor(
    private readonly store: McpConfigurationStore,
    private readonly activate: (server: MCPServerConfig) => Promise<void>,
    private readonly invalidate: () => void = () => {}
  ) {}

  private async activatePending(): Promise<boolean> {
    let failed = false;
    for (const [id, config] of Array.from(this.pending)) {
      try {
        const current = this.store.getServer(id);
        // Respect a later edit/delete from Settings instead of resurrecting the
        // connector configuration that was approved in an earlier chat turn.
        if (current) await this.activate(current);
        this.invalidate();
        if (this.pending.get(id) === config) this.pending.delete(id);
      } catch {
        // Keep it queued so a transient offline server can be retried next turn.
        failed = true;
      }
    }
    return failed;
  }

  async beforeSessionRun(): Promise<BeforeSessionRunResult> {
    // Apply saved configuration before the runner rebuilds MCP tools on the
    // following turn, without replacing a tool set during its current call.
    this.activation ??= this.activatePending();
    const failed = await this.activation;
    this.activation = null;
    const list: AgentRuntimeCustomTool = {
      name: 'mcp_list',
      label: 'mcp_list',
      description:
        'List configured MCP connectors without credentials. Use their IDs when updating a connector.',
      parameters: Type.Object({}),
      execute: async () => {
        try {
          return textResult({ servers: this.store.getServersForSettings().map(describeServer) });
        } catch {
          return textResult({
            error: 'MCP configuration could not be read. Check Settings → MCP Connectors.',
          });
        }
      },
    };
    const configure: AgentRuntimeCustomTool = {
      name: 'mcp_configure',
      label: 'mcp_configure',
      description:
        'Add or update an MCP connector using configuration supplied by the user or the server documentation. Do not invent an app server command, endpoint or credentials. New connectors default to disabled; set enabled:true only when the user requests activation. This configuration change uses the normal approval flow. It saves configuration, never installs packages itself, and activation is applied on the next turn. For updates, include the connector ID and its name and transport configuration. Omitted credentials are preserved only for the same transport target; when changing an endpoint, executable or its arguments, supply any credentials explicitly.',
      parameters: Type.Object({
        server: Type.Object({
          id: Type.Optional(Type.String()),
          name: Type.String(),
          type: Type.Union([
            Type.Literal('stdio'),
            Type.Literal('sse'),
            Type.Literal('streamable-http'),
          ]),
          command: Type.Optional(Type.String()),
          args: Type.Optional(Type.Array(Type.String())),
          url: Type.Optional(Type.String()),
          enabled: Type.Optional(Type.Boolean()),
          env: Type.Optional(Type.Record(Type.String(), Type.String())),
          headers: Type.Optional(Type.Record(Type.String(), Type.String())),
        }),
      }),
      execute: async (_toolCallId, params: unknown) => {
        try {
          const input = isPlainObject(params) ? params.server : undefined;
          const existing =
            isPlainObject(input) && typeof input.id === 'string'
              ? this.store.getServer(input.id)
              : undefined;
          const config = validateMcpConfiguration(input, existing);
          this.store.saveServer(config);
          const saved = this.store.getServer(config.id);
          if (!saved) throw new Error('MCP configuration was not persisted.');
          this.pending.set(saved.id, saved);
          this.invalidate();
          return textResult({ saved: describeServer(saved), appliesOnNextTurn: true });
        } catch (error) {
          // Validation errors contain only field names; persistence exceptions
          // may include connection/config data, so never return their text.
          return textResult({
            error:
              error instanceof McpConfigurationValidationError
                ? error.message
                : 'MCP configuration could not be saved. Check Settings → MCP Connectors.',
          });
        }
      },
    };
    return {
      customTools: [list, configure],
      promptPrefix: failed
        ? 'An MCP connector configuration was saved but could not be activated. Check Settings → MCP Connectors; do not claim that the connection succeeded.'
        : undefined,
    };
  }
}
