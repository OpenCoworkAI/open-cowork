import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/main/remote/remote-config-store', () => ({
  remoteConfigStore: {
    getAll: () => ({ gateway: { enabled: false }, channels: {} }),
    isEnabled: () => false,
    getPairedUsers: () => [],
  },
}));

import { RemoteManager } from '../src/main/remote/remote-manager';
import type { RemoteMessage } from '../src/main/remote/types';
import type { ServerEvent } from '../src/renderer/types';

const buildMessage = (): RemoteMessage => ({
  id: 'msg-1',
  channelType: 'feishu',
  channelId: 'channel-1',
  sender: { id: 'user-1', isBot: false },
  content: { type: 'text', text: 'list the files' },
  timestamp: Date.now(),
  isGroup: false,
  isMentioned: false,
});

describe('remote user message ui', () => {
  it('emits stream.message for remote user input', async () => {
    const manager = new RemoteManager();
    const events: ServerEvent[] = [];

    manager.setRendererCallback((event) => {
      events.push(event);
    });

    manager.setAgentExecutor({
      startSession: async () => ({ id: 'session-1' } as any),
      continueSession: async () => {},
      stopSession: async () => {},
    });

    const router = (manager as any).messageRouter;
    await router.routeMessage(buildMessage());

    const hasUserStream = events.some((event) =>
      event.type === 'stream.message'
      && event.payload?.sessionId === 'session-1'
      && event.payload?.message?.role === 'user'
    );

    expect(hasUserStream).toBe(true);
  });
});
