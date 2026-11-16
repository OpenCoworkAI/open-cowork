/**
 * A TodoWrite call is saved with the conversation and shown again from the saved copy.
 *
 * Focus areas:
 *   - the call survives the database, including a restart, and renders as the task list
 *   - ToolUseBlock picks TodoWriteBlock by the exact tool name
 *   - the list is part of the history that a cold start sends back to the model
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const paths = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => paths.userData, getVersion: () => '0.0.0' },
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-todo-write-history-config-store.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...(options?.defaults || {}) };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = { ...this.store, ...key };
    }
  }
  return { default: MockStore };
});

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: { getEnabledServers: () => [] },
}));

import { closeDatabase, initDatabase } from '../src/main/db/database';
import { SessionManager } from '../src/main/session/session-manager';
import { serializeMessageContentForHistory } from '../src/main/agent/agent-runner';
import { TodoWriteBlock } from '../src/renderer/components/message/TodoWriteBlock';
import { ToolUseBlock } from '../src/renderer/components/message/ToolUseBlock';
import type { ContentBlock, ToolUseContent } from '../src/renderer/types';

const todos = [
  { content: 'Read the config', status: 'completed' },
  { content: 'Fix the bug', status: 'in_progress', activeForm: 'Fixing the bug' },
  { content: 'Run the tests', status: 'pending' },
];

const toolUse: ToolUseContent = {
  type: 'tool_use',
  id: 'call-todo-1',
  name: 'TodoWrite',
  input: { todos },
};

const content: ContentBlock[] = [
  { type: 'text', text: 'I will work through these steps.' },
  toolUse,
];

function savedToolUse(manager: SessionManager, sessionId: string): ToolUseContent {
  const saved = manager.getMessages(sessionId).flatMap((message) => message.content);
  return saved.find((block) => block.type === 'tool_use') as ToolUseContent;
}

describe('a TodoWrite call in the saved conversation', () => {
  beforeEach(() => {
    paths.userData = mkdtempSync(join(tmpdir(), 'cowork-todo-write-history-'));
    mkdirSync(join(paths.userData, 'data'));
  });
  afterEach(() => {
    closeDatabase();
    rmSync(paths.userData, { recursive: true, force: true });
  });

  it('comes back from the database after a restart and renders as the task list', () => {
    const first = initDatabase();
    first.sessions.create({
      id: 'session-1',
      title: 'Plan',
      claude_session_id: null,
      openai_thread_id: null,
      status: 'idle',
      cwd: null,
      mounted_paths: '[]',
      allowed_tools: '[]',
      memory_enabled: 1,
      model: null,
      created_at: 1,
      updated_at: 1,
    });
    first.messages.create({
      id: 'message-1',
      session_id: 'session-1',
      role: 'assistant',
      content: JSON.stringify(content),
      timestamp: 2,
      token_usage: null,
      execution_time_ms: null,
    });

    closeDatabase();
    const restored = savedToolUse(new SessionManager(initDatabase(), vi.fn()), 'session-1');

    expect(restored).toEqual(toolUse);
    const markup = renderToStaticMarkup(createElement(TodoWriteBlock, { block: restored }));
    expect(markup).toContain('messageCard.taskProgress');
    expect(markup).toContain('1/3');
    expect(markup).toContain('Fixing the bug');
    for (const todo of todos) expect(markup).toContain(todo.content);
    expect(markup).toContain('width:33.33');
  });

  it('names the item in progress by its content when it has no activeForm', () => {
    const block: ToolUseContent = {
      ...toolUse,
      input: { todos: [{ content: 'Fix the bug', status: 'in_progress' }] },
    };

    const markup = renderToStaticMarkup(createElement(TodoWriteBlock, { block }));

    // Once in the header, once in the list.
    expect(markup.split('Fix the bug')).toHaveLength(3);
    expect(markup).not.toContain('undefined');
  });

  it('shows a cancelled item struck through and muted, and counts only completed items', () => {
    const items = [{ content: 'Read the config', status: 'completed' }];
    const render = (todos: unknown[]) =>
      renderToStaticMarkup(
        createElement(TodoWriteBlock, { block: { ...toolUse, input: { todos } } })
      );
    const classesOf = (markup: string, text: string) =>
      new RegExp(`class="([^"]*)">${text}<`).exec(markup)?.[1]?.split(' ');
    const withCancelled = render([...items, { content: 'Update the docs', status: 'cancelled' }]);
    const withoutCancelled = render(items);

    expect(classesOf(withCancelled, 'Update the docs')).toEqual(
      expect.arrayContaining(['line-through', 'opacity-60'])
    );
    // A completed item is struck through too, but it is not muted like a cancelled one.
    expect(classesOf(withCancelled, 'Read the config')).toContain('line-through');
    expect(classesOf(withCancelled, 'Read the config')).not.toContain('opacity-60');
    expect(withCancelled).toContain('1/2');
    expect(withoutCancelled).toContain('1/1');
    expect(withoutCancelled).not.toContain('opacity-60');
  });

  it('is shown by ToolUseBlock for the exact name TodoWrite', () => {
    const markup = renderToStaticMarkup(createElement(ToolUseBlock, { block: toolUse }));

    expect(markup).toContain('messageCard.taskProgress');
    expect(markup).toContain('1/3');
  });

  it('is part of the history a cold start sends back to the model', () => {
    const history = serializeMessageContentForHistory(content);

    expect(history).toContain('<tool_use name="TodoWrite" id="call-todo-1">');
    expect(history).toContain('Fix the bug');
    expect(history).toContain('in_progress');
  });
});
