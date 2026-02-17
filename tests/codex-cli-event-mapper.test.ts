import { describe, expect, it } from 'vitest';
import { CodexCliEventMapper, mapCodexTodoItems } from '../src/main/openai/codex-cli-event-mapper';

function createMapper() {
  let idSeq = 0;
  let nowSeq = 1000;
  return new CodexCliEventMapper({
    cwd: '/workspace',
    idFactory: () => `id-${++idSeq}`,
    now: () => ++nowSeq,
  });
}

describe('CodexCliEventMapper', () => {
  it('maps command execution start/completion to tool use + result', () => {
    const mapper = createMapper();

    const turnActions = mapper.map({ type: 'turn.started' });
    expect(turnActions).toHaveLength(1);
    expect(turnActions[0]).toMatchObject({
      type: 'trace.step',
      step: { id: 'id-1', type: 'thinking', status: 'running' },
    });

    const started = mapper.map({
      type: 'item.started',
      item: {
        id: 'cmd-1',
        type: 'command_execution',
        command: '/bin/zsh -lc pwd',
      },
    });
    expect(started.map((item) => item.type)).toEqual(['tool.use', 'trace.step']);
    expect(started[0]).toMatchObject({
      type: 'tool.use',
      toolUse: {
        id: 'cmd-1',
        name: 'execute_command',
        input: {
          command: '/bin/zsh -lc pwd',
          cwd: '/workspace',
        },
      },
    });

    const completed = mapper.map({
      type: 'item.completed',
      item: {
        id: 'cmd-1',
        type: 'command_execution',
        command: '/bin/zsh -lc pwd',
        aggregated_output: '/workspace\n',
        exit_code: 0,
      },
    });

    expect(completed.map((item) => item.type)).toEqual(['trace.update', 'tool.result']);
    expect(completed[0]).toMatchObject({
      type: 'trace.update',
      stepId: 'cmd-1',
      updates: { status: 'completed', isError: false },
    });
    expect(completed[1]).toMatchObject({
      type: 'tool.result',
      toolResult: {
        toolUseId: 'cmd-1',
        content: '/workspace\n',
        isError: false,
      },
    });
  });

  it('maps mcp tool completion to mcp tool use + result text', () => {
    const mapper = createMapper();

    const actions = mapper.map({
      type: 'item.completed',
      item: {
        id: 'mcp-1',
        type: 'mcp_tool_call',
        server: 'Chrome',
        tool: 'navigate',
        arguments: { url: 'https://example.com' },
        result: {
          content: [{ type: 'text', text: 'ok' }],
        },
      },
    });

    expect(actions.map((item) => item.type)).toEqual(['tool.use', 'trace.step', 'trace.update', 'tool.result']);
    expect(actions[0]).toMatchObject({
      type: 'tool.use',
      toolUse: {
        id: 'mcp-1',
        name: 'mcp__Chrome__navigate',
        input: { url: 'https://example.com' },
      },
    });
    expect(actions[3]).toMatchObject({
      type: 'tool.result',
      toolResult: {
        toolUseId: 'mcp-1',
        content: 'ok',
      },
    });
  });

  it('maps mcp screenshot_for_display images into tool_result.images', () => {
    const mapper = createMapper();

    const actions = mapper.map({
      type: 'item.completed',
      item: {
        id: 'mcp-2',
        type: 'mcp_tool_call',
        server: 'GUI_Operate',
        tool: 'screenshot_for_display',
        arguments: { display_index: 0 },
        result: {
          content: [
            {
              type: 'text',
              text: '{"success":true,"path":"/tmp/screenshot.png"}',
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                data: 'ZmFrZV9pbWFnZQ==',
                media_type: 'image/png',
              },
            },
          ],
        },
      },
    });

    expect(actions.map((item) => item.type)).toEqual(['tool.use', 'trace.step', 'trace.update', 'tool.result']);
    expect(actions[3]).toMatchObject({
      type: 'tool.result',
      toolResult: {
        toolUseId: 'mcp-2',
        content: '{"success":true,"path":"/tmp/screenshot.png"}',
        images: [
          {
            data: 'ZmFrZV9pbWFnZQ==',
            mimeType: 'image/png',
          },
        ],
      },
    });
  });

  it('suppresses duplicated screenshot_for_display calls with identical args shortly after first call', () => {
    const mapper = createMapper();

    const firstStarted = mapper.map({
      type: 'item.started',
      item: {
        id: 'shot-1',
        type: 'mcp_tool_call',
        server: 'GUI_Operate',
        tool: 'screenshot_for_display',
        arguments: { display_index: 0, reason: 'capture' },
      },
    });
    expect(firstStarted.map((item) => item.type)).toEqual(['tool.use', 'trace.step']);

    const firstCompleted = mapper.map({
      type: 'item.completed',
      item: {
        id: 'shot-1',
        type: 'mcp_tool_call',
        server: 'GUI_Operate',
        tool: 'screenshot_for_display',
        arguments: { display_index: 0, reason: 'capture' },
        result: { content: [{ type: 'text', text: 'ok' }] },
      },
    });
    expect(firstCompleted.map((item) => item.type)).toEqual(['trace.update', 'tool.result']);

    const secondStarted = mapper.map({
      type: 'item.started',
      item: {
        id: 'shot-2',
        type: 'mcp_tool_call',
        server: 'GUI_Operate',
        tool: 'screenshot_for_display',
        arguments: { display_index: 0, reason: 'capture' },
      },
    });
    expect(secondStarted).toEqual([]);

    const secondCompleted = mapper.map({
      type: 'item.completed',
      item: {
        id: 'shot-2',
        type: 'mcp_tool_call',
        server: 'GUI_Operate',
        tool: 'screenshot_for_display',
        arguments: { display_index: 0, reason: 'capture' },
        result: { content: [{ type: 'text', text: 'ok-again' }] },
      },
    });
    expect(secondCompleted).toEqual([]);
  });

  it('maps todo_list into TodoWrite payload for widget compatibility', () => {
    const mapper = createMapper();

    const actions = mapper.map({
      type: 'item.started',
      item: {
        id: 'todo-1',
        type: 'todo_list',
        items: [
          { text: 'First', completed: false },
          { text: 'Second', completed: true },
        ],
      },
    });

    expect(actions[0]).toMatchObject({
      type: 'tool.use',
      toolUse: {
        id: 'todo-1',
        name: 'TodoWrite',
        input: {
          todos: [
            { content: 'First', status: 'pending', id: '', activeForm: '' },
            { content: 'Second', status: 'completed', id: '', activeForm: '' },
          ],
        },
      },
    });

    const completed = mapper.map({
      type: 'item.completed',
      item: {
        id: 'todo-1',
        type: 'todo_list',
        items: [{ text: 'First', completed: true }],
      },
    });
    expect(completed.map((item) => item.type)).toEqual(['trace.update', 'tool.result']);
  });

  it('maps assistant message and turn completion', () => {
    const mapper = createMapper();

    mapper.map({ type: 'turn.started' });

    const messageActions = mapper.map({
      type: 'item.completed',
      item: {
        id: 'msg-1',
        type: 'agent_message',
        text: 'DONE',
      },
    });
    expect(messageActions).toEqual([{ type: 'assistant.message', text: 'DONE' }]);

    const turnDone = mapper.map({ type: 'turn.completed' });
    expect(turnDone).toEqual([
      {
        type: 'trace.update',
        stepId: 'id-1',
        updates: {
          status: 'completed',
          title: 'Task completed',
        },
      },
    ]);
  });

  it('maps raw todo items helper', () => {
    expect(mapCodexTodoItems([{ text: 'A', completed: true }, { text: 'B' }])).toEqual([
      { content: 'A', status: 'completed', id: '', activeForm: '' },
      { content: 'B', status: 'pending', id: '', activeForm: '' },
    ]);
  });
});
