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

describe('remote cwd state', () => {
  it('uses !cd as the next-session working directory before a real prompt starts the session', async () => {
    const manager = new RemoteManager();
    const startCalls: Array<{ cwd?: string }> = [];

    manager.setAgentExecutor({
      startSession: async (_title, _prompt, cwd) => {
        startCalls.push({ cwd });
        return { id: 'session-1' } as any;
      },
      continueSession: async () => {},
      stopSession: async () => {},
      validateWorkingDirectory: async () => null,
    });

    const router = (manager as any).messageRouter;
    await router.routeMessage(buildMessage('!cd C:\\\\workspace'));
    await router.routeMessage(buildMessage('run tests'));

    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]?.cwd).toBe('C:\\\\workspace');
  });

  it('does not persist a failing [cwd:] override into later messages', async () => {
    const manager = new RemoteManager();
    const startCalls: Array<{ cwd?: string }> = [];
    let callCount = 0;

    manager.setDefaultWorkingDirectory('/tmp/default-workdir');
    manager.setAgentExecutor({
      startSession: async (_title, _prompt, cwd) => {
        callCount += 1;
        startCalls.push({ cwd });
        if (callCount === 1) {
          throw new Error('bad cwd');
        }
        return { id: 'session-1' } as any;
      },
      continueSession: async () => {},
      stopSession: async () => {},
      validateWorkingDirectory: async () => null,
    });

    const router = (manager as any).messageRouter;
    await router.routeMessage(buildMessage('[cwd: C:\\\\bad] first try'));
    await router.routeMessage(buildMessage('second try'));

    expect(startCalls).toEqual([
      { cwd: 'C:\\\\bad' },
      { cwd: '/tmp/default-workdir' },
    ]);
  });

  it('does not persist an invalid !cd override into the next prompt', async () => {
    const manager = new RemoteManager();
    const startCalls: Array<{ cwd?: string }> = [];

    manager.setDefaultWorkingDirectory('/tmp/default-workdir');
    manager.setAgentExecutor({
      startSession: async (_title, _prompt, cwd) => {
        startCalls.push({ cwd });
        return { id: 'session-1' } as any;
      },
      continueSession: async () => {},
      stopSession: async () => {},
      validateWorkingDirectory: async (cwd) =>
        cwd === 'C:\\\\bad' ? 'Directory does not exist' : null,
    });

    const router = (manager as any).messageRouter;
    await router.routeMessage(buildMessage('!cd C:\\\\bad'));
    await router.routeMessage(buildMessage('run tests'));

    expect(startCalls).toEqual([{ cwd: '/tmp/default-workdir' }]);
  });

  it('resolves relative remote cwd values against the current working directory', async () => {
    const manager = new RemoteManager();
    const startCalls: Array<{ cwd?: string }> = [];
    const continueCalls: Array<{ cwd?: string }> = [];

    manager.setDefaultWorkingDirectory('/tmp/base');
    manager.setAgentExecutor({
      startSession: async (_title, _prompt, cwd) => {
        startCalls.push({ cwd });
        return { id: 'session-1' } as any;
      },
      continueSession: async (_sessionId, _prompt, _content, cwd) => {
        continueCalls.push({ cwd });
      },
      stopSession: async () => {},
      validateWorkingDirectory: async () => null,
    });

    const router = (manager as any).messageRouter;
    await router.routeMessage(buildMessage('!cd project'));
    await router.routeMessage(buildMessage('[cwd: reports] summarize'));
    await router.routeMessage(buildMessage('continue'));

    expect(startCalls).toEqual([{ cwd: '/tmp/base/project/reports' }]);
    expect(continueCalls).toEqual([{ cwd: '/tmp/base/project/reports' }]);
  });

  it('resolves relative remote cwd values against a Windows working directory on non-Windows hosts', async () => {
    const manager = new RemoteManager();
    const startCalls: Array<{ cwd?: string }> = [];

    manager.setDefaultWorkingDirectory('C:\\workspace');
    manager.setAgentExecutor({
      startSession: async (_title, _prompt, cwd) => {
        startCalls.push({ cwd });
        return { id: 'session-1' } as any;
      },
      continueSession: async () => {},
      stopSession: async () => {},
      validateWorkingDirectory: async () => null,
    });

    const router = (manager as any).messageRouter;
    await router.routeMessage(buildMessage('[cwd: reports] run tests'));

    expect(startCalls).toEqual([{ cwd: 'C:\\workspace\\reports' }]);
  });

  it('rejects relative remote cwd values when there is no base working directory', async () => {
    const manager = new RemoteManager();
    const startCalls: Array<{ cwd?: string }> = [];

    manager.setAgentExecutor({
      startSession: async (_title, _prompt, cwd) => {
        startCalls.push({ cwd });
        return { id: 'session-1' } as any;
      },
      continueSession: async () => {},
      stopSession: async () => {},
      validateWorkingDirectory: async () => null,
    });

    const router = (manager as any).messageRouter;
    await router.routeMessage(buildMessage('!cd reports'));
    await router.routeMessage(buildMessage('run tests'));

    expect(startCalls).toEqual([{ cwd: undefined }]);
  });
});
