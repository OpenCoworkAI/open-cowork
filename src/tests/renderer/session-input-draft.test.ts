import { createElement, type ReactElement } from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSessionInputDraft } from '../../renderer/hooks/useSessionInputDraft';
import { useAppStore } from '../../renderer/store';
import type { MountedPath, Session } from '../../renderer/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type DraftApi = {
  prompt: string;
  setPrompt: (value: string) => void;
};

function makeSession(id: string): Session {
  return {
    id,
    title: `Session ${id}`,
    status: 'idle',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cwd: '/tmp',
    mountedPaths: [] as MountedPath[],
    allowedTools: [],
    memoryEnabled: false,
  };
}

function DraftProbe({ sessionId, api }: { sessionId: string | null; api: DraftApi }) {
  const [prompt, setPrompt] = useSessionInputDraft(sessionId);
  api.prompt = prompt;
  api.setPrompt = setPrompt;
  return createElement('output', null, prompt);
}

function ActiveSessionDraft({ api }: { api: DraftApi }) {
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const showSettings = useAppStore((state) => state.showSettings);
  if (showSettings || !activeSessionId) return null;
  return createElement(DraftProbe, { sessionId: activeSessionId, api });
}

describe('useSessionInputDraft', () => {
  const mounts: Array<{ unmount: () => void }> = [];

  function render(ui: ReactElement) {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(ui);
    });
    let unmounted = false;
    const handle = {
      renderer,
      unmount() {
        if (unmounted) return;
        unmounted = true;
        act(() => {
          renderer.unmount();
        });
      },
    };
    mounts.push(handle);
    return handle;
  }

  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.getState().addSession(makeSession('a'));
    useAppStore.getState().addSession(makeSession('b'));
    useAppStore.getState().setActiveSession('a');
  });

  afterEach(() => {
    for (const mount of mounts) mount.unmount();
    mounts.length = 0;
  });

  it('restores the unsent draft when switching away and back', () => {
    const api: DraftApi = { prompt: '', setPrompt: () => undefined };
    render(createElement(ActiveSessionDraft, { api }));

    act(() => api.setPrompt('hello'));
    expect(api.prompt).toBe('hello');
    expect(useAppStore.getState().sessionInputDrafts).toEqual({ a: 'hello' });

    act(() => useAppStore.getState().setActiveSession('b'));
    expect(api.prompt).toBe('');

    act(() => api.setPrompt('from b'));
    act(() => useAppStore.getState().setActiveSession('a'));

    expect(api.prompt).toBe('hello');
    expect(useAppStore.getState().sessionInputDrafts).toEqual({ a: 'hello', b: 'from b' });
  });

  it('keeps the draft when the composer unmounts and the session still exists', () => {
    const api: DraftApi = { prompt: '', setPrompt: () => undefined };
    const view = render(createElement(ActiveSessionDraft, { api }));

    act(() => api.setPrompt('draft for later'));
    act(() => useAppStore.getState().setShowSettings(true));

    expect(useAppStore.getState().sessionInputDrafts.a).toBe('draft for later');
    view.unmount();

    const restored: DraftApi = { prompt: '', setPrompt: () => undefined };
    act(() => useAppStore.getState().setShowSettings(false));
    render(createElement(ActiveSessionDraft, { api: restored }));

    expect(restored.prompt).toBe('draft for later');
  });

  it('clears a draft when the composer is emptied', () => {
    const api: DraftApi = { prompt: '', setPrompt: () => undefined };
    render(createElement(ActiveSessionDraft, { api }));

    act(() => api.setPrompt('temporary'));
    act(() => api.setPrompt(''));

    expect(api.prompt).toBe('');
    expect(useAppStore.getState().sessionInputDrafts.a).toBeUndefined();
  });

  it('does not restore a draft when switching away from a deleted session', () => {
    const api: DraftApi = { prompt: '', setPrompt: () => undefined };
    const view = render(createElement(DraftProbe, { sessionId: 'a', api }));

    act(() => api.setPrompt('orphan'));
    act(() => useAppStore.getState().removeSession('a'));
    act(() => {
      view.renderer.update(createElement(DraftProbe, { sessionId: 'b', api }));
    });

    expect(api.prompt).toBe('');
    expect(useAppStore.getState().sessionInputDrafts.a).toBeUndefined();
  });

  it('does not write the draft back after the active session is deleted', () => {
    const api: DraftApi = { prompt: '', setPrompt: () => undefined };
    const view = render(createElement(ActiveSessionDraft, { api }));

    act(() => api.setPrompt('should not survive'));
    act(() => useAppStore.getState().removeSession('a'));

    expect(view.renderer.root.findAllByType('output')).toHaveLength(0);
    expect(useAppStore.getState().sessionInputDrafts.a).toBeUndefined();
    expect(useAppStore.getState().activeSessionId).toBeNull();
  });

  it('does not resurrect a draft if the deleted session id is reused', () => {
    const api: DraftApi = { prompt: '', setPrompt: () => undefined };
    render(createElement(ActiveSessionDraft, { api }));

    act(() => api.setPrompt('stale'));
    act(() => useAppStore.getState().removeSession('a'));

    act(() => {
      useAppStore.getState().addSession(makeSession('a'));
      useAppStore.getState().setActiveSession('a');
    });

    expect(api.prompt).toBe('');
    expect(useAppStore.getState().sessionInputDrafts.a).toBeUndefined();
  });
});
