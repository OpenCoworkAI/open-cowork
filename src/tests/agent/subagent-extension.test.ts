import { beforeEach, describe, it, expect, vi } from 'vitest';

// Mock configStore so the error-path test can force a deterministic model
// resolution failure instead of depending on whatever auth/config happens to
// be present in the test environment.
// `vi.mock` factories are hoisted above imports/const declarations, so the
// mock function must be created via `vi.hoisted` to avoid a TDZ reference error.
const { mockGetAll, mockCreateAgentSession } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockCreateAgentSession: vi.fn(),
}));
vi.mock('@mariozechner/pi-coding-agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mariozechner/pi-coding-agent')>()),
  createAgentSession: mockCreateAgentSession,
}));
vi.mock('../../main/config/config-store', () => ({
  configStore: {
    getAll: mockGetAll,
    get: vi.fn(),
  },
}));

import { SubagentExtension } from '../../main/agent/subagent-extension';
import * as logger from '../../main/utils/logger';

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
  beforeEach(() => {
    mockGetAll.mockReturnValue({
      provider: 'custom',
      customProtocol: 'openai',
      model: 'parent-model',
      apiKey: 'fixture-key',
      baseUrl: 'http://localhost:9999/v1',
    });
    mockCreateAgentSession
      .mockReset()
      .mockRejectedValue(new Error('fixture session creation failed'));
  });
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

  it('refuses host-tool child execution in an isolated sandbox', async () => {
    const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
    const result = await extension.beforeSessionRun({
      ...mockContext,
      sandboxIsolated: true,
    } as never);
    const output = await (result.customTools![0].execute as unknown as ToolExecuteFn)('child', {
      task: 'write file',
    });
    expect(JSON.stringify(output)).toContain('sandbox');
    expect(mockCreateAgentSession).not.toHaveBeenCalled();
  });

  it('keeps parent sessions usable when child configuration is invalid', async () => {
    const configError = 'Unknown default subagent: private-role-name';
    const logError = vi.spyOn(logger, 'logError').mockImplementation(() => {});
    mockGetAll.mockReturnValue({
      ...mockGetAll(),
      subagentConfigError: configError,
    });
    const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
    const result = await extension.beforeSessionRun(mockContext as never);
    const output = await (result.customTools![0].execute as unknown as ToolExecuteFn)('child', {
      task: 'inspect',
    });
    expect(output).toEqual({
      content: [
        {
          type: 'text',
          text: 'Subagent configuration error. Repair it in Settings > Subagents.',
        },
      ],
      details: undefined,
    });
    expect(logError).toHaveBeenCalledWith(
      '[SubagentExtension] Invalid subagent configuration:',
      configError
    );
    expect(mockCreateAgentSession).not.toHaveBeenCalled();
  });

  it('rejects a child override from another fixed provider', async () => {
    mockGetAll.mockReturnValue({
      ...mockGetAll(),
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5-mini',
    });
    const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
    const result = await extension.beforeSessionRun(mockContext as never);
    const output = await (result.customTools![0].execute as unknown as ToolExecuteFn)('child', {
      task: 'inspect',
      model: 'anthropic/claude-sonnet-4-6',
    });
    expect(JSON.stringify(output)).toContain('active provider');
    expect(mockCreateAgentSession).not.toHaveBeenCalled();
  });

  it('does not fall back to a different registry provider for bare model IDs', async () => {
    mockGetAll.mockReturnValue({
      ...mockGetAll(),
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5-mini',
    });
    const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
    const result = await extension.beforeSessionRun(mockContext as never);
    await (result.customTools![0].execute as unknown as ToolExecuteFn)('child', {
      task: 'inspect',
      model: 'claude-sonnet-4-6',
    });
    expect(mockCreateAgentSession.mock.calls[0][0].model).toMatchObject({
      provider: 'openai',
      api: 'openai-completions',
    });
  });

  it.each(['custom', 'openrouter', 'openai', 'ollama'])(
    'preserves slash IDs on %s endpoints',
    async (provider) => {
      mockGetAll.mockReturnValue({ ...mockGetAll(), provider });
      const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
      const result = await extension.beforeSessionRun(mockContext as never);
      await (result.customTools![0].execute as unknown as ToolExecuteFn)('child', {
        task: 'inspect',
        model: 'anthropic/claude-sonnet-4-6',
      });
      expect(mockCreateAgentSession.mock.calls[0][0].model).toMatchObject({
        id: 'anthropic/claude-sonnet-4-6',
        api: 'openai-completions',
        baseUrl: 'http://localhost:9999/v1',
      });
    }
  );

  it('keeps a bare child model on the active OpenRouter endpoint', async () => {
    mockGetAll.mockReturnValue({ ...mockGetAll(), provider: 'openrouter' });
    const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
    const result = await extension.beforeSessionRun(mockContext as never);
    await (result.customTools![0].execute as unknown as ToolExecuteFn)('child', {
      task: 'inspect',
      model: 'claude-sonnet-4-6',
    });
    expect(mockCreateAgentSession.mock.calls[0][0].model).toMatchObject({
      provider: 'openrouter',
      api: 'openai-completions',
      baseUrl: 'http://localhost:9999/v1',
    });
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
      const state = (extension as unknown as { activeSubagents: Map<string, Set<string>> })
        .activeSubagents;
      state.set('test-session', new Set(['first', 'second', 'third']));

      const result = await extension.beforeSessionRun(mockContext as never);
      const execute = result.customTools![0].execute as unknown as ToolExecuteFn;

      const execResult = (await execute('test-call', { task: 'test' })) as {
        content: { type: string; text: string }[];
      };

      expect(execResult.content[0].text).toContain('maximum concurrent subagents');
      state.clear();
    });

    it('returns a structured error when session creation fails', async () => {
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
      expect(execResult.content[0].text).toContain('fixture session creation failed');
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

    it('emits failed when child session creation fails', async () => {
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

      expect(events.length).toBeGreaterThanOrEqual(1);
      const eventTypes = events.map((e) => e.payload?.event);
      expect(eventTypes).toContain('started');
      expect(eventTypes).toContain('failed');
      expect(eventTypes).not.toContain('completed');
    });

    it('releases the concurrency slot even on failure', async () => {
      mockGetAll.mockReturnValue({
        model: 'nonexistent-provider/fake-model-xyz',
        provider: 'nonexistent-provider',
      });

      const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
      const state = (extension as unknown as { activeSubagents: Map<string, Set<string>> })
        .activeSubagents;

      expect(state.size).toBe(0);
      const result = await extension.beforeSessionRun(mockContext as never);
      const execute = result.customTools![0].execute as unknown as ToolExecuteFn;

      await execute('test-call', { task: 'test concurrency decrement' });

      // Session creation failures release the concurrency slot.
      expect(state.size).toBe(0);
    });
  });

  it('routes an independent custom child model and uses the parent workspace', async () => {
    const config = mockGetAll();
    mockGetAll.mockReturnValue({
      ...config,
      defaultWorkdir: '/wrong-workspace',
      subagent: { model: 'child-model', defaultAgent: '', maxConcurrent: 3, presets: [] },
    });
    const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
    const result = await extension.beforeSessionRun({
      ...mockContext,
      session: { id: 'test-session', cwd: '/tmp' },
    } as never);
    await (result.customTools![0].execute as unknown as ToolExecuteFn)('child', {
      task: 'inspect',
    });
    const options = mockCreateAgentSession.mock.calls[0][0];
    expect(options.model.id).toBe('child-model');
    expect(options.model.api).toBe('openai-completions');
    expect(options.model.baseUrl).toBe('http://localhost:9999/v1');
    expect(options.cwd).toBe('/tmp');
    expect(mockGetAll().model).toBe('parent-model');
  });

  it('intersects role and invocation tool restrictions and supports model overrides', async () => {
    mockGetAll.mockReturnValue({
      ...mockGetAll(),
      subagent: {
        model: 'default-child',
        defaultAgent: 'reader',
        maxConcurrent: 2,
        presets: [
          {
            name: 'reader',
            model: 'role-model',
            description: 'Read only',
            prompt: 'Review without edits.',
            allowedTools: ['read'],
          },
        ],
      },
    });
    const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
    const result = await extension.beforeSessionRun(mockContext as never);
    const execute = result.customTools![0].execute as unknown as ToolExecuteFn;
    await execute('role', { task: 'inspect', allowed_tools: ['read', 'write', 'bash'] });
    expect(mockCreateAgentSession.mock.calls[0][0].model.id).toBe('role-model');
    expect(
      mockCreateAgentSession.mock.calls[0][0].tools.map((tool: { name: string }) => tool.name)
    ).toEqual(['read']);
    await execute('override', { task: 'inspect', model: 'explicit-model', allowed_tools: [] });
    expect(mockCreateAgentSession.mock.calls[1][0].model.id).toBe('explicit-model');
    expect(mockCreateAgentSession.mock.calls[1][0].tools).toEqual([]);
  });

  it('rejects unknown roles without starting a child', async () => {
    const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
    const result = await extension.beforeSessionRun(mockContext as never);
    const outcome = (await (result.customTools![0].execute as unknown as ToolExecuteFn)('unknown', {
      task: 'inspect',
      agent: 'missing',
    })) as { content: { text: string }[] };
    expect(outcome.content[0].text).toContain('unknown subagent preset');
    expect(mockCreateAgentSession).not.toHaveBeenCalled();
  });

  it('enforces the configured per-session concurrency limit', async () => {
    mockGetAll.mockReturnValue({
      ...mockGetAll(),
      subagent: { model: '', defaultAgent: '', maxConcurrent: 1, presets: [] },
    });
    const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
    (extension as unknown as { activeSubagents: Map<string, Set<string>> }).activeSubagents.set(
      'test-session',
      new Set(['running'])
    );
    const result = await extension.beforeSessionRun(mockContext as never);
    const outcome = (await (result.customTools![0].execute as unknown as ToolExecuteFn)('busy', {
      task: 'inspect',
    })) as { content: { text: string }[] };
    expect(outcome.content[0].text).toContain('maximum concurrent subagents (1)');
    expect(mockCreateAgentSession).not.toHaveBeenCalled();
  });

  it('keeps concurrency slots isolated across parent sessions', async () => {
    mockGetAll.mockReturnValue({
      ...mockGetAll(),
      subagent: { model: '', defaultAgent: '', maxConcurrent: 1, presets: [] },
    });
    const pending: Array<(error: Error) => void> = [];
    mockCreateAgentSession.mockImplementation(
      () => new Promise((_, reject) => pending.push(reject))
    );
    const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
    const first = await extension.beforeSessionRun(mockContext as never);
    const second = await extension.beforeSessionRun({
      ...mockContext,
      session: { id: 'other-session' },
    } as never);
    const executeFirst = first.customTools![0].execute as unknown as ToolExecuteFn;
    const runningFirst = executeFirst('first', { task: 'inspect' });
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(await executeFirst('blocked', { task: 'inspect' })).toMatchObject({
      content: [{ text: expect.stringContaining('maximum concurrent subagents (1)') }],
    });
    const runningSecond = (second.customTools![0].execute as unknown as ToolExecuteFn)('second', {
      task: 'inspect',
    });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending.forEach((reject) => reject(new Error('fixture completed')));
    await Promise.all([runningFirst, runningSecond]);
    expect(
      (extension as unknown as { activeSubagents: Map<string, Set<string>> }).activeSubagents.size
    ).toBe(0);
  });

  it('reuses only completed slots when children finish out of order', async () => {
    mockGetAll.mockReturnValue({
      ...mockGetAll(),
      subagent: { model: '', defaultAgent: '', maxConcurrent: 2, presets: [] },
    });
    const pending: Array<(error: Error) => void> = [];
    mockCreateAgentSession.mockImplementation(
      () => new Promise((_, reject) => pending.push(reject))
    );
    const extension = new SubagentExtension(() => null, noopSend, noopPermission, noopSignal);
    const result = await extension.beforeSessionRun(mockContext as never);
    const execute = result.customTools![0].execute as unknown as ToolExecuteFn;
    const first = execute('first', { task: 'inspect first' });
    const second = execute('second', { task: 'inspect second' });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    const active = (extension as unknown as { activeSubagents: Map<string, Set<string>> })
      .activeSubagents;
    const ids = [...active.get('test-session')!];
    expect(await execute('blocked', { task: 'inspect' })).toMatchObject({
      content: [{ text: expect.stringContaining('maximum concurrent subagents (2)') }],
    });
    pending[1](new Error('second completed'));
    await second;
    expect([...active.get('test-session')!]).toEqual([ids[0]]);
    const third = execute('third', { task: 'inspect third' });
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    expect(active.get('test-session')?.size).toBe(2);
    pending[0](new Error('first completed'));
    await first;
    expect(active.get('test-session')?.size).toBe(1);
    pending[2](new Error('third completed'));
    await third;
    expect(active.size).toBe(0);
    const fourth = execute('fourth', { task: 'inspect fourth' });
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    expect(active.get('test-session')?.size).toBe(1);
    pending[3](new Error('fourth completed'));
    await fourth;
    expect(active.size).toBe(0);
  });

  it('returns child text and emits tool progress through a successful SDK session', async () => {
    let listener: (event: unknown) => void;
    const dispose = vi.fn();
    mockCreateAgentSession.mockResolvedValue({
      session: {
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'file contents' }] }],
        subscribe: (callback: typeof listener) => {
          listener = callback;
          return vi.fn();
        },
        prompt: async () => {
          listener({ type: 'tool_execution_start', toolName: 'read' });
          listener({ type: 'tool_execution_end', toolName: 'read', isError: false });
          listener({
            type: 'agent_end',
            messages: [{ role: 'assistant', content: [{ type: 'text', text: 'file contents' }] }],
          });
        },
        dispose,
      },
    });
    const send = vi.fn();
    const extension = new SubagentExtension(() => null, send, noopPermission, noopSignal);
    const result = await extension.beforeSessionRun(mockContext as never);
    const outcome = await (result.customTools![0].execute as unknown as ToolExecuteFn)('read', {
      task: 'read the file',
      agent: 'reviewer',
    });
    expect(outcome).toMatchObject({ content: [{ text: 'file contents' }] });
    expect(send.mock.calls.map(([event]) => event.payload.event)).toEqual([
      'started',
      'tool_start',
      'tool_end',
      'completed',
    ]);
    expect(dispose).toHaveBeenCalledOnce();
    const loader = mockCreateAgentSession.mock.calls[0][0].resourceLoader;
    const handlers = loader.getExtensions().extensions[0].handlers.get('tool_call');
    expect(await handlers[0]({ toolName: 'read', input: { path: 'watched.txt' } })).toBeUndefined();
  });

  it('surfaces SDK error responses instead of reporting empty success', async () => {
    let listener: (event: unknown) => void;
    mockCreateAgentSession.mockResolvedValue({
      session: {
        messages: [
          { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'Invalid model' },
        ],
        subscribe: (callback: typeof listener) => {
          listener = callback;
          return vi.fn();
        },
        prompt: async () => {
          listener({
            type: 'agent_end',
            messages: [
              {
                role: 'assistant',
                content: [],
                stopReason: 'error',
                errorMessage: 'Invalid model',
              },
            ],
          });
        },
        dispose: vi.fn(),
      },
    });
    const send = vi.fn();
    const deny = vi.fn().mockResolvedValue('deny');
    const extension = new SubagentExtension(() => null, send, deny, noopSignal);
    const result = await extension.beforeSessionRun(mockContext as never);
    const outcome = await (result.customTools![0].execute as unknown as ToolExecuteFn)('error', {
      task: 'read',
    });
    expect(outcome).toMatchObject({ content: [{ text: 'Subagent error: Invalid model' }] });
    expect(send.mock.calls.map(([event]) => event.payload.event)).toEqual(['started', 'failed']);
    const loader = mockCreateAgentSession.mock.calls[0][0].resourceLoader;
    const handlers = loader.getExtensions().extensions[0].handlers.get('tool_call');
    expect(await handlers[0]({ toolName: 'write', input: { path: 'watched.txt' } })).toEqual({
      block: true,
      reason: 'Permission denied by parent session policy',
    });
    expect(deny).toHaveBeenCalledWith('write', { path: 'watched.txt' });
  });
});
