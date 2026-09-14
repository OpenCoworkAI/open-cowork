import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlackChannelConfig } from '../../main/remote/types';
import {
  SLACK_SOCKET_MODE_APP_TOKEN_REQUIRED,
  SLACK_SOCKET_MODE_BOT_TOKEN_REQUIRED,
  SLACK_WEBHOOK_SIGNING_SECRET_REQUIRED,
} from '../../shared/slack-channel-config';

const mocks = vi.hoisted(() => {
  const registerChannel = vi.fn();
  const gatewayOn = vi.fn();
  const setSlackConfig = vi.fn();
  const setGatewayConfig = vi.fn();
  const clearSlackConfig = vi.fn();
  const SlackChannel = vi.fn();

  class MockGateway {
    public running = false;
    start = vi.fn(async () => {
      this.running = true;
    });
    stop = vi.fn(async () => {
      this.running = false;
    });
    on = gatewayOn;
    setMessageInterceptor = vi.fn();
    registerChannel = registerChannel;
    getStatus = vi.fn(() => ({
      running: this.running,
      channels: [],
      activeSessions: 0,
      pendingPairings: 0,
    }));
  }

  const slackConfig: SlackChannelConfig = {
    type: 'slack',
    botToken: 'xoxb-test',
    appToken: 'xapp-test',
    useSocketMode: true,
    dm: { policy: 'pairing' },
  };

  const storeState = {
    gateway: {
      enabled: true,
      port: 18789,
      bind: '127.0.0.1' as const,
      auth: { mode: 'allowlist' as const, allowlist: [] as string[] },
      autoApproveSafeTools: false,
      defaultWorkingDirectory: '',
    },
    channels: {
      slack: slackConfig,
    },
  };

  return {
    registerChannel,
    gatewayOn,
    setSlackConfig,
    setGatewayConfig,
    clearSlackConfig,
    SlackChannel,
    MockGateway,
    slackConfig,
    storeState,
    getAll: vi.fn(() => storeState),
    getGatewayConfig: vi.fn(() => storeState.gateway),
    getSlackConfig: vi.fn(() => storeState.channels.slack),
    getPairedUsers: vi.fn(() => []),
  };
});

vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../main/remote/gateway', () => ({
  RemoteGateway: mocks.MockGateway,
}));

vi.mock('../../main/remote/remote-config-store', () => ({
  remoteConfigStore: {
    getAll: mocks.getAll,
    getGatewayConfig: mocks.getGatewayConfig,
    setGatewayConfig: mocks.setGatewayConfig,
    setSlackConfig: mocks.setSlackConfig,
    getSlackConfig: mocks.getSlackConfig,
    clearSlackConfig: mocks.clearSlackConfig,
    getPairedUsers: mocks.getPairedUsers,
  },
}));

vi.mock('../../main/remote/tunnel-manager', () => ({
  tunnelManager: {
    start: vi.fn(),
    stop: vi.fn(),
    getStatus: vi.fn(() => ({ connected: false })),
    getWebhookUrl: vi.fn(() => null),
  },
  TunnelStatus: {},
}));

vi.mock('../../main/remote/channels/feishu', () => ({
  FeishuChannel: vi.fn(),
}));

vi.mock('../../main/remote/channels/slack', () => ({
  SlackChannel: mocks.SlackChannel,
}));

vi.mock('../../main/remote/message-router', () => ({
  MessageRouter: class {
    onResponse = vi.fn();
    setAgentCallback = vi.fn();
    setWorkingDirectoryValidator = vi.fn();
    setDefaultWorkingDirectory = vi.fn();
    getActiveSessionCount = vi.fn(() => 0);
    getAllSessionMappings = vi.fn(() => []);
    clearSession = vi.fn(() => false);
  },
}));

function socketConfig(overrides: Partial<SlackChannelConfig> = {}): SlackChannelConfig {
  return {
    type: 'slack',
    botToken: 'xoxb-test',
    appToken: 'xapp-test',
    useSocketMode: true,
    dm: { policy: 'pairing' },
    ...overrides,
  };
}

describe('RemoteManager Slack config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storeState.channels.slack = mocks.slackConfig;
    mocks.storeState.gateway.enabled = true;
    mocks.storeState.gateway.auth = { mode: 'allowlist', allowlist: [] };
  });

  it('persists complete Socket Mode config to channels.slack', async () => {
    const { RemoteManager } = await import('../../main/remote/remote-manager');
    const manager = new RemoteManager();
    const config = socketConfig({ dm: { policy: 'pairing' } });

    await manager.updateSlackConfig(config);

    expect(mocks.setSlackConfig).toHaveBeenCalledWith(config);
  });

  it('does not downgrade a Feishu/gateway allowlist when Slack policy is pairing or open', async () => {
    const { RemoteManager } = await import('../../main/remote/remote-manager');
    const manager = new RemoteManager();
    mocks.storeState.gateway.auth = {
      mode: 'allowlist',
      allowlist: ['feishu:ou_existing'],
    };

    await manager.updateSlackConfig(socketConfig({ dm: { policy: 'open' } }));
    await manager.updateSlackConfig(socketConfig({ dm: { policy: 'pairing' } }));

    expect(mocks.setGatewayConfig).not.toHaveBeenCalled();
  });

  it('preserves existing dm.allowFrom and groups when settings save omits them', async () => {
    const { RemoteManager } = await import('../../main/remote/remote-manager');
    const manager = new RemoteManager();
    mocks.storeState.channels.slack = {
      type: 'slack',
      botToken: 'xoxb-old',
      appToken: 'xapp-old',
      useSocketMode: true,
      dm: { policy: 'allowlist', allowFrom: ['U123'] },
      groups: { C1: { requireMention: true } },
    };

    await manager.updateSlackConfig(
      socketConfig({
        botToken: 'xoxb-new',
        appToken: 'xapp-new',
        dm: { policy: 'pairing' },
      })
    );

    expect(mocks.setSlackConfig).toHaveBeenCalledWith({
      type: 'slack',
      botToken: 'xoxb-new',
      appToken: 'xapp-new',
      useSocketMode: true,
      dm: { policy: 'pairing', allowFrom: ['U123'] },
      groups: { C1: { requireMention: true } },
    });
  });

  it('clears Slack config when updateSlackConfig is called with null', async () => {
    const { RemoteManager } = await import('../../main/remote/remote-manager');
    const manager = new RemoteManager();

    await manager.updateSlackConfig(null);

    expect(mocks.clearSlackConfig).toHaveBeenCalledTimes(1);
    expect(mocks.setSlackConfig).not.toHaveBeenCalled();
  });

  it('rejects incomplete Socket Mode configs without persisting', async () => {
    const { RemoteManager } = await import('../../main/remote/remote-manager');
    const manager = new RemoteManager();

    await expect(manager.updateSlackConfig(socketConfig({ botToken: '' }))).rejects.toThrow(
      SLACK_SOCKET_MODE_BOT_TOKEN_REQUIRED
    );
    await expect(manager.updateSlackConfig(socketConfig({ appToken: '  ' }))).rejects.toThrow(
      SLACK_SOCKET_MODE_APP_TOKEN_REQUIRED
    );
    expect(mocks.setSlackConfig).not.toHaveBeenCalled();
  });

  it('rejects webhook configs without signingSecret', async () => {
    const { RemoteManager } = await import('../../main/remote/remote-manager');
    const manager = new RemoteManager();

    await expect(
      manager.updateSlackConfig(socketConfig({ useSocketMode: false, appToken: undefined }))
    ).rejects.toThrow(SLACK_WEBHOOK_SIGNING_SECRET_REQUIRED);
    expect(mocks.setSlackConfig).not.toHaveBeenCalled();
  });

  it('registers Slack after saved config is loaded', async () => {
    const { RemoteManager } = await import('../../main/remote/remote-manager');
    const manager = new RemoteManager();

    await manager.start();

    expect(mocks.SlackChannel).toHaveBeenCalledWith(mocks.slackConfig);
    expect(mocks.registerChannel).toHaveBeenCalledTimes(1);
    expect(mocks.gatewayOn).toHaveBeenCalledWith('webhook:slack', expect.any(Function));
  });
});
