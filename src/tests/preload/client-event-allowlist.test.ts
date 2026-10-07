import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ClientEvent } from '../../renderer/types';

const { exposed, send } = vi.hoisted(() => ({
  exposed: {} as Record<string, unknown>,
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown) => {
      exposed[key] = api;
    },
  },
  ipcRenderer: {
    send,
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

beforeAll(async () => {
  await import('../../preload');
});

describe('preload client events', () => {
  it('forwards session.rename to the main process', () => {
    const api = exposed['electronAPI'] as { send: (event: ClientEvent) => void };
    const event: ClientEvent = {
      type: 'session.rename',
      payload: { sessionId: 's-1', title: 'Quarterly plan' },
    };

    api.send(event);

    expect(send).toHaveBeenCalledWith('client-event', event);
  });
});
