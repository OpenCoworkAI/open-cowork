/**
 * Shared types for RemoteControlPanel sub-components
 */

export interface GatewayStatus {
  running: boolean;
  port?: number;
  publicUrl?: string;
  channels: Array<{ type: string; connected: boolean; error?: string }>;
  activeSessions: number;
  pendingPairings: number;
}

export interface PairedUser {
  userId: string;
  userName?: string;
  channelType: string;
  pairedAt: number;
  lastActiveAt: number;
}

export interface PairingRequest {
  code: string;
  channelType: string;
  userId: string;
  userName?: string;
  createdAt: number;
  expiresAt: number;
}

export interface RemoteConfig {
  gateway: {
    enabled: boolean;
    port: number;
    bind: string;
    defaultWorkingDirectory?: string;
    autoApproveSafeTools?: boolean;
    tunnel?: {
      enabled: boolean;
      type: 'ngrok' | 'cloudflare' | 'frp';
      ngrok?: {
        authToken: string;
        region?: string;
      };
    };
    auth: {
      mode: string;
      token?: string;
      requirePairing?: boolean;
    };
  };
  channels: {
    feishu?: {
      appId: string;
      appSecret: string;
      useWebSocket?: boolean;
      dm: {
        policy: string;
      };
    };
    slack?: {
      botToken: string;
      appToken?: string;
      useSocketMode?: boolean;
      dm: {
        policy: string;
      };
    };
    email?: {
      provider: string;
      user: string;
      password: string;
      fromName?: string;
      imap?: { host: string; port: number; secure: boolean };
      smtp?: { host: string; port: number; secure: boolean };
      dm: {
        policy: string;
        allowFrom?: string[];
      };
    };
  };
}

export interface TunnelStatus {
  connected: boolean;
  url: string | null;
  provider: string;
  error?: string;
}

export type ConfigStep = 'feishu' | 'email' | 'connection' | 'advanced';

export type LocalizedBanner = { key?: string; text?: string | null };
