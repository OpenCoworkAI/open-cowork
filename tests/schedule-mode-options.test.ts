import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { getScheduleModeOptions } from '../src/renderer/components/settings/shared';

const t = ((key: string) => key) as TFunction;

describe('schedule mode options', () => {
  it('keeps the ordinary schedule options unchanged', () => {
    expect(getScheduleModeOptions(t).map((option) => option.value)).toEqual([
      'once',
      'daily',
      'weekly',
    ]);
  });

  it('offers repeating modes for conditional tasks', () => {
    expect(
      getScheduleModeOptions(t, 'legacy-interval', true).map((option) => option.value)
    ).toEqual(['daily', 'weekly', 'legacy-interval']);
  });

  it('preserves the selected interval when the condition is removed', () => {
    expect(getScheduleModeOptions(t, 'legacy-interval', false)).toContainEqual({
      value: 'legacy-interval',
      label: 'schedule.watchInterval',
    });
  });

  it('keeps an existing interval task selectable when editing', () => {
    const options = getScheduleModeOptions(t, 'legacy-interval');
    expect(options.map((option) => option.value)).toContain('once');
    expect(options.find((option) => option.value === 'legacy-interval')?.label).toBeTruthy();
  });
});
