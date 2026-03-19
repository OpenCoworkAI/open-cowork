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
});
