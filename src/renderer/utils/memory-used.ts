import type { MemoryUsedItem, Message, TraceStep } from '../types';

/** A queued or cancelled message never started a run, so it does not mark one. */
function lastRunStart(messages: Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && !message.localStatus) {
      return message.timestamp;
    }
  }
  return Number.NEGATIVE_INFINITY;
}

/**
 * The memory the latest run received. A run that received none saves no memory step, so the last
 * memory step belongs to the latest run only when it is not older than the message that started it.
 */
export function latestMemoryStep(steps: TraceStep[], messages: Message[]): TraceStep | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.type === 'memory') {
      return step.timestamp >= lastRunStart(messages) ? step : undefined;
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
