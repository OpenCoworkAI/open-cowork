import type { MemoryUsedItem, TraceStep } from '../types';

/** Steps arrive in run order, so the last memory step belongs to the latest run. */
export function latestMemoryStep(steps: TraceStep[]): TraceStep | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].type === 'memory') {
      return steps[index];
    }
  }
  return undefined;
}

export function splitMemoryItems(items: MemoryUsedItem[]): {
  core: Extract<MemoryUsedItem, { scope: 'core' }>[];
  experience: Extract<MemoryUsedItem, { scope: 'experience' }>[];
} {
  return {
    core: items.filter((item): item is Extract<MemoryUsedItem, { scope: 'core' }> => {
      return item.scope === 'core';
    }),
    experience: items.filter((item): item is Extract<MemoryUsedItem, { scope: 'experience' }> => {
      return item.scope === 'experience';
    }),
  };
}
