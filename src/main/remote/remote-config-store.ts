/**
 * Remote Config Store
 * 远程控制配置存储
 */

import Store from 'electron-store';
import { log, logWarn } from '../utils/logger';
import {
  createEncryptedStoreWithKeyRotation,
  getLegacyDerivedKeyHexes,
} from '../utils/store-encryption';
import type {
  RemoteConfig,
  GatewayConfig,
  FeishuChannelConfig,
  WechatChannelConfig,
  TelegramChannelConfig,
  DingtalkChannelConfig,
  WebSocketChannelConfig,
  PairedUser,
} from './types';
import { DEFAULT_REMOTE_CONFIG } from './types';

class RemoteConfigStore {
  private store: Store<RemoteConfig & { pairedUsers: PairedUser[] }>;

  constructor() {
    // Cast to satisfy the Record<string, unknown> constraint of the encrypted store utility;
    // RemoteConfig & { pairedUsers: PairedUser[] } is structurally compatible at runtime.
    type RemoteConfigRecord = RemoteConfig & { pairedUsers: PairedUser[] } & Record<
        string,
        unknown
      >;
    this.store = createEncryptedStoreWithKeyRotation<RemoteConfigRecord>({
      stableKey: 'open-cowork-remote-stable-v1',
      legacyKeys: [
        'open-cowork-remote-v1',
        ...getLegacyDerivedKeyHexes({
          moduleDirname: __dirname,
          stableSeed: 'open-cowork-remote-stable-v1',
          legacySeed: 'open-cowork-remote-v1',
          salt: 'open-cowork-remote-salt',
        }),
      ],
      storeOptions: {
        name: 'remote-config',
        projectName: 'open-cowork',
        defaults: {
          ...DEFAULT_REMOTE_CONFIG,
          pairedUsers: [],
        },
      },
      logPrefix: '[RemoteConfigStore]',
      log,
      warn: logWarn,
    }) as unknown as Store<RemoteConfig & { pairedUsers: PairedUser[] }>;

    // Migrate: change pairing mode to allowlist (allow everyone by default)
    this.migrateAuthMode();
  }

  /**
   * Migrate old pairing mode to allowlist, preserving existing paired users
   */
  private migrateAuthMode(): void {
    const gateway = this.store.get('gateway');
    if (gateway?.auth?.mode === 'pairing') {
      // Carry over already-paired user IDs so they are not locked out.
      // Use channelType:userId format to preserve channel scoping.
      const pairedUsers = this.store.get('pairedUsers', []);
      const allowlist = pairedUsers.map((u: PairedUser) => `${u.channelType}:${u.userId}`);

      log(
        '[RemoteConfig] Migrating auth mode from pairing to allowlist, preserving',
        allowlist.length,
        'users'
      );
      this.store.set('gateway.auth', {
        mode: 'allowlist',
        allowlist,
        requirePairing: false,
      });
    }
  }

  /**
   * Get all remote config
   */
  getAll(): RemoteConfig {
    return {
      gateway: this.store.get('gateway'),
      channels: this.store.get('channels'),
    };
  }

  /**
   * Get gateway config
   */
  getGatewayConfig(): GatewayConfig {
    return this.store.get('gateway');
  }

  /**
   * Filter prototype pollution keys from user-controlled objects
   */
  private filterProtoPollution(obj: Record<string, unknown>): Record<string, unknown> {
    const filtered = { ...obj };
    delete filtered['__proto__'];
    delete filtered['constructor'];
    delete filtered['prototype'];
    return filtered;
  }

  /**
   * Update gateway config
   */
  setGatewayConfig(config: Partial<GatewayConfig>): void {
    const current = this.getGatewayConfig();
    this.store.set('gateway', {
      ...current,
      ...this.filterProtoPollution(config as Record<string, unknown>),
    });
    log('[RemoteConfig] Gateway config updated');
  }

  /**
   * Get feishu channel config
   */
  getFeishuConfig(): FeishuChannelConfig | undefined {
    return this.store.get('channels.feishu');
  }

  /**
   * Set feishu channel config
   */
  setFeishuConfig(config: FeishuChannelConfig): void {
    this.store.set('channels.feishu', config);
    log('[RemoteConfig] Feishu config updated');
  }

  /**
   * Get wechat channel config
   */
  getWechatConfig(): WechatChannelConfig | undefined {
    return this.store.get('channels.wechat');
  }

  /**
   * Set wechat channel config
   */
  setWechatConfig(config: WechatChannelConfig): void {
    this.store.set('channels.wechat', config);
    log('[RemoteConfig] WeChat config updated');
  }

  /**
   * Get telegram channel config
   */
  getTelegramConfig(): TelegramChannelConfig | undefined {
    return this.store.get('channels.telegram');
  }

  /**
   * Set telegram channel config
   */
  setTelegramConfig(config: TelegramChannelConfig): void {
    this.store.set('channels.telegram', config);
    log('[RemoteConfig] Telegram config updated');
  }

  /**
   * Get dingtalk channel config
   */
  getDingtalkConfig(): DingtalkChannelConfig | undefined {
    return this.store.get('channels.dingtalk');
  }

  /**
   * Set dingtalk channel config
   */
  setDingtalkConfig(config: DingtalkChannelConfig): void {
    this.store.set('channels.dingtalk', config);
    log('[RemoteConfig] DingTalk config updated');
  }

  /**
   * Get websocket channel config
   */
  getWebSocketConfig(): WebSocketChannelConfig | undefined {
    return this.store.get('channels.websocket');
  }

  /**
   * Set websocket channel config
   */
  setWebSocketConfig(config: WebSocketChannelConfig): void {
    this.store.set('channels.websocket', config);
    log('[RemoteConfig] WebSocket config updated');
  }

  /**
   * Check if remote is enabled
   */
  isEnabled(): boolean {
    return this.store.get('gateway.enabled', false);
  }

  /**
   * Enable/disable remote
   */
  setEnabled(enabled: boolean): void {
    this.store.set('gateway.enabled', enabled);
    log('[RemoteConfig] Remote enabled:', enabled);
  }

  /**
   * Get all paired users
   */
  getPairedUsers(): PairedUser[] {
    return this.store.get('pairedUsers', []);
  }

  /**
   * Add paired user
   */
  addPairedUser(user: PairedUser): void {
    const users = this.getPairedUsers();
    const existingIndex = users.findIndex(
      (u) => u.channelType === user.channelType && u.userId === user.userId
    );

    if (existingIndex >= 0) {
      users[existingIndex] = user;
    } else {
      users.push(user);
    }

    this.store.set('pairedUsers', users);
    this.syncAllowlist(users);
    log('[RemoteConfig] Paired user added:', user.userId);
  }

  /**
   * Remove paired user
   */
  removePairedUser(channelType: string, userId: string): boolean {
    const users = this.getPairedUsers();
    const newUsers = users.filter((u) => !(u.channelType === channelType && u.userId === userId));

    if (newUsers.length !== users.length) {
      this.store.set('pairedUsers', newUsers);
      this.syncAllowlist(newUsers);
      log('[RemoteConfig] Paired user removed:', userId);
      return true;
    }

    return false;
  }

  /**
   * Sync allowlist from paired users when auth mode is allowlist
   */
  private syncAllowlist(users: PairedUser[]): void {
    const gateway = this.store.get('gateway');
    if (gateway?.auth?.mode === 'allowlist') {
      this.store.set(
        'gateway.auth.allowlist',
        users.map((u) => `${u.channelType}:${u.userId}`)
      );
    }
  }

  /**
   * Check if user is paired
   */
  isPaired(channelType: string, userId: string): boolean {
    const users = this.getPairedUsers();
    return users.some((u) => u.channelType === channelType && u.userId === userId);
  }

  /**
   * Get config file path
   */
  getPath(): string {
    return this.store.path;
  }

  /**
   * Reset all config
   */
  reset(): void {
    this.store.clear();
    log('[RemoteConfig] Config reset');
  }
}

// Singleton instance
export const remoteConfigStore = new RemoteConfigStore();
