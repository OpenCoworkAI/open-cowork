import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const gatewayStop = vi.fn(async () => {});
  const gatewayStart = vi.fn(async () => {
    const error = Object.assign(new Error('address in use'), { code: 'EADDRINUSE' });
    throw error;
  });

  class MockGateway {
    public running = false;
    start = gatewayStart;
    stop = gatewayStop;
    on = vi.fn();
    setMessageInterceptor = vi.fn();
    registerChannel = vi.fn();
    getStatus = vi.fn(() => ({
      running: false,
      channels: [],
      activeSessions: 0,
      pendingPairings: 0,
    }));
  }

  return {
    gatewayStart,
    gatewayStop,
    MockGateway,
  };
});

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../src/main/remote/gateway', () => ({
  RemoteGateway: mocks.MockGateway,
}));

vi.mock('../src/main/remote/remote-config-store', () => ({
  remoteConfigStore: {
    getAll: vi.fn(() => ({
      gateway: {
        enabled: true,
        port: 18789,
        bind: '127.0.0.1',
        autoApproveSafeTools: false,
        defaultWorkingDirectory: '',
      },
      channels: {
        feishu: {},
      },
    })),
    getPairedUsers: vi.fn(() => []),
  },
}));

vi.mock('../src/main/remote/tunnel-manager', () => ({
  tunnelManager: {
    start: vi.fn(),
    stop: vi.fn(),
    getStatus: vi.fn(() => ({ connected: false })),
    getWebhookUrl: vi.fn(() => null),
  },
  TunnelStatus: {},
}));

vi.mock('../src/main/remote/channels/feishu', () => ({
  FeishuChannel: vi.fn(),
}));

vi.mock('../src/main/remote/message-router', () => ({
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

describe('RemoteManager port conflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips startup cleanly when the remote gateway port is already in use', async () => {
    const { RemoteManager } = await import('../src/main/remote/remote-manager');
    const manager = new RemoteManager();

    await expect(manager.start()).resolves.toBeUndefined();
    expect(mocks.gatewayStart).toHaveBeenCalledTimes(1);
    expect(mocks.gatewayStop).toHaveBeenCalledTimes(1);
    expect(manager.getStatus().running).toBe(false);
  });

  it('uses canonical identity for safe approval even when an MCP display name says Read', async () => {
    const { RemoteManager } = await import('../src/main/remote/remote-manager');
    const { remoteConfigStore } = await import('../src/main/remote/remote-config-store');
    const config = remoteConfigStore.getAll();
    vi.mocked(remoteConfigStore.getAll).mockReturnValue({
      ...config,
      gateway: { ...config.gateway, autoApproveSafeTools: true },
    });
    const manager = new RemoteManager();
    const sendResponse = vi.fn<(response: unknown) => Promise<void>>(async () => {});
    const state = manager as unknown as {
      gateway: { sendResponse: typeof sendResponse };
      sessionIdMapping: Map<string, string>;
      sessionChannelMapping: Map<string, { channelType: 'feishu'; channelId: string }>;
    };
    state.gateway = { sendResponse };
    state.sessionIdMapping.set('local', 'remote');
    state.sessionChannelMapping.set('remote', { channelType: 'feishu', channelId: 'chat' });
    try {
      await expect(
        manager.handlePermissionRequest('local', 'safe', 'label', {}, 'read')
      ).resolves.toEqual({ allow: true });
      sendResponse.mockRejectedValueOnce(new Error('Prompt delivery failed'));
      await expect(
        manager.handlePermissionRequest('local', 'unsafe', 'Read', {}, 'mcp__unknown__Read')
      ).resolves.toBeNull();
      expect(sendResponse.mock.calls[1][0]).toMatchObject({
        content: { markdown: expect.stringContaining('需要你的授权') },
      });
    } finally {
      vi.mocked(remoteConfigStore.getAll).mockReturnValue(config);
    }
  });
});
