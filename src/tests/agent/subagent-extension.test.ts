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

const noopSend = () => {};
const noopPermission = async () => 'allow' as const;
const noopSignal = () => null;
const mockContext = {
  session: { id: 'test-session' },
  prompt: '',
  existingMessages: [],
  isColdStart: false,
};

describe('SubagentExtension', () => {
  it('registers spawn_subagent tool via beforeSessionRun', async () => {
    const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
    const result = await extension.beforeSessionRun(mockContext as never);

    expect(result.customTools).toHaveLength(1);
    expect(result.customTools![0].name).toBe('spawn_subagent');
    expect(result.customTools![0].description).toContain('child agent');
  });

  it('has correct extension name', () => {
    const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
    expect(extension.name).toBe('subagent');
  });

  describe('spawn_subagent tool', () => {
    it('rejects empty task parameter', async () => {
      const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
      const result = await extension.beforeSessionRun(mockContext as never);
      const execute = result.customTools![0].execute as unknown as ToolExecuteFn;

      const execResult = (await execute('test-call', { task: '' })) as {
        content: { type: string; text: string }[];
      };

      expect(execResult.content[0].text).toContain('task parameter is required');
    });

    it('rejects null params', async () => {
      const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
      const result = await extension.beforeSessionRun(mockContext as never);
      const execute = result.customTools![0].execute as unknown as ToolExecuteFn;

      const execResult = (await execute('test-call', null)) as {
        content: { type: string; text: string }[];
      };

      expect(execResult.content[0].text).toContain('task parameter is required');
    });

    it('rejects whitespace-only task', async () => {
      const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
      const result = await extension.beforeSessionRun(mockContext as never);
      const execute = result.customTools![0].execute as unknown as ToolExecuteFn;

      const execResult = (await execute('test-call', { task: '   ' })) as {
        content: { type: string; text: string }[];
      };

      expect(execResult.content[0].text).toContain('task parameter is required');
    });

    it('rejects task exceeding max length', async () => {
      const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
      const result = await extension.beforeSessionRun(mockContext as never);
      const execute = result.customTools![0].execute as unknown as ToolExecuteFn;

      const execResult = (await execute('test-call', { task: 'x'.repeat(11000) })) as {
        content: { type: string; text: string }[];
      };

      expect(execResult.content[0].text).toContain('exceeds maximum length');
    });

    it('rejects when concurrency limit reached', async () => {
      const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);

      // Access private state to simulate concurrent subagents
      const state = (extension as unknown as { concurrencyState: { active: number } })
        .concurrencyState;
      state.active = 3;

      const result = await extension.beforeSessionRun(mockContext as never);
      const execute = result.customTools![0].execute as unknown as ToolExecuteFn;

      const execResult = (await execute('test-call', { task: 'test' })) as {
        content: { type: string; text: string }[];
      };

      expect(execResult.content[0].text).toContain('maximum concurrent subagents');
      state.active = 0;
    });

    it('returns structured error when model cannot be resolved', async () => {
      mockGetAll.mockReturnValue({
        model: 'nonexistent-provider/fake-model-xyz',
        provider: 'nonexistent-provider',
      });

      const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
      const result = await extension.beforeSessionRun(mockContext as never);
      const execute = result.customTools![0].execute as unknown as ToolExecuteFn;

      const execResult = (await execute('test-call', { task: 'test task' })) as {
        content: { type: string; text: string }[];
      };

      expect(execResult.content).toBeDefined();
      expect(execResult.content[0].type).toBe('text');
      expect(execResult.content[0].text).toContain('could not resolve model');
    });

    it('tool has correct parameter schema', async () => {
      const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
      const result = await extension.beforeSessionRun(mockContext as never);
      const tool = result.customTools![0];

      const schema = tool.parameters;
      expect(schema).toBeDefined();
      expect(schema.properties).toBeDefined();
    });

    it('emits subagent.progress started event on execution', async () => {
      mockGetAll.mockReturnValue({
        model: 'nonexistent-provider/fake-model-xyz',
        provider: 'nonexistent-provider',
      });

      const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const captureSend = (event: unknown) => events.push(event as (typeof events)[0]);

      const extension = new SubagentExtension(
        () => null,
        captureSend as never,
        noopPermission,
        noopSignal
      );
      const result = await extension.beforeSessionRun(mockContext as never);
      const execute = result.customTools![0].execute as unknown as ToolExecuteFn;

      await execute('test-call', { task: 'test streaming' });

      const startedEvent = events.find((e) => e.payload?.event === 'started');
      expect(startedEvent).toBeDefined();
      expect(startedEvent!.type).toBe('subagent.progress');
      expect(startedEvent!.payload.parentSessionId).toBe('test-session');
      expect(startedEvent!.payload.task).toContain('test streaming');
    });

    it('does not emit completed/failed when model resolution fails early', async () => {
      mockGetAll.mockReturnValue({
        model: 'nonexistent-provider/fake-model-xyz',
        provider: 'nonexistent-provider',
      });

      const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const captureSend = (event: unknown) => events.push(event as (typeof events)[0]);

      const extension = new SubagentExtension(
        () => null,
        captureSend as never,
        noopPermission,
        noopSignal
      );
      const result = await extension.beforeSessionRun(mockContext as never);
      const execute = result.customTools![0].execute as unknown as ToolExecuteFn;

      await execute('test-call', { task: 'test early failure' });

      // Model resolution failure happens before session creation,
      // so only 'started' is emitted (no completed/failed since the tool returns early)
      expect(events.length).toBeGreaterThanOrEqual(1);
      const eventTypes = events.map((e) => e.payload?.event);
      expect(eventTypes).toContain('started');
      // No completed event since it returns with error before entering the session flow
      expect(eventTypes).not.toContain('completed');
    });

    it('decrements concurrency counter even on failure', async () => {
      mockGetAll.mockReturnValue({
        model: 'nonexistent-provider/fake-model-xyz',
        provider: 'nonexistent-provider',
      });

      const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
      const state = (extension as unknown as { concurrencyState: { active: number } })
        .concurrencyState;

      expect(state.active).toBe(0);
      const result = await extension.beforeSessionRun(mockContext as never);
      const execute = result.customTools![0].execute as unknown as ToolExecuteFn;

      await execute('test-call', { task: 'test concurrency decrement' });

      // Even though execution failed (model not found), counter should be back to 0
      expect(state.active).toBe(0);
    });
  });
});
