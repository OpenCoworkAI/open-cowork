import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../renderer/store';
import type { Session } from '../../renderer/types';

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState());
});

function makeSession(id: string, updatedAt: number): Session {
  return {
    id,
    title: `Session ${id}`,
    status: 'idle',
    createdAt: updatedAt,
    updatedAt,
    cwd: '/tmp',
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
  };
}

describe('store.updateSession updatedAt', () => {
  it('applies the authoritative updatedAt so an older session re-sorts to the top', () => {
    useAppStore.getState().addSession(makeSession('old', 1000));
    useAppStore.getState().addSession(makeSession('new', 2000));

    useAppStore.getState().updateSession('old', { status: 'running', updatedAt: 5000 });

    const sessions = [...useAppStore.getState().sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    expect(sessions[0].id).toBe('old');
    expect(sessions.find((s) => s.id === 'old')?.updatedAt).toBe(5000);
  });

  it('does not fabricate updatedAt when the update omits it', () => {
    useAppStore.getState().addSession(makeSession('s1', 1000));

    useAppStore.getState().updateSession('s1', { status: 'running' });

    expect(useAppStore.getState().sessions[0].updatedAt).toBe(1000);
  });
});
