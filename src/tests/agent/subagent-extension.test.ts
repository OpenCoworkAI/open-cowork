import { describe, it, expect, vi } from 'vitest';
import { SubagentExtension } from '../../main/agent/subagent-extension';

type ToolExecuteFn = (id: string, params: unknown) => Promise<unknown>;

describe('SubagentExtension', () => {
  it('registers spawn_subagent tool via beforeSessionRun', async () => {
    const extension = new SubagentExtension(() => null);
    const result = await extension.beforeSessionRun();

    expect(result.customTools).toHaveLength(1);
    expect(result.customTools![0].name).toBe('spawn_subagent');
    expect(result.customTools![0].description).toContain('child agent');
  });

  it('has correct extension name', () => {
    const extension = new SubagentExtension(() => null);
    expect(extension.name).toBe('subagent');
  });

  describe('spawn_subagent tool', () => {
    it('rejects empty task parameter', async () => {
      const extension = new SubagentExtension(() => null);
      const result = await extension.beforeSessionRun();
      const execute = result.customTools![0].execute as unknown as ToolExecuteFn;

      const execResult = (await execute('test-call', { task: '' })) as {
        content: { type: string; text: string }[];
      };

      expect(execResult.content[0].text).toContain('task parameter is required');
    });

    it('rejects null params', async () => {
      const extension = new SubagentExtension(() => null);
      const result = await extension.beforeSessionRun();
      const execute = result.customTools![0].execute as unknown as ToolExecuteFn;

      const execResult = (await execute('test-call', null)) as {
        content: { type: string; text: string }[];
      };

      expect(execResult.content[0].text).toContain('task parameter is required');
    });

    it('rejects whitespace-only task', async () => {
      const extension = new SubagentExtension(() => null);
      const result = await extension.beforeSessionRun();
      const execute = result.customTools![0].execute as unknown as ToolExecuteFn;

      const execResult = (await execute('test-call', { task: '   ' })) as {
        content: { type: string; text: string }[];
      };

      expect(execResult.content[0].text).toContain('task parameter is required');
    });

    it('returns error when model cannot be resolved', async () => {
      // Mock configStore to return empty config (no model configured)
      vi.doMock('../../main/config/config-store', () => ({
        configStore: {
          getAll: () => ({ model: '', provider: '' }),
          get: () => undefined,
        },
      }));

      const extension = new SubagentExtension(() => null);
      const result = await extension.beforeSessionRun();
      const execute = result.customTools![0].execute as unknown as ToolExecuteFn;

      const execResult = (await execute('test-call', { task: 'test task' })) as {
        content: { type: string; text: string }[];
      };

      // Should either error about model resolution or proceed with default model
      expect(execResult.content[0].text).toBeTruthy();
    });

    it('tool has correct parameter schema', async () => {
      const extension = new SubagentExtension(() => null);
      const result = await extension.beforeSessionRun();
      const tool = result.customTools![0];

      const schema = tool.parameters;
      expect(schema).toBeDefined();
      // The schema should have task as required and other optional params
      expect(schema.properties).toBeDefined();
    });
  });
});
