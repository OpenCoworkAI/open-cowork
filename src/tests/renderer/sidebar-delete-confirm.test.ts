import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement, type MouseEvent } from 'react';
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../../renderer/components/Sidebar';
import i18n from '../../renderer/i18n/config';
import { useAppStore } from '../../renderer/store';
import type { MountedPath, Session } from '../../renderer/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function makeSession(id: string, title: string): Session {
  const now = Date.now();
  return {
    id,
    title,
    status: 'idle',
    createdAt: now,
    updatedAt: now,
    cwd: '/tmp',
    mountedPaths: [] as MountedPath[],
    allowedTools: [],
    memoryEnabled: false,
  };
}

function nodeText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : nodeText(child)))
    .join('');
}

describe('Sidebar single-session delete confirmation', () => {
  const mounts: Array<{ unmount: () => void }> = [];
  const nativeConfirm = vi.fn(() => true);

  function renderSidebar() {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(createElement(Sidebar));
    });
    let unmounted = false;
    const handle = {
      root: renderer.root,
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

  function sessionRow(root: ReactTestInstance, title: string): ReactTestInstance {
    const row = root.findAll(
      (node) =>
        typeof node.props.className === 'string' &&
        node.props.className.includes('cursor-pointer') &&
        nodeText(node).includes(title)
    )[0];
    if (!row) throw new Error(`Session row not found: ${title}`);
    return row;
  }

  function openDeleteDialog(root: ReactTestInstance, title: string) {
    const row = sessionRow(root, title);
    act(() => {
      row.props.onMouseEnter();
    });
    const deleteButton = row.findByType('button');
    act(() => {
      deleteButton.props.onClick({ stopPropagation() {} } as MouseEvent);
    });
    const dialog = root.findAllByProps({ role: 'dialog' })[0];
    if (!dialog) throw new Error('Delete confirmation dialog did not open');
    return dialog;
  }

  function clickButton(scope: ReactTestInstance, label: string) {
    const button = scope
      .findAllByType('button')
      .find((element) => nodeText(element).trim() === label);
    if (!button) throw new Error(`Button not found: ${label}`);
    act(() => {
      button.props.onClick();
    });
  }

  beforeEach(async () => {
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.getState().addSession(makeSession('s1', 'Alpha'));
    useAppStore.getState().addSession(makeSession('s2', 'Beta'));
    useAppStore.getState().setActiveSession('s1');
    nativeConfirm.mockClear();
    vi.stubGlobal('window', {
      addEventListener() {},
      removeEventListener() {},
      confirm: nativeConfirm,
    });
    vi.stubGlobal('confirm', nativeConfirm);
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    for (const mount of mounts) mount.unmount();
    mounts.length = 0;
    vi.unstubAllGlobals();
  });

  it('asks for confirmation and keeps the conversation when cancelled', () => {
    const view = renderSidebar();
    const dialog = openDeleteDialog(view.root, 'Alpha');

    expect(nodeText(dialog)).toContain('Delete conversation "Alpha"? This cannot be undone.');
    expect(
      useAppStore
        .getState()
        .sessions.map((session) => session.id)
        .sort()
    ).toEqual(['s1', 's2']);

    clickButton(dialog, 'Cancel');

    expect(view.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
    expect(
      useAppStore
        .getState()
        .sessions.map((session) => session.id)
        .sort()
    ).toEqual(['s1', 's2']);
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it('deletes only the chosen conversation after confirmation', () => {
    const view = renderSidebar();
    const dialog = openDeleteDialog(view.root, 'Alpha');

    clickButton(dialog, 'Delete');

    expect(view.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
    expect(useAppStore.getState().sessions.map((session) => session.id)).toEqual(['s2']);
    expect(useAppStore.getState().activeSessionId).toBeNull();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it('dismisses the confirmation from the backdrop without deleting', () => {
    const view = renderSidebar();
    openDeleteDialog(view.root, 'Beta');

    const backdrop = view.root.findByProps({
      className: 'absolute inset-0 z-20 flex items-end bg-black/20',
    });
    act(() => {
      backdrop.props.onClick();
    });

    expect(view.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
    expect(
      useAppStore
        .getState()
        .sessions.map((session) => session.id)
        .sort()
    ).toEqual(['s1', 's2']);
  });

  it('defines delete confirmation copy in both locales', () => {
    const en = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'src/renderer/i18n/locales/en.json'), 'utf8')
    ) as { sidebar: { deleteConfirm: string } };
    const zh = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'src/renderer/i18n/locales/zh.json'), 'utf8')
    ) as { sidebar: { deleteConfirm: string } };

    expect(en.sidebar.deleteConfirm).toContain('{{title}}');
    expect(zh.sidebar.deleteConfirm).toContain('{{title}}');
  });
});
