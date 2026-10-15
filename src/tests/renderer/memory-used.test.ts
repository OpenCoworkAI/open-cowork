import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryUsedList } from '../../renderer/components/MemoryUsed';
import type { MemoryUsedItem, TraceStep } from '../../renderer/types';
import { latestMemoryStep, splitMemoryItems } from '../../renderer/utils/memory-used';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const core: MemoryUsedItem = {
  scope: 'core',
  category: 'identity',
  key: 'name',
  value: 'Jack',
  userWritten: false,
};
const written: MemoryUsedItem = { ...core, key: 'city', value: 'Shanghai', userWritten: true };
const experience: MemoryUsedItem = {
  scope: 'experience',
  kind: 'chunk',
  sessionId: 'session-a',
  sessionTitle: 'Gateway fixes',
  workspace: '/repo/a',
  summary: 'Rotated the gateway token',
  expanded: true,
};

function step(id: string, type: TraceStep['type'], memoryItems?: MemoryUsedItem[]): TraceStep {
  return { id, type, status: 'completed', title: id, timestamp: 1, memoryItems };
}

describe('latestMemoryStep', () => {
  it('returns the last memory step, which belongs to the latest run', () => {
    const steps = [
      step('memory-1', 'memory', [core]),
      step('tool-1', 'tool_call'),
      step('memory-2', 'memory', [written]),
      step('tool-2', 'tool_call'),
    ];

    expect(latestMemoryStep(steps)?.id).toBe('memory-2');
  });

  it('returns nothing when the conversation has no memory step', () => {
    expect(latestMemoryStep([step('tool-1', 'tool_call')])).toBeUndefined();
    expect(latestMemoryStep([])).toBeUndefined();
  });
});

describe('splitMemoryItems', () => {
  it('separates core entries from items taken from past conversations', () => {
    expect(splitMemoryItems([core, experience, written])).toEqual({
      core: [core, written],
      experience: [experience],
    });
  });
});

describe('MemoryUsedList', () => {
  const render = (items: MemoryUsedItem[], canOpen = true) =>
    renderToStaticMarkup(
      createElement(MemoryUsedList, {
        items,
        canOpenSession: () => canOpen,
        onOpenSession: () => {},
      })
    );

  it('shows core entries and marks the ones the user wrote', () => {
    const markup = render([core, written]);

    expect(markup).toContain('context.memoryCore');
    expect(markup).toContain('name');
    expect(markup).toContain('Shanghai');
    expect(markup.match(/context\.memoryUserWritten/g)).toHaveLength(1);
    expect(markup).not.toContain('context.memoryExperience');
  });

  it('shows the source conversation, whether it was read in full, and a link to open it', () => {
    const markup = render([experience]);

    expect(markup).toContain('Rotated the gateway token');
    expect(markup).toContain('Gateway fixes');
    expect(markup).toContain('context.memoryExpanded');
    expect(markup).toContain('context.memoryOpenSource');
    expect(markup).not.toContain('context.memoryCore');
  });

  it('leaves out the link when the conversation cannot be opened and names untitled ones', () => {
    const markup = render([{ ...experience, sessionTitle: undefined, expanded: false }], false);

    expect(markup).toContain('context.memoryUntitled');
    expect(markup).not.toContain('context.memoryOpenSource');
    expect(markup).not.toContain('context.memoryExpanded');
  });
});
