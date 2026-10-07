import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../renderer/store';
import type { Session } from '../../renderer/types';
import {
  areSystemNotificationsEnabled,
  notifyPermissionRequest,
  notifySessionStatus,
  notifySudoPasswordRequest,
  setSystemNotificationsEnabled,
} from '../../renderer/utils/system-notifications';

class FakeNotification {
  static created: FakeNotification[] = [];
  onclick: (() => void) | null = null;

  constructor(
    readonly title: string,
    readonly options: { body: string }
  ) {
    FakeNotification.created.push(this);
  }
}

function makeSession(id: string, title: string): Session {
  return {
    id,
    title,
    status: 'running',
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

let hasFocus = false;
const showWindow = vi.fn();

beforeEach(() => {
  const storage = new Map<string, string>();
  hasFocus = false;
  FakeNotification.created = [];
  showWindow.mockReset();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('document', { hasFocus: () => hasFocus });
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('window', { electronAPI: { window: { show: showWindow } } });
  useAppStore.setState({
    sessions: [makeSession('s-1', 'Weekly report'), makeSession('s-2', 'Clean up downloads')],
    activeSessionId: 's-2',
    showSettings: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('system notifications', () => {
  it('notifies when a running session finishes in the background and opens it on click', () => {
    notifySessionStatus('s-1', 'running');
    notifySessionStatus('s-1', 'idle');

    expect(FakeNotification.created).toHaveLength(1);
    const [notification] = FakeNotification.created;
    expect(notification.title).toBe('Weekly report');
    expect(notification.options.body).toBe('Task finished');

    notification.onclick?.();
    expect(showWindow).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().activeSessionId).toBe('s-1');
    expect(useAppStore.getState().showSettings).toBe(false);
  });

  it('reports a failed run', () => {
    notifySessionStatus('s-1', 'running');
    notifySessionStatus('s-1', 'error');

    expect(FakeNotification.created.map((n) => n.options.body)).toEqual(['Task failed']);
  });

  it('ignores idle updates for sessions that were not running', () => {
    notifySessionStatus('s-1', 'idle');
    notifySessionStatus('s-1', 'error');

    expect(FakeNotification.created).toHaveLength(0);
  });

  it('notifies once per run', () => {
    notifySessionStatus('s-1', 'running');
    notifySessionStatus('s-1', 'idle');
    notifySessionStatus('s-1', 'idle');

    expect(FakeNotification.created).toHaveLength(1);
  });

  it('stays quiet while the window has focus', () => {
    hasFocus = true;
    notifySessionStatus('s-1', 'running');
    notifySessionStatus('s-1', 'idle');
    notifyPermissionRequest({ toolUseId: 't-1', toolName: 'bash', input: {}, sessionId: 's-1' });

    expect(FakeNotification.created).toHaveLength(0);
  });

  it('stays quiet when the user turns notifications off', () => {
    expect(areSystemNotificationsEnabled()).toBe(true);
    setSystemNotificationsEnabled(false);
    expect(areSystemNotificationsEnabled()).toBe(false);

    notifySessionStatus('s-1', 'running');
    notifySessionStatus('s-1', 'idle');
    notifySudoPasswordRequest({ toolUseId: 't-2', command: 'sudo ls', sessionId: 's-1' });
    expect(FakeNotification.created).toHaveLength(0);

    setSystemNotificationsEnabled(true);
    expect(areSystemNotificationsEnabled()).toBe(true);
  });

  it('asks for approval and administrator passwords', () => {
    notifyPermissionRequest({ toolUseId: 't-1', toolName: 'bash', input: {}, sessionId: 's-2' });
    notifySudoPasswordRequest({ toolUseId: 't-2', command: 'sudo ls', sessionId: 's-2' });

    expect(FakeNotification.created.map((n) => [n.title, n.options.body])).toEqual([
      ['Clean up downloads', 'Waiting for your approval: bash'],
      ['Clean up downloads', 'Waiting for your administrator password'],
    ]);
  });

  it('falls back to the app name for an unknown session', () => {
    notifyPermissionRequest({ toolUseId: 't-1', toolName: 'bash', input: {}, sessionId: 'gone' });

    expect(FakeNotification.created[0].title).toBe('Open Cowork');
  });
});
