import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSessionExport, getSessionExportMessages } from '../../renderer/utils/session-export';
import type { Message, Session } from '../../renderer/types';
import { useAppStore } from '../../renderer/store';
import { SessionList } from '../../renderer/components/SessionList';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const session: Session = {
  id: 'session-1',
  title: 'Conversation',
  status: 'idle',
  mountedPaths: [],
  allowedTools: [],
  memoryEnabled: false,
  createdAt: 100,
  updatedAt: 200,
};

const savedMessage: Message = {
  id: 'saved-1',
  sessionId: session.id,
  role: 'user',
  content: [{ type: 'text', text: 'First message' }],
  timestamp: 150,
};

describe('getSessionExportMessages', () => {
  beforeEach(() => {
    useAppStore.setState({ sessions: [session], sessionStates: {} });
  });

  it('reads the complete persisted conversation when the session is idle', async () => {
    useAppStore.getState().setMessages(session.id, []);
    const getPersisted = vi.fn().mockResolvedValue([savedMessage]);

    expect(await getSessionExportMessages(session.id, true, getPersisted)).toEqual([savedMessage]);
    expect(getPersisted).toHaveBeenCalledWith(session.id);
  });

  it('does not export a running session or a pending optimistic turn', async () => {
    const getPersisted = vi.fn().mockResolvedValue([savedMessage]);
    useAppStore.getState().updateSession(session.id, { status: 'running' });
    expect(await getSessionExportMessages(session.id, true, getPersisted)).toBeNull();

    useAppStore.getState().updateSession(session.id, { status: 'idle' });
    useAppStore.getState().addMessage(session.id, {
      ...savedMessage,
      id: 'optimistic-2',
      localStatus: 'queued',
    });
    expect(await getSessionExportMessages(session.id, true, getPersisted)).toBeNull();
    expect(getPersisted).not.toHaveBeenCalled();
  });

  it('discards a snapshot when an optimistic message arrives during IPC', async () => {
    let resolveRead!: (messages: Message[]) => void;
    const getPersisted = vi.fn().mockImplementation(
      () =>
        new Promise<Message[]>((resolve) => {
          resolveRead = resolve;
        })
    );
    const exportAttempt = getSessionExportMessages(session.id, true, getPersisted);
    useAppStore.getState().addMessage(session.id, {
      ...savedMessage,
      id: 'optimistic-2',
      localStatus: 'queued',
    });
    useAppStore.getState().clearPendingTurns(session.id);
    useAppStore.getState().clearQueuedMessages(session.id);
    resolveRead([savedMessage]);

    expect(await exportAttempt).toBeNull();
  });

  it('discards a snapshot when the session runs during IPC without a local message', async () => {
    let resolveRead!: (messages: Message[]) => void;
    const getPersisted = vi.fn().mockImplementation(
      () =>
        new Promise<Message[]>((resolve) => {
          resolveRead = resolve;
        })
    );
    const exportAttempt = getSessionExportMessages(session.id, true, getPersisted);
    useAppStore.getState().updateSession(session.id, { status: 'running' });
    useAppStore.getState().updateSession(session.id, { status: 'idle' });
    resolveRead([savedMessage]);

    expect(await exportAttempt).toBeNull();
  });

  it('uses live messages in browser preview without reading persistence', async () => {
    useAppStore.getState().setMessages(session.id, [savedMessage]);
    useAppStore.getState().updateSession(session.id, { status: 'running' });
    const getPersisted = vi.fn();

    expect(await getSessionExportMessages(session.id, false, getPersisted)).toEqual([savedMessage]);
    expect(getPersisted).not.toHaveBeenCalled();
  });
});

describe('SessionList export action', () => {
  it('disables desktop export while a session runs, but keeps browser preview export available', () => {
    const props = {
      sessions: [{ ...session, status: 'running' as const }],
      activeSessionId: session.id,
      selectedIds: new Set<string>(),
      isSelectMode: false,
      exportingSessionId: null,
      onSessionClick: vi.fn(),
      onExport: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
    };

    const desktop = renderToStaticMarkup(
      createElement(SessionList, { ...props, isElectron: true })
    );
    const browser = renderToStaticMarkup(
      createElement(SessionList, { ...props, isElectron: false })
    );

    expect(desktop).toContain('disabled=""');
    expect(desktop).toContain('title="sidebar.exportPending"');
    expect(desktop).toContain('aria-label="sidebar.exportPending"');
    expect(browser).not.toContain('disabled=""');
    expect(browser).toContain('aria-label="sidebar.exportSession"');
  });

  it('disables other export actions until the current export finishes', () => {
    const markup = renderToStaticMarkup(
      createElement(SessionList, {
        sessions: [session, { ...session, id: 'session-2' }],
        activeSessionId: session.id,
        selectedIds: new Set<string>(),
        isSelectMode: false,
        exportingSessionId: session.id,
        isElectron: true,
        onSessionClick: vi.fn(),
        onExport: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
      })
    );

    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it('offers a rename action for each conversation outside select mode', () => {
    const props = {
      sessions: [session, { ...session, id: 'session-2' }],
      activeSessionId: session.id,
      selectedIds: new Set<string>(),
      exportingSessionId: null,
      isElectron: true,
      onSessionClick: vi.fn(),
      onExport: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
    };

    const markup = renderToStaticMarkup(
      createElement(SessionList, { ...props, isSelectMode: false })
    );
    const selecting = renderToStaticMarkup(
      createElement(SessionList, { ...props, isSelectMode: true })
    );

    expect(markup.match(/aria-label="sidebar.renameSession"/g)).toHaveLength(2);
    expect(selecting).not.toContain('sidebar.renameSession');
  });
});

describe('createSessionExport', () => {
  it('keeps the selected conversation and its structured attachments in JSON', async () => {
    const session: Session = {
      id: 'session-1',
      title: '课件讨论',
      status: 'completed',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      createdAt: 100,
      updatedAt: 200,
    };
    const messages: Message[] = [
      {
        id: 'message-1',
        sessionId: session.id,
        role: 'user',
        timestamp: 150,
        content: [
          { type: 'text', text: '请看这张图' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
          {
            type: 'file_attachment',
            filename: 'notes.txt',
            relativePath: 'notes.txt',
            size: 5,
            inlineDataBase64: 'aGVsbG8=',
          },
        ],
      },
    ];

    const { filename, blob } = createSessionExport(session, messages);
    expect(filename).toBe('open-cowork-session-session-1.json');
    expect(blob.type).toBe('application/json');
    expect(JSON.parse(await blob.text())).toEqual({
      format: 'open-cowork-session',
      version: 1,
      session,
      messages,
    });
  });
});
