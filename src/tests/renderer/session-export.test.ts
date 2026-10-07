import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createSessionExport,
  createSessionMarkdownExport,
  getSessionExportMessages,
} from '../../renderer/utils/session-export';
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
    expect(desktop.match(/aria-label="sidebar.exportPending"/g)).toHaveLength(2);
    expect(browser).not.toContain('disabled=""');
    expect(browser).toContain('aria-label="sidebar.exportSession"');
    expect(browser).toContain('aria-label="sidebar.exportSessionMarkdown"');
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
        onDelete: vi.fn(),
      })
    );

    expect(markup.match(/disabled=""/g)).toHaveLength(4);
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

describe('createSessionMarkdownExport', () => {
  const t = (key: string, options?: Record<string, string>) =>
    options ? `${key}(${Object.values(options).join(',')})` : key;

  it('writes a readable transcript and leaves internal blocks out', async () => {
    const messages: Message[] = [
      {
        id: 'message-1',
        sessionId: session.id,
        role: 'user',
        timestamp: 150,
        content: [
          { type: 'text', text: '请看这张图\n\n- 第一点' },
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
      {
        id: 'message-2',
        sessionId: session.id,
        role: 'assistant',
        timestamp: 160,
        content: [
          { type: 'thinking', thinking: 'private reasoning' },
          { type: 'tool_use', id: 'tool-1', name: 'read', displayName: 'Read file', input: {} },
          { type: 'text', text: 'Done.' },
          { type: 'text', text: '    const total = 3;' },
          { type: 'text', text: '  \n ' },
        ],
      },
      {
        id: 'message-3',
        sessionId: session.id,
        role: 'user',
        timestamp: 170,
        content: [{ type: 'tool_result', toolUseId: 'tool-1', content: 'file body' }],
      },
    ];

    const { filename, blob } = createSessionMarkdownExport(
      { ...session, title: 'Conversation\n  draft' },
      messages,
      t
    );

    expect(filename).toBe('open-cowork-session-session-1.md');
    expect(blob.type).toBe('text/markdown');
    expect(await blob.text()).toBe(
      [
        '# Conversation draft',
        '## sidebar.exportMarkdownUser',
        '请看这张图\n\n- 第一点',
        '_[sidebar.exportMarkdownImage]_',
        '_[sidebar.exportMarkdownAttachment(notes.txt)]_',
        '## sidebar.exportMarkdownAssistant',
        '> sidebar.exportMarkdownTool(Read file)',
        'Done.',
        '    const total = 3;',
      ].join('\n\n') + '\n'
    );
  });

  it('falls back to the default title and skips block types it does not model', async () => {
    const messages: Message[] = [
      {
        id: 'message-1',
        sessionId: session.id,
        role: 'assistant',
        timestamp: 150,
        content: [
          { type: 'redacted_thinking', data: 'x' } as unknown as Message['content'][number],
          { type: 'text', text: 'Visible answer' },
        ],
      },
    ];

    const { blob } = createSessionMarkdownExport({ ...session, title: '  ' }, messages, t);

    expect(await blob.text()).toBe(
      ['# New Session', '## sidebar.exportMarkdownAssistant', 'Visible answer'].join('\n\n') + '\n'
    );
  });
});
