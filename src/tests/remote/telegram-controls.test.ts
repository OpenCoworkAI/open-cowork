import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteMessage, RemoteResponse } from '../../main/remote/types';
import type { Session } from '../../renderer/types';
const state = vi.hoisted(() => ({
  notifications: { completion: true, failure: true, toolProgress: false },
}));
vi.mock('../../main/utils/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));
vi.mock('../../main/remote/remote-config-store', () => ({
  remoteConfigStore: {
    getAll: () => ({
      gateway: { enabled: false, autoApproveSafeTools: false },
      channels: { telegram: { notifications: state.notifications } },
    }),
    getPairedUsers: () => [],
  },
}));
import { RemoteManager } from '../../main/remote/remote-manager';
import { RemoteGateway } from '../../main/remote/gateway';
import { MessageRouter } from '../../main/remote/message-router';

afterEach(() => {
  vi.useRealTimers();
  state.notifications = { completion: true, failure: true, toolProgress: false };
});

function msg(text: string, user = '42'): RemoteMessage {
  return {
    id: 'message',
    channelType: 'telegram',
    channelId: user,
    sender: { id: user, isBot: false },
    content: { type: 'text', text },
    timestamp: Date.now(),
    isGroup: false,
    isMentioned: false,
  };
}
function setup() {
  const manager = new RemoteManager();
  let count = 0;
  const start = vi.fn(
    async (title: string, _prompt: string, cwd?: string): Promise<Session> => ({
      id: `session-${++count}`,
      title,
      cwd,
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
    })
  );
  const continued = vi.fn(
    async (_sessionId: string, _prompt: string, _content?: unknown[], _cwd?: string) => {}
  );
  const stopped = vi.fn(async () => {});
  manager.setAgentExecutor({
    startSession: start,
    continueSession: continued,
    stopSession: stopped,
  });
  const send = vi.fn(async (_response: RemoteResponse) => {});
  (manager as unknown as { gateway: { sendResponse: typeof send } }).gateway = {
    sendResponse: send,
  };
  return { manager, start, continued, stopped, send };
}

describe('Telegram conversation controls', () => {
  it('creates, lists, switches and stops only the sender’s conversations', async () => {
    const { manager, start, continued, stopped, send } = setup();
    await manager.routeMessage(msg('first'));
    await manager.handleTelegramControlMessage(msg('/new'));
    await manager.routeMessage(msg('second'));
    expect(start).toHaveBeenCalledTimes(2);
    await manager.handleTelegramControlMessage(msg('/sessions'));
    expect(send.mock.calls.at(-1)?.[0].content.markdown).toContain('session-1');
    expect(send.mock.calls.at(-1)?.[0].content.markdown).toContain('* session-2');
    await manager.handleTelegramControlMessage(msg('/switch session-1'));
    await manager.routeMessage(msg('continue first'));
    expect(continued.mock.calls.at(-1)?.[0]).toBe('session-1');
    await manager.handleTelegramControlMessage(msg('/stop'));
    expect(stopped).toHaveBeenCalledWith('session-1');
    await manager.handleTelegramControlMessage(msg('/switch session-1', '43'));
    await manager.routeMessage(msg('stranger task', '43'));
    expect(start).toHaveBeenCalledTimes(3);
    expect(continued).toHaveBeenCalledTimes(1);
    await manager.handleTelegramControlMessage(msg('/sessions', '43'));
    expect(send.mock.calls.at(-1)?.[0].content.markdown).not.toContain('session-1');
  });

  it('retains the selected conversation working directory across switches', async () => {
    const { manager, continued } = setup();
    manager.setDefaultWorkingDirectory('/default');
    await manager.routeMessage(msg('[cwd:/first] first'));
    await manager.handleTelegramControlMessage(msg('/new'));
    await manager.routeMessage(msg('[cwd:/second] second'));
    await manager.handleTelegramControlMessage(msg('/switch session-1'));
    await manager.routeMessage(msg('continue'));
    expect(continued).toHaveBeenCalledWith('session-1', 'continue', expect.any(Array), '/first');
  });

  it('leaves other channel command strings untouched', async () => {
    const { manager, stopped } = setup();
    expect(
      await manager.handleTelegramControlMessage({ ...msg('/stop'), channelType: 'feishu' })
    ).toBe(false);
    expect(stopped).not.toHaveBeenCalled();
  });

  it('honors per-event notification preferences and suppresses duplicate completion events', async () => {
    const { manager, send } = setup();
    await manager.routeMessage(msg('first'));
    await manager.sendTelegramSessionStatus('session-1', 'idle');
    await manager.sendTelegramSessionStatus('session-1', 'idle');
    expect(
      send.mock.calls.filter(([response]) => response.content.markdown?.includes('Task completed'))
    ).toHaveLength(1);
    await manager.routeMessage(msg('again'));
    state.notifications.failure = false;
    await manager.sendTelegramSessionStatus('session-1', 'error');
    expect(
      send.mock.calls.some(([response]) => response.content.markdown?.includes('Task failed'))
    ).toBe(false);
    await manager.sendToolProgress('session-1', 'bash', 'running');
    const count = send.mock.calls.length;
    state.notifications.toolProgress = true;
    await manager.sendToolProgress('session-1', 'bash', 'running');
    expect(send.mock.calls).toHaveLength(count + 1);
  });
});

describe('Telegram inline permission callbacks', () => {
  it('binds each callback to its owner and chat and consumes it only once', async () => {
    vi.useFakeTimers();
    const { manager, send } = setup();
    await manager.routeMessage(msg('task'));
    const permission = manager.handlePermissionRequest('session-1', 'tool-id', 'bash', {});
    await vi.waitFor(() =>
      expect(send.mock.calls.some(([response]) => response.content.card)).toBe(true)
    );
    const card = send.mock.calls.find(([response]) => response.content.card)![0].content.card as {
      inline_keyboard: Array<Array<{ callback_data: string }>>;
    };
    const token = card.inline_keyboard[0][0].callback_data.split(':')[1];
    expect(token).toHaveLength(24);
    const callback = {
      ...msg(''),
      content: {
        type: 'interactive' as const,
        interactive: { kind: 'telegram_permission', token, answer: 'y' },
      },
    };
    await manager.handleTelegramControlMessage({ ...callback, sender: { id: '43', isBot: false } });
    await manager.handleTelegramControlMessage({ ...callback, channelId: '43' });
    await manager.handleTelegramControlMessage(callback);
    await expect(permission).resolves.toEqual({ allow: true });
    await manager.handleTelegramControlMessage(callback);
    expect(send.mock.calls.at(-1)?.[0].content.markdown).toContain('expired');
  });

  it('does not accept an expired callback', async () => {
    vi.useFakeTimers();
    const { manager, send } = setup();
    await manager.routeMessage(msg('task'));
    const permission = manager.handlePermissionRequest('session-1', 'tool-id', 'bash', {});
    await vi.waitFor(() =>
      expect(send.mock.calls.some(([response]) => response.content.card)).toBe(true)
    );
    const card = send.mock.calls.find(([response]) => response.content.card)![0].content.card as {
      inline_keyboard: Array<Array<{ callback_data: string }>>;
    };
    const token = card.inline_keyboard[0][0].callback_data.split(':')[1];
    await vi.advanceTimersByTimeAsync(61_000);
    await manager.handleTelegramControlMessage({
      ...msg(''),
      content: {
        type: 'interactive',
        interactive: { kind: 'telegram_permission', token, answer: 'always' },
      },
    });
    expect(send.mock.calls.at(-1)?.[0].content.markdown).toContain('expired');
    await manager.handleTelegramControlMessage(msg('/stop'));
    await expect(permission).resolves.toEqual({ allow: false });
  });

  it.each(['y', 'always'])(
    'denies at the deadline and rejects a late raw %s reply',
    async (answer) => {
      vi.useFakeTimers();
      const { manager, send } = setup();
      await manager.routeMessage(msg('task'));
      const permission = manager.handlePermissionRequest('session-1', 'tool-id', 'bash', {});
      await vi.waitFor(() =>
        expect(send.mock.calls.some(([response]) => response.content.card)).toBe(true)
      );
      await vi.advanceTimersByTimeAsync(61_000);
      await expect(permission).resolves.toEqual({ allow: false });
      expect(await manager.handlePotentialInteractionResponse('telegram', '42', '42', answer)).toBe(
        false
      );
    }
  );

  it.each(['y', 'always'])(
    'denies overdue %s before a delayed timer callback can run',
    async (answer) => {
      vi.useFakeTimers();
      const { manager, send } = setup();
      await manager.routeMessage(msg('task'));
      const permission = manager.handlePermissionRequest('session-1', 'tool-id', 'bash', {});
      await vi.waitFor(() =>
        expect(send.mock.calls.some(([response]) => response.content.card)).toBe(true)
      );
      // Advance wall time without executing timers: the reply path must enforce
      // its own deadline when the event loop has not delivered the timeout yet.
      vi.setSystemTime(Date.now() + 61_000);
      expect(await manager.handlePotentialInteractionResponse('telegram', '42', '42', answer)).toBe(
        true
      );
      await expect(permission).resolves.toEqual({ allow: false });
    }
  );

  it('runs interactive controls only after gateway authorization', async () => {
    const router = new MessageRouter();
    const gateway = new RemoteGateway(
      {
        enabled: true,
        port: 0,
        bind: '127.0.0.1',
        auth: { mode: 'allowlist', allowlist: ['telegram:42'] },
      },
      router
    );
    const intercepted = vi.fn(async () => true);
    gateway.setMessageInterceptor(intercepted);
    const handle = (
      gateway as unknown as { handleChannelMessage(message: RemoteMessage): Promise<void> }
    ).handleChannelMessage.bind(gateway);
    const control = {
      ...msg(''),
      content: { type: 'interactive' as const, interactive: { kind: 'telegram_permission' } },
    };
    await handle({ ...control, sender: { id: '43', isBot: false } });
    expect(intercepted).not.toHaveBeenCalled();
    await handle(control);
    expect(intercepted).toHaveBeenCalledOnce();
    router.stopPeriodicCleanup();
  });
});
