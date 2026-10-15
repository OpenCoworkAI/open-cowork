import { describe, expect, it, vi } from 'vitest';
import type { MemoryUsedItem } from '../../renderer/types';
import { MemoryExtension } from '../../main/memory/memory-extension';
import type { MemoryService } from '../../main/memory/memory-service';

const item: MemoryUsedItem = {
  scope: 'core',
  category: 'identity',
  key: 'name',
  value: 'Jack',
  userWritten: false,
};

function makeExtension(options: { enabled?: boolean; used?: MemoryUsedItem[] } = {}) {
  const buildPromptContext = vi.fn(async () => ({
    promptPrefix: '<memory_context>…</memory_context>',
    used: options.used ?? [item],
  }));
  const service = {
    isEnabled: () => options.enabled ?? true,
    buildPromptContext,
  } as unknown as MemoryService;
  return { extension: new MemoryExtension(service), buildPromptContext };
}

function context(memoryEnabled = true) {
  return { session: { id: 's1', memoryEnabled }, prompt: 'hello' } as never;
}

describe('MemoryExtension.beforeSessionRun', () => {
  it('returns the prefix and one step listing the memory the run received', async () => {
    const { extension } = makeExtension();

    const result = await extension.beforeSessionRun(context());

    expect(result?.promptPrefix).toBe('<memory_context>…</memory_context>');
    expect(result?.traceSteps).toEqual([
      {
        id: expect.any(String),
        type: 'memory',
        status: 'completed',
        title: 'Memory used',
        memoryItems: [item],
        timestamp: expect.any(Number),
      },
    ]);
  });

  it('adds no step when no memory was injected', async () => {
    const { extension } = makeExtension({ used: [] });

    const result = await extension.beforeSessionRun(context());

    expect(result?.traceSteps).toEqual([]);
  });

  it('does nothing when memory is off globally or for the conversation', async () => {
    const globalOff = makeExtension({ enabled: false });
    const sessionOff = makeExtension();

    expect(await globalOff.extension.beforeSessionRun(context())).toBeUndefined();
    expect(await sessionOff.extension.beforeSessionRun(context(false))).toBeUndefined();
    expect(globalOff.buildPromptContext).not.toHaveBeenCalled();
    expect(sessionOff.buildPromptContext).not.toHaveBeenCalled();
  });
});
