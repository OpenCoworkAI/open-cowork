/**
 * Tests for src/main/agent/todo-extension.
 *
 * Focus areas:
 *   - TodoExtension registers exactly one tool, named TodoWrite (the renderer matches on the name)
 *   - The tool's arguments are validated by pi's own validator, as in a real run: the four statuses
 *     and the optional id / activeForm pass, an unknown status, empty content or a missing list fail
 *   - The tool keeps no state: the result describes only the list in the call
 *   - Every extension manager the main process builds, interactive and headless, registers it
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateToolArguments } from '@mariozechner/pi-ai';
import { TodoExtension } from '../../main/agent/todo-extension';
import type { AgentRuntimeCustomTool } from '../../main/extensions/agent-runtime-extension';

async function loadTool(): Promise<AgentRuntimeCustomTool> {
  const result = await new TodoExtension().beforeSessionRun();
  const tools = result?.customTools ?? [];
  expect(tools.map((tool) => tool.name)).toEqual(['TodoWrite']);
  return tools[0] as AgentRuntimeCustomTool;
}

function validate(tool: AgentRuntimeCustomTool, args: unknown): unknown {
  return validateToolArguments(tool as never, {
    type: 'toolCall',
    id: 'call-1',
    name: tool.name,
    arguments: args as Record<string, unknown>,
  });
}

describe('TodoExtension', () => {
  it('registers a single tool named TodoWrite', async () => {
    const tool = await loadTool();
    expect(tool.label).toBe('TodoWrite');
    expect(tool.description).toContain('complete list');
  });

  it('accepts every status and the optional id and activeForm', async () => {
    const tool = await loadTool();
    const todos = [
      { content: 'Read the config', status: 'completed' },
      { content: 'Fix the bug', status: 'in_progress', id: 'fix', activeForm: 'Fixing the bug' },
      { content: 'Run the tests', status: 'pending' },
      { content: 'Update the docs', status: 'cancelled' },
    ];

    expect(validate(tool, { todos })).toEqual({ todos });
    expect(validate(tool, { todos: [] })).toEqual({ todos: [] });
  });

  it.each([
    ['an unknown status', { todos: [{ content: 'Fix the bug', status: 'blocked' }] }],
    ['empty content', { todos: [{ content: '', status: 'pending' }] }],
    ['a missing status', { todos: [{ content: 'Fix the bug' }] }],
    ['a missing list', {}],
    ['a list that is not an array', { todos: 'Fix the bug' }],
  ])('rejects %s', async (_name: string, args: unknown) => {
    const tool = await loadTool();
    expect(() => validate(tool, args)).toThrow(/Validation failed for tool "TodoWrite"/);
  });

  it('is registered wherever the app builds an extension manager', () => {
    // The managers are built inside Electron startup callbacks with live dependencies (the
    // interactive and the headless path), so this counts in the source of the main process.
    const mainDir = path.resolve(__dirname, '../../main');
    const sources = readdirSync(mainDir, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
      .map((file) => readFileSync(path.join(mainDir, file), 'utf8'));
    const count = (text: string) =>
      sources.reduce((total, source) => total + source.split(text).length - 1, 0);

    expect(count('new AgentRuntimeExtensionManager(')).toBeGreaterThanOrEqual(2);
    expect(count('new TodoExtension()')).toBe(count('new AgentRuntimeExtensionManager('));
  });

  it('reports only the list in the call, and keeps nothing between calls', async () => {
    const tool = await loadTool();
    const run = async (todos: unknown[]) => {
      const result = (await tool.execute('call', { todos }, undefined, undefined, {} as never)) as {
        content: Array<{ type: string; text: string }>;
      };
      return result.content[0]?.text;
    };

    expect(
      await run([
        { content: 'A', status: 'completed' },
        { content: 'B', status: 'in_progress' },
        { content: 'C', status: 'pending' },
      ])
    ).toBe('Todos updated: 1 of 3 completed.');
    expect(await run([{ content: 'D', status: 'pending' }])).toBe(
      'Todos updated: 0 of 1 completed.'
    );
    expect(await run([])).toBe('Todos updated: 0 of 0 completed.');
  });
});
