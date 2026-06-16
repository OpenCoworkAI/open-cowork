import { describe, it, expect } from 'vitest';
import {
  getGreetingBucket,
  getGreetingBucketForDate,
  pickVariationIndex,
  buildGreeting,
} from '../../shared/greeting';

describe('getGreetingBucket', () => {
  it.each([
    [0, 'night'],
    [4, 'night'],
    [5, 'morning'],
    [8, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [16, 'afternoon'],
    [17, 'evening'],
    [21, 'evening'],
    [22, 'night'],
    [23, 'night'],
  ])('maps hour %i to %s', (hour, expected) => {
    expect(getGreetingBucket(hour)).toBe(expected);
  });

  it('wraps out-of-range hours into 0–23', () => {
    expect(getGreetingBucket(-1)).toBe('night'); // → 23
    expect(getGreetingBucket(25)).toBe('night'); // 25 % 24 = 1 → night
    expect(getGreetingBucket(29)).toBe('morning'); // 29 % 24 = 5 → morning
  });
});

describe('getGreetingBucketForDate', () => {
  it('reads the hour off a Date', () => {
    expect(getGreetingBucketForDate(new Date('2026-01-01T09:00:00'))).toBe('morning');
    expect(getGreetingBucketForDate(new Date('2026-01-01T20:00:00'))).toBe('evening');
  });
});

describe('pickVariationIndex', () => {
  it('returns 0 when count is 0 or negative', () => {
    expect(pickVariationIndex('morning', 0)).toBe(0);
    expect(pickVariationIndex('morning', -3)).toBe(0);
  });

  it('always returns a value within [0, count)', () => {
    for (let i = 0; i < 50; i++) {
      const idx = pickVariationIndex('afternoon', 3);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(3);
    }
  });

  it('is stable for the same day + bucket (no flicker across renders)', () => {
    const date = new Date('2026-06-16T10:00:00');
    const a = pickVariationIndex('morning', 5, date);
    const b = pickVariationIndex('morning', 5, date);
    expect(a).toBe(b);
  });

  it('honors an explicit seed override (for tests)', () => {
    expect(pickVariationIndex('morning', 4, new Date(), 0)).toBe(0);
    expect(pickVariationIndex('morning', 4, new Date(), 5)).toBe(1);
    expect(pickVariationIndex('morning', 4, new Date(), 7)).toBe(3);
  });
});

describe('buildGreeting', () => {
  const variations = ['Good morning', 'Morning!', 'Rise and shine'] as const;

  it('picks the variation at the given index', () => {
    expect(buildGreeting({ bucket: 'morning', variations, variationIndex: 0 })).toBe(
      'Good morning'
    );
    expect(buildGreeting({ bucket: 'morning', variations, variationIndex: 2 })).toBe(
      'Rise and shine'
    );
  });

  it('wraps the index modulo length', () => {
    expect(buildGreeting({ bucket: 'morning', variations, variationIndex: 3 })).toBe(
      'Good morning'
    );
  });

  it('falls back when variations is empty', () => {
    expect(buildGreeting({ bucket: 'morning', variations: [], variationIndex: 0 })).toBe('Hello');
    expect(
      buildGreeting({ bucket: 'morning', variations: [], variationIndex: 0, fallback: 'Hi' })
    ).toBe('Hi');
  });

  it('uses the generic fallback for the night bucket (no "good night")', () => {
    expect(
      buildGreeting({
        bucket: 'night',
        variations: ['Good night', 'Sleep well'] as const,
        variationIndex: 0,
      })
    ).toBe('Hello');
  });

  it('wraps the phrasing with the name when provided', () => {
    expect(
      buildGreeting({
        bucket: 'morning',
        variations,
        variationIndex: 0,
        name: 'Sam',
        withName: (g, n) => `${g}, ${n}`,
      })
    ).toBe('Good morning, Sam');
  });

  it('ignores a blank/whitespace name', () => {
    expect(
      buildGreeting({
        bucket: 'morning',
        variations,
        variationIndex: 0,
        name: '   ',
        withName: (g, n) => `${g}, ${n}`,
      })
    ).toBe('Good morning');
  });
});
