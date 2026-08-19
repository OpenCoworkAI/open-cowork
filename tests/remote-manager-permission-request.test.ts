import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sendResponse = vi.fn(async () => {});
  const gatewayStart = vi.fn(async () => {});
  const gatewayStop = vi.fn(async () => {});
  const deferPermissionTimeout = vi.fn(() => true);

  class MockGateway {
    public running = false;
    start = gatewayStart;
    stop = gatewayStop;
    sendResponse = sendResponse;
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

  // Mutable config so individual tests can flip autoApproveSafeTools.
  const configState: {
    gateway: {
      enabled: boolean;
      port: number;
      bind: string;
      autoApproveSafeTools: boolean;
      defaultWorkingDirectory: string;
    };
    channels: Record<string, unknown>;
  } = {
    gateway: {
      enabled: true,
      port: 18789,
      bind: '127.0.0.1',
      autoApproveSafeTools: false,
      defaultWorkingDirectory: '',
    },
    channels: { feishu: {} },
  };

  return {
    sendResponse,
    gatewayStart,
    gatewayStop,
    deferPermissionTimeout,
    MockGateway,
    configState,
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
    getAll: vi.fn(() => mocks.configState),
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

type ManagerInternals = {
  sessionIdMapping: Map<string, string>;
  sessionChannelMapping: Map<string, { channelType: string; channelId: string }>;
  sessionOwnerMapping: Map<string, string>;
  pendingInteractions: Map<string, unknown>;
  interactionResolvers: Map<string, (response: string) => void>;
};

// Remote session: actual session 'actual-1' <-> remote 'remote-1' in Slack channel C123 (thread 1700.123).
const REMOTE_SESSION_ID = 'remote-1';
const THREAD_CHANNEL_ID = 'C123:1700.123';
const OWNER_ID = 'U-OWNER';

async function createRemoteManager() {
  const { RemoteManager } = await import('../src/main/remote/remote-manager');
  const manager = new RemoteManager();
  manager.setAgentExecutor({
    startSession: vi.fn(async () => ({
      id: 's',
      title: 't',
      created_at: 0,
      updated_at: 0,
      status: 'idle',
      cwd: '/tmp',
    })),
    continueSession: vi.fn(async () => {}),
    stopSession: vi.fn(async () => {}),
    validateWorkingDirectory: vi.fn(() => null),
    deferPermissionTimeout: mocks.deferPermissionTimeout,
  });
  await manager.start();

  const internals = manager as unknown as ManagerInternals;
  internals.sessionIdMapping.set('actual-1', REMOTE_SESSION_ID);
  internals.sessionChannelMapping.set(REMOTE_SESSION_ID, {
    channelType: 'slack',
    channelId: THREAD_CHANNEL_ID,
  });
  internals.sessionOwnerMapping.set(REMOTE_SESSION_ID, OWNER_ID);

  return { manager, internals };
}

// Start a permission request and wait until it is registered as pending.
// Returns the permission promise inside an object: returning it directly would
// make the async helper adopt (and wait for) the pending permission promise.
async function startPermissionRequest(
  manager: Awaited<ReturnType<typeof createRemoteManager>>['manager']
) {
  const promise = manager.handlePermissionRequest('actual-1', 'tool-1', 'bash', {
    command: 'ls',
  });
  await vi.waitFor(() => {
    const internals = manager as unknown as ManagerInternals;
    expect(internals.pendingInteractions.size).toBe(1);
  });
  return { promise };
}

describe('RemoteManager permission request flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-assert default implementations (clearAllMocks keeps stale once-queues).
    mocks.sendResponse.mockImplementation(async () => {});
    mocks.deferPermissionTimeout.mockImplementation(() => true);
    mocks.configState.gateway.autoApproveSafeTools = false;
  });

  it('resolves allow for "yes" reply and defers the session timer to 5 minutes', async () => {
    const { manager, internals } = await createRemoteManager();
    const { promise } = await startPermissionRequest(manager);
    const consumed = await manager.handlePotentialInteractionResponse(
      'slack',
      THREAD_CHANNEL_ID,
      OWNER_ID,
      'yes'
    );
    expect(consumed).toBe(true);
    await expect(promise).resolves.toEqual({ allow: true });
    expect(internals.pendingInteractions.size).toBe(0);
    expect(internals.interactionResolvers.size).toBe(0);
    expect(mocks.deferPermissionTimeout).toHaveBeenCalledWith('tool-1', 300000);
  });

  it('resolves allow + remember for "always" reply', async () => {
    const { manager } = await createRemoteManager();
    const { promise } = await startPermissionRequest(manager);

    await manager.handlePotentialInteractionResponse(
      'slack',
      THREAD_CHANNEL_ID,
      OWNER_ID,
      'always'
    );
    await expect(promise).resolves.toEqual({ allow: true, remember: true });
  });

  it('resolves deny for unrecognized text', async () => {
    const { manager } = await createRemoteManager();
    const { promise } = await startPermissionRequest(manager);

    await manager.handlePotentialInteractionResponse(
      'slack',
      THREAD_CHANNEL_ID,
      OWNER_ID,
      'please go ahead and run it'
    );
    await expect(promise).resolves.toEqual({ allow: false });
  });

  it('accepts Chinese replies (是 / 允许) for parity', async () => {
    const { manager } = await createRemoteManager();
    const { promise } = await startPermissionRequest(manager);

    await manager.handlePotentialInteractionResponse('slack', THREAD_CHANNEL_ID, OWNER_ID, '允许');
    await expect(promise).resolves.toEqual({ allow: true });
  });

  it('ignores a reply from a non-owner sender', async () => {
    const { manager, internals } = await createRemoteManager();
    const { promise } = await startPermissionRequest(manager);

    const consumed = await manager.handlePotentialInteractionResponse(
      'slack',
      THREAD_CHANNEL_ID,
      'U-OTHER',
      'yes'
    );
    expect(consumed).toBe(false);
    // Still pending; owner can still answer.
    expect(internals.pendingInteractions.size).toBe(1);

    await manager.handlePotentialInteractionResponse('slack', THREAD_CHANNEL_ID, OWNER_ID, 'no');
    await expect(promise).resolves.toEqual({ allow: false });
  });

  it('matches a reply posted in the main channel against a threaded prompt', async () => {
    const { manager } = await createRemoteManager();
    const { promise } = await startPermissionRequest(manager);

    const consumed = await manager.handlePotentialInteractionResponse(
      'slack',
      'C123', // main channel, no thread suffix
      OWNER_ID,
      'approve'
    );
    expect(consumed).toBe(true);
    await expect(promise).resolves.toEqual({ allow: true });
  });

  it('matches a reply with a different thread ts via normalized channel id', async () => {
    const { manager } = await createRemoteManager();
    const { promise } = await startPermissionRequest(manager);

    const consumed = await manager.handlePotentialInteractionResponse(
      'slack',
      'C123:999.999',
      OWNER_ID,
      'ok'
    );
    expect(consumed).toBe(true);
    await expect(promise).resolves.toEqual({ allow: true });
  });

  it('returns null and cleans up when sending to the channel fails', async () => {
    mocks.sendResponse.mockRejectedValueOnce(new Error('slack api down'));
    const { manager, internals } = await createRemoteManager();

    const result = await manager.handlePermissionRequest('actual-1', 'tool-2', 'bash', {
      command: 'ls',
    });
    expect(result).toBeNull();
    expect(internals.pendingInteractions.size).toBe(0);
    expect(internals.interactionResolvers.size).toBe(0);
    // The prompt never reached the user, so no deferral happened.
    expect(mocks.deferPermissionTimeout).not.toHaveBeenCalled();
  });

  it('returns null when the session is not remote', async () => {
    const { manager } = await createRemoteManager();

    const result = await manager.handlePermissionRequest('unknown-session', 'tool-3', 'bash', {});
    expect(result).toBeNull();
    expect(mocks.sendResponse).not.toHaveBeenCalled();
  });

  it('returns allow:false and cleans up when deferPermissionTimeout reports the session timer already fired', async () => {
    mocks.deferPermissionTimeout.mockReturnValueOnce(false);
    const { manager, internals } = await createRemoteManager();

    const result = await manager.handlePermissionRequest('actual-1', 'tool-4', 'bash', {
      command: 'ls',
    });
    expect(result).toEqual({ allow: false });
    expect(internals.pendingInteractions.size).toBe(0);
    expect(internals.interactionResolvers.size).toBe(0);
    // The prompt was still sent to the channel.
    expect(mocks.sendResponse).toHaveBeenCalled();
  });

  it('auto-approves safe tools (Read) without a pending interaction', async () => {
    mocks.configState.gateway.autoApproveSafeTools = true;
    const { manager, internals } = await createRemoteManager();

    const result = await manager.handlePermissionRequest('actual-1', 'tool-5', 'Read', {
      file_path: '/tmp/x',
    });
    expect(result).toEqual({ allow: true });
    expect(internals.pendingInteractions.size).toBe(0);
  });

  it('keeps bash interactive even with autoApproveSafeTools enabled', async () => {
    mocks.configState.gateway.autoApproveSafeTools = true;
    const { manager } = await createRemoteManager();
    const { promise } = await startPermissionRequest(manager);

    await manager.handlePotentialInteractionResponse('slack', THREAD_CHANNEL_ID, OWNER_ID, 'no');
    await expect(promise).resolves.toEqual({ allow: false });
  });

  it('clearSessionBuffer settles a pending permission as deny', async () => {
    const { manager, internals } = await createRemoteManager();
    const { promise } = await startPermissionRequest(manager);

    await manager.clearSessionBuffer('actual-1');
    await expect(promise).resolves.toEqual({ allow: false });
    expect(internals.pendingInteractions.size).toBe(0);
    expect(internals.interactionResolvers.size).toBe(0);
  });
});
