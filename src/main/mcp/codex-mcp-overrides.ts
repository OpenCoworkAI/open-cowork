import type { MCPServerConfig } from './mcp-manager';
import { mcpConfigStore } from './mcp-config-store';
import { importLocalAuthToken } from '../auth/local-auth';
import { OPENAI_CODEX_BACKEND_BASE_URL } from '../config/auth-utils';

const SOFTWARE_DEV_PLACEHOLDER = '{SOFTWARE_DEV_SERVER_PATH}';
const GUI_OPERATE_PLACEHOLDER = '{GUI_OPERATE_SERVER_PATH}';
const AUTH_ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_ACCOUNT_ID',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
] as const;

export interface CodexMcpOverrideBuildOptions {
  servers?: MCPServerConfig[];
  placeholderValues?: {
    softwareDevPath?: string;
    guiOperatePath?: string;
  };
  runtimeEnv?: NodeJS.ProcessEnv;
}

export function buildCodexMcpOverrides(options: CodexMcpOverrideBuildOptions = {}): string[] {
  const sourceServers = options.servers ?? mcpConfigStore.getEnabledServers();
  const servers = sourceServers.filter((server) => server.enabled !== false);
  if (servers.length === 0) {
    return [];
  }

  const placeholderValues = options.placeholderValues ?? resolveDefaultPlaceholderValues();
  const usedKeys = new Set<string>();
  const sharedAuthEnv = buildSharedAuthEnv(options.runtimeEnv ?? process.env);

  return servers
    .map((server) => normalizeServerForCodex(server, placeholderValues))
    .map((server) => {
      const serverKey = normalizeCodexMcpServerKey(server.name || server.id || 'mcp', usedKeys);
      const payload = buildCodexPayload(server, sharedAuthEnv);
      if (!payload) {
        return null;
      }
      return `mcp_servers.${serverKey}=${toTomlInlineTable(payload)}`;
    })
    .filter((item): item is string => Boolean(item));
}

export function normalizeCodexMcpServerKey(name: string, usedKeys?: Set<string>): string {
  const raw = (name || 'mcp').trim();
  const replaced = raw
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  const base = replaced || 'mcp';
  const withPrefix = /^\d/.test(base) ? `server_${base}` : base;

  if (!usedKeys) {
    return withPrefix;
  }

  let candidate = withPrefix;
  let suffix = 2;
  while (usedKeys.has(candidate)) {
    candidate = `${withPrefix}_${suffix}`;
    suffix += 1;
  }
  usedKeys.add(candidate);
  return candidate;
}

export function resolveCodexMcpServerArgs(
  args: string[] | undefined,
  placeholderValues: { softwareDevPath?: string; guiOperatePath?: string }
): string[] {
  if (!args || args.length === 0) {
    return [];
  }

  return args.map((arg) => {
    if (arg === SOFTWARE_DEV_PLACEHOLDER && placeholderValues.softwareDevPath) {
      return placeholderValues.softwareDevPath;
    }
    if (arg === GUI_OPERATE_PLACEHOLDER && placeholderValues.guiOperatePath) {
      return placeholderValues.guiOperatePath;
    }
    return arg;
  });
}

function normalizeServerForCodex(
  server: MCPServerConfig,
  placeholderValues: { softwareDevPath?: string; guiOperatePath?: string }
): MCPServerConfig {
  return {
    ...server,
    args: resolveCodexMcpServerArgs(server.args, placeholderValues),
  };
}

function resolveDefaultPlaceholderValues(): { softwareDevPath?: string; guiOperatePath?: string } {
  const softwarePreset = mcpConfigStore.createFromPreset('software-development', false);
  const guiPreset = mcpConfigStore.createFromPreset('gui-operate', false);

  return {
    softwareDevPath: softwarePreset?.args?.[0],
    guiOperatePath: guiPreset?.args?.[0],
  };
}

function buildCodexPayload(
  server: MCPServerConfig,
  sharedAuthEnv: Record<string, string>
): Record<string, unknown> | null {
  if (server.type === 'sse') {
    if (!server.url?.trim()) {
      return null;
    }
    return {
      url: server.url.trim(),
      ...(server.headers && Object.keys(server.headers).length > 0 ? { headers: server.headers } : {}),
    };
  }

  if (!server.command?.trim()) {
    return null;
  }

  const env = mergeServerEnvWithSharedAuth(server.env, sharedAuthEnv);

  return {
    command: server.command.trim(),
    ...(server.args && server.args.length > 0 ? { args: server.args } : {}),
    ...(env && Object.keys(env).length > 0 ? { env } : {}),
  };
}

function buildSharedAuthEnv(runtimeEnv: NodeJS.ProcessEnv): Record<string, string> {
  const shared: Record<string, string> = {};
  for (const key of AUTH_ENV_KEYS) {
    const value = runtimeEnv[key];
    if (typeof value === 'string' && value.trim()) {
      shared[key] = value.trim();
    }
  }

  if (!shared.OPENAI_API_KEY) {
    const localCodex = importLocalAuthToken('codex');
    const localToken = localCodex?.token?.trim();
    if (localToken) {
      shared.OPENAI_API_KEY = localToken;
      if (!shared.OPENAI_BASE_URL) {
        shared.OPENAI_BASE_URL = OPENAI_CODEX_BACKEND_BASE_URL;
      }
      if (!shared.OPENAI_ACCOUNT_ID && localCodex?.account) {
        shared.OPENAI_ACCOUNT_ID = localCodex.account;
      }
    }
  }

  return shared;
}

function mergeServerEnvWithSharedAuth(
  serverEnv: Record<string, string> | undefined,
  sharedAuthEnv: Record<string, string>
): Record<string, string> | undefined {
  if ((!serverEnv || Object.keys(serverEnv).length === 0) && Object.keys(sharedAuthEnv).length === 0) {
    return serverEnv;
  }

  const merged: Record<string, string> = { ...(serverEnv || {}) };
  for (const [key, value] of Object.entries(sharedAuthEnv)) {
    const existing = merged[key];
    if (typeof existing === 'string' && existing.trim()) {
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function toTomlInlineTable(value: Record<string, unknown>): string {
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .map(([key, entryValue]) => `${toTomlKey(key)}=${toTomlValue(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function toTomlValue(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => toTomlValue(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return toTomlInlineTable(value as Record<string, unknown>);
  }
  return '""';
}

function toTomlKey(key: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(key)) {
    return key;
  }
  return JSON.stringify(key);
}
