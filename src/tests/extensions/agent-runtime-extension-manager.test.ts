import { describe, expect, it } from 'vitest';
import type { TraceStep } from '../../renderer/types';
import type { AgentRuntimeExtension } from '../../main/extensions/agent-runtime-extension';
import { AgentRuntimeExtensionManager } from '../../main/extensions/agent-runtime-extension-manager';

function step(id: string): TraceStep {
  return { id, type: 'memory', status: 'completed', title: id, timestamp: 1 };
}

const context = {
  session: { id: 's1' },
  prompt: 'hello',
  existingMessages: [],
  isColdStart: true,
} as never;

describe('AgentRuntimeExtensionManager.beforeSessionRun', () => {
  it('collects the trace steps of every extension in registration order', async () => {
    const manager = new AgentRuntimeExtensionManager([
      { name: 'a', beforeSessionRun: async () => ({ traceSteps: [step('a1'), step('a2')] }) },
      { name: 'b', beforeSessionRun: async () => ({ promptPrefix: 'prefix' }) },
      { name: 'c', beforeSessionRun: async () => ({ traceSteps: [step('c1')] }) },
    ] satisfies AgentRuntimeExtension[]);

    const result = await manager.beforeSessionRun(context);

    expect(result.traceSteps?.map((item) => item.id)).toEqual(['a1', 'a2', 'c1']);
    expect(result.promptPrefix).toBe('prefix');
  });

  it('leaves trace steps unset when no extension returns any', async () => {
    const manager = new AgentRuntimeExtensionManager([
      { name: 'a', beforeSessionRun: async () => ({ traceSteps: [] }) },
      { name: 'b', beforeSessionRun: async () => undefined },
    ] satisfies AgentRuntimeExtension[]);

    const result = await manager.beforeSessionRun(context);

    expect(result.traceSteps).toBeUndefined();
  });
});
