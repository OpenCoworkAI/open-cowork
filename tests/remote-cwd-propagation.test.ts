import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/remote/remote-config-store', () => ({
  remoteConfigStore: {
    getAll: () => ({ gateway: { enabled: false }, channels: {} }),
    isEnabled: () => false,
    getPairedUsers: () => [],
  },
}));

import { RemoteManager } from '../src/main/remote/remote-manager';
import type { RemoteMessage } from '../src/main/remote/types';

function buildMessage(text: string): RemoteMessage {
  return {
    id: `msg-${Math.random()}`,
    channelType: 'feishu',
    channelId: 'channel-1',
    sender: { id: 'user-1', isBot: false },
    content: { type: 'text', text },
    timestamp: Date.now(),
    isGroup: false,
    isMentioned: false,
  };
}

describe('remote cwd propagation', () => {
  it('passes updated cwd to continueSession for existing remote sessions', async () => {
    const manager = new RemoteManager();
    const continueCalls: Array<{ sessionId: string; prompt: string; cwd?: string }> = [];

    manager.setAgentExecutor({
      startSession: async () => ({ id: 'session-1' } as any),
      continueSession: async (sessionId, prompt, _content, cwd) => {
        continueCalls.push({ sessionId, prompt, cwd });
      },
      stopSession: async () => {},
    });

    const router = (manager as any).messageRouter;
    await router.routeMessage(buildMessage('hello'));
    await router.routeMessage(buildMessage('[cwd: C:\\\\workspace] run tests'));

    expect(continueCalls).toHaveLength(1);
    expect(continueCalls[0]).toEqual({
      sessionId: 'session-1',
      prompt: 'run tests',
      cwd: 'C:\\\\workspace',
    });
  });
});
