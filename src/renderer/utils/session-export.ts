import { DEFAULT_SESSION_TITLE } from '../../shared/session-title';
import type { ContentBlock, Message, MessageRole, Session } from '../types';
import { useAppStore } from '../store';

export type SessionExportFormat = 'json' | 'markdown';

export async function getSessionExportMessages(
  sessionId: string,
  isElectron: boolean,
  getPersistedMessages: (sessionId: string) => Promise<Message[]>
): Promise<Message[] | null> {
  const before = useAppStore.getState();
  if (!isElectron) return before.sessionStates[sessionId]?.messages ?? [];

  const ready = (state: typeof before) =>
    state.sessions.some((session) => session.id === sessionId && session.status !== 'running') &&
    !state.sessionStates[sessionId]?.activeTurn &&
    !state.sessionStates[sessionId]?.pendingTurns.length &&
    !state.sessionStates[sessionId]?.messages.some((message) => message.localStatus === 'queued');

  if (!ready(before)) return null;

  const sessionBefore = before.sessions.find((session) => session.id === sessionId);
  const messages = await getPersistedMessages(sessionId);
  const after = useAppStore.getState();
  // A new message or status change can make the persisted snapshot stale during IPC.
  if (
    !ready(after) ||
    sessionBefore !== after.sessions.find((session) => session.id === sessionId) ||
    before.sessionStates[sessionId]?.messages !== after.sessionStates[sessionId]?.messages
  ) {
    return null;
  }
  return messages;
}

export function createSessionExport(session: Session, messages: Message[]) {
  const data = {
    format: 'open-cowork-session',
    version: 1,
    session,
    messages,
  };

  return {
    filename: `open-cowork-session-${session.id}.json`,
    blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  };
}

const MARKDOWN_ROLE_KEYS: Record<MessageRole, string> = {
  user: 'sidebar.exportMarkdownUser',
  assistant: 'sidebar.exportMarkdownAssistant',
  system: 'sidebar.exportMarkdownSystem',
};

type Translate = (key: string, options?: Record<string, string>) => string;

function blockToMarkdown(block: ContentBlock, t: Translate): string | null {
  switch (block.type) {
    case 'text':
      return block.text.trim() ? block.text : null;
    case 'image':
      return `_[${t('sidebar.exportMarkdownImage')}]_`;
    case 'file_attachment':
      return `_[${t('sidebar.exportMarkdownAttachment', { name: block.filename })}]_`;
    case 'tool_use':
      return `> ${t('sidebar.exportMarkdownTool', { name: block.displayName ?? block.name })}`;
    case 'tool_result':
    case 'thinking':
      return null;
    // Persisted history is parsed without validation and may hold block types
    // this renderer does not model.
    default:
      return null;
  }
}

export function createSessionMarkdownExport(session: Session, messages: Message[], t: Translate) {
  // Titles sent by external clients (remote channels, stdio) are not validated.
  const title = session.title.replace(/\s+/g, ' ').trim() || DEFAULT_SESSION_TITLE;
  const sections = [`# ${title}`];
  for (const message of messages) {
    const blocks = message.content
      .map((block) => blockToMarkdown(block, t))
      .filter((block) => block !== null);
    if (blocks.length === 0) continue;
    sections.push(`## ${t(MARKDOWN_ROLE_KEYS[message.role])}`, ...blocks);
  }

  return {
    filename: `open-cowork-session-${session.id}.md`,
    blob: new Blob([`${sections.join('\n\n')}\n`], { type: 'text/markdown' }),
  };
}
