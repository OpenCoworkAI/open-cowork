import { describe, it, expect, vi } from 'vitest';

// Mock configStore so the error-path test can force a deterministic model
// resolution failure instead of depending on whatever auth/config happens to
// be present in the test environment.
// `vi.mock` factories are hoisted above imports/const declarations, so the
// mock function must be created via `vi.hoisted` to avoid a TDZ reference error.
const { mockGetAll } = vi.hoisted(() => ({ mockGetAll: vi.fn() }));
vi.mock('../../main/config/config-store', () => ({
  configStore: {
    getAll: mockGetAll,
    get: vi.fn(),
  },
}));

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

    it('returns structured error when model cannot be resolved', async () => {
      // Force configStore to hand back a model/provider combination that
      // cannot resolve to any known pi-ai registry model. This makes the
      // failure deterministic (no dependency on real auth being configured)
      // and lets us assert the exact error surfaced to the caller.
      mockGetAll.mockReturnValue({
        model: 'nonexistent-provider/fake-model-xyz',
        provider: 'nonexistent-provider',
      });

      const extension = new SubagentExtension(() => null);
      const result = await extension.beforeSessionRun();
      const execute = result.customTools![0].execute as unknown as ToolExecuteFn;

      const execResult = (await execute('test-call', { task: 'test task' })) as {
        content: { type: string; text: string }[];
      };

      expect(execResult.content).toBeDefined();
      expect(execResult.content[0].type).toBe('text');
      expect(execResult.content[0].text).toContain('could not resolve model');
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
