/**
 * IPC type definitions shared between the main process and the renderer/preload.
 *
 * Goals:
 *  - Eliminate `any` from preload/index.ts
 *  - Keep types minimal and structural (no runtime overhead)
 *  - Re-export from existing modules where possible; define locally only when
 *    the originating module lives in `main/` (not importable from renderer/preload).
 */

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

/** Configuration for a single MCP server (mirrors MCPServerConfig in mcp-manager.ts). */
export interface McpServerConfig {
  id: string;
  name: string;
  type: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

/** Tool exposed by an MCP server (mirrors MCPTool in mcp-manager.ts). */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  serverId: string;
  serverName: string;
}

/** Runtime status of a single MCP server. */
export interface McpServerStatus {
  id: string;
  name: string;
  connected: boolean;
  status: 'connecting' | 'connected' | 'failed' | 'disabled';
  toolCount: number;
}

/**
 * Preset MCP server configs returned by `mcp.getPresets`.
 * Each value is a partial MCPServerConfig (without `id` and `enabled`).
 */
export type McpPresetsMap = Record<
  string,
  Omit<McpServerConfig, 'id' | 'enabled'> & {
    requiresEnv?: string[];
    envDescription?: Record<string, string>;
  }
>;

// ---------------------------------------------------------------------------
// Remote
// ---------------------------------------------------------------------------

/** Slim channel-type union (mirrors ChannelType in remote/types.ts). */
export type RemoteChannelType = 'feishu' | 'wechat' | 'telegram' | 'dingtalk' | 'websocket';

/** Feishu channel configuration (mirrors FeishuChannelConfig in remote/types.ts). */
export interface FeishuChannelConfig {
  type: 'feishu';
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  useWebSocket?: boolean;
  dm: {
    policy: 'open' | 'pairing' | 'allowlist';
    allowFrom?: string[];
  };
  groups?: Record<string, { requireMention: boolean; allowFrom?: string[] }>;
  defaultGroupSettings?: { requireMention: boolean };
}

/** Gateway authentication config. */
export interface GatewayAuthConfig {
  mode: 'token' | 'allowlist' | 'pairing' | 'open';
  token?: string;
  allowlist?: string[];
  requirePairing?: boolean;
}

/** Tunnel configuration. */
export interface TunnelConfig {
  enabled: boolean;
  type: 'frp' | 'ngrok' | 'cloudflare';
  frp?: {
    serverAddr: string;
    serverPort: number;
    token?: string;
    subdomain?: string;
  };
  ngrok?: { authToken: string; region?: string };
  cloudflare?: { tunnelToken: string };
}

/** Gateway (remote server) configuration. */
export interface GatewayConfig {
  enabled: boolean;
  port: number;
  bind: '127.0.0.1' | '0.0.0.0';
  auth: GatewayAuthConfig;
  tunnel?: TunnelConfig;
  defaultWorkingDirectory?: string;
  autoApproveSafeTools?: boolean;
}

/** Full remote configuration returned by remote.getConfig. */
export interface RemoteConfig {
  gateway: GatewayConfig;
  channels: {
    feishu?: FeishuChannelConfig;
    wechat?: Record<string, unknown>;
    telegram?: Record<string, unknown>;
    dingtalk?: Record<string, unknown>;
    websocket?: Record<string, unknown>;
  };
}

/** A user that has been paired with a remote channel. */
export interface PairedUser {
  userId: string;
  userName?: string;
  channelType: RemoteChannelType;
  pairedAt: number;
  lastActiveAt: number;
}

/** A pending pairing request. */
export interface PairingRequest {
  code: string;
  channelType: RemoteChannelType;
  userId: string;
  userName?: string;
  createdAt: number;
  expiresAt: number;
}

/** An active remote session mapping. */
export interface RemoteSessionMapping {
  channelType: RemoteChannelType;
  channelId: string;
  userId?: string;
  sessionId: string;
  workingDirectory?: string;
  createdAt: number;
  lastActiveAt: number;
}
