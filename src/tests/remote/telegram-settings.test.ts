import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelegramChannelConfig } from '../../shared/ipc-types';

const mocks = vi.hoisted(() => ({
  setTelegramConfig: vi.fn(),
  clearTelegramConfig: vi.fn(),
  setGatewayConfig: vi.fn(),
  gateway: {
    enabled: false,
    port: 18789,
    bind: '127.0.0.1',
    auth: { mode: 'allowlist', allowlist: ['feishu:ou_existing', 'telegram:old'] },
  },
}));
vi.mock('../../main/utils/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));
vi.mock('../../main/remote/remote-config-store', () => ({
  remoteConfigStore: {
    getAll: () => ({ gateway: mocks.gateway, channels: {} }),
    getGatewayConfig: () => mocks.gateway,
    getPairedUsers: () => [],
    setTelegramConfig: mocks.setTelegramConfig,
    clearTelegramConfig: mocks.clearTelegramConfig,
    setGatewayConfig: mocks.setGatewayConfig,
  },
}));
import { RemoteManager } from '../../main/remote/remote-manager';

const config = (): TelegramChannelConfig => ({
  type: 'telegram',
  botToken: '123456:token',
  dm: { policy: 'allowlist', allowFrom: ['42', '43'] },
});

describe('Telegram config save path', () => {
  beforeEach(() => vi.clearAllMocks());
  it('persists Telegram and scopes allowed IDs while preserving other channels', async () => {
    const manager = new RemoteManager();
    await manager.updateTelegramConfig(config());
    expect(mocks.setTelegramConfig).toHaveBeenCalledWith(config());
    expect(mocks.setGatewayConfig).toHaveBeenCalledWith({
      auth: {
        mode: 'allowlist',
        allowlist: ['feishu:ou_existing', 'telegram:42', 'telegram:43'],
      },
    });
  });
  it('removes saved credentials and scoped allowlist entries on disconnect', async () => {
    await new RemoteManager().updateTelegramConfig(null);
    expect(mocks.clearTelegramConfig).toHaveBeenCalledOnce();
    expect(mocks.setGatewayConfig).toHaveBeenCalledWith({
      auth: {
        mode: 'allowlist',
        allowlist: ['feishu:ou_existing'],
      },
    });
  });
  it('rejects malformed or unrestricted configuration before persistence', async () => {
    await expect(
      new RemoteManager().updateTelegramConfig({ ...config(), dm: { policy: 'open' } })
    ).rejects.toThrow('numeric allowed user ID');
    expect(mocks.setTelegramConfig).not.toHaveBeenCalled();
    expect(mocks.setGatewayConfig).not.toHaveBeenCalled();
  });
});
