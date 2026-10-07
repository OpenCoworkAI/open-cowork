import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../renderer/store';
import type { ClientEvent, Message, Session, TraceStep } from '../../renderer/types';
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

const persistedMessage: Message = {
  id: 'm-1',
  sessionId: 's-1',
  role: 'user',
  content: [{ type: 'text', text: 'Summarize the weekly report' }],
  timestamp: 1,
};
const persistedStep: TraceStep = {
  id: 't-1',
  type: 'thinking',
  status: 'completed',
  title: 'Task completed',
  timestamp: 1,
};

let hasFocus = false;
const showWindow = vi.fn();
const invoke = vi.fn(async (event: ClientEvent) =>
  event.type === 'session.getMessages' ? [persistedMessage] : [persistedStep]
);

beforeEach(() => {
  const storage = new Map<string, string>();
  hasFocus = false;
  FakeNotification.created = [];
  showWindow.mockReset();
  invoke.mockClear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('document', { hasFocus: () => hasFocus });
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('window', { electronAPI: { invoke, window: { show: showWindow } } });
  useAppStore.setState({
    sessions: [makeSession('s-1', 'Weekly report'), makeSession('s-2', 'Clean up downloads')],
    sessionStates: {},
    activeSessionId: 's-2',
    showSettings: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('system notifications', () => {
  it('reports a background run as ended without claiming success', () => {
    notifySessionStatus('s-1', 'running', 'running');
    notifySessionStatus('s-1', 'running', 'idle');

    expect(FakeNotification.created.map((n) => [n.title, n.options.body])).toEqual([
      ['Weekly report', 'Task ended'],
    ]);
  });

  it('recognizes a run that started before this renderer loaded', () => {
    notifySessionStatus('s-1', 'running', 'idle');

    expect(FakeNotification.created).toHaveLength(1);
  });

  it('recognizes a scheduled run that started before its session reached the store', () => {
    notifySessionStatus('scheduled', undefined, 'running');
    notifySessionStatus('scheduled', 'idle', 'idle');

    expect(FakeNotification.created.map((n) => n.title)).toEqual(['Open Cowork']);
  });

  it('ignores sessions that were not running and repeated idle updates', () => {
    notifySessionStatus('s-1', 'idle', 'idle');
    notifySessionStatus('s-1', 'running', 'running');
    notifySessionStatus('s-1', 'running', 'idle');
    notifySessionStatus('s-1', 'idle', 'idle');

    expect(FakeNotification.created).toHaveLength(1);
  });

  it('opens the session and loads its saved history on click', async () => {
    notifySessionStatus('s-1', 'running', 'idle');
    FakeNotification.created[0].onclick?.();
    await vi.waitFor(() =>
      expect(useAppStore.getState().sessionStates['s-1']?.traceSteps).toEqual([persistedStep])
    );

    const state = useAppStore.getState();
    expect(showWindow).toHaveBeenCalledTimes(1);
    expect(state.activeSessionId).toBe('s-1');
    expect(state.showSettings).toBe(false);
    expect(state.sessionStates['s-1']?.messages).toEqual([persistedMessage]);
  });

  it('still loads trace steps and logs the error when saved messages fail to load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    invoke.mockImplementationOnce(async () => {
      throw new Error('database locked');
    });

    notifySessionStatus('s-1', 'running', 'idle');
    FakeNotification.created[0].onclick?.();
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());

    expect(useAppStore.getState().sessionStates['s-1']?.traceSteps).toEqual([persistedStep]);
    expect(consoleError.mock.calls[0]?.[1]).toBe('s-1');
    consoleError.mockRestore();
  });

  it('keeps history that is already in the store', async () => {
    const streamed: Message = { ...persistedMessage, id: 'live', timestamp: 2 };
    useAppStore.getState().setMessages('s-1', [streamed]);
    useAppStore.getState().setTraceSteps('s-1', [persistedStep]);

    notifyPermissionRequest({ toolUseId: 't-1', toolName: 'bash', input: {}, sessionId: 's-1' });
    FakeNotification.created[0].onclick?.();
    await vi.waitFor(() => expect(useAppStore.getState().activeSessionId).toBe('s-1'));

    expect(invoke).not.toHaveBeenCalled();
    expect(useAppStore.getState().sessionStates['s-1']?.messages).toEqual([streamed]);
  });

  it('stays quiet while the window has focus', () => {
    hasFocus = true;
    notifySessionStatus('s-1', 'running', 'idle');
    notifyPermissionRequest({ toolUseId: 't-1', toolName: 'bash', input: {}, sessionId: 's-1' });

    expect(FakeNotification.created).toHaveLength(0);
  });

  it('stays quiet when the user turns notifications off', () => {
    expect(areSystemNotificationsEnabled()).toBe(true);
    setSystemNotificationsEnabled(false);
    expect(areSystemNotificationsEnabled()).toBe(false);

    notifySessionStatus('s-1', 'running', 'idle');
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
});
