/**
 * Tests for the AppTheme palette helpers in src/main/config/config-store.
 *
 * Covers:
 *   - isPaletteTheme(): recognizes the seven built-in palettes, rejects garbage
 *   - isAppearance(): recognizes dark/light/system, rejects everything else
 *   - VALID_THEMES membership (ensures validators will accept palettes)
 */
import { describe, it, expect } from 'vitest';
import {
  isPaletteTheme,
  isAppearance,
  THEME_PALETTES,
  VALID_THEMES,
  VALID_APPEARANCES,
  type AppTheme,
} from '../../main/config/config-store';

describe('isPaletteTheme', () => {
  it.each(THEME_PALETTES)('returns true for built-in palette %s', (palette) => {
    expect(isPaletteTheme(palette)).toBe(true);
  });

  it('returns false for the appearance modes', () => {
    expect(isPaletteTheme('light')).toBe(false);
    expect(isPaletteTheme('dark')).toBe(false);
    expect(isPaletteTheme('system')).toBe(false);
  });

  it('returns false for unknown / malformed values', () => {
    expect(isPaletteTheme('dracula')).toBe(false);
    expect(isPaletteTheme('')).toBe(false);
    expect(isPaletteTheme('CLAUDE')).toBe(false); // case-sensitive
    expect(isPaletteTheme('solarized-light')).toBe(false); // legacy id, no longer a palette
  });

  it('narrows the type so palette ids are usable as AppTheme', () => {
    const input: string = 'tokyo-night';
    if (isPaletteTheme(input)) {
      // If the guard works, `input` is assignable to AppTheme without a cast.
      const _theme: AppTheme = input;
      expect(_theme).toBe('tokyo-night');
    } else {
      throw new Error('expected tokyo-night to be recognized as a palette');
    }
  });
});

describe('isAppearance', () => {
  it.each(VALID_APPEARANCES)('returns true for appearance mode %s', (mode) => {
    expect(isAppearance(mode)).toBe(true);
  });

  it('returns false for palettes and unknown values', () => {
    for (const p of THEME_PALETTES) {
      expect(isAppearance(p)).toBe(false);
    }
    expect(isAppearance('dracula')).toBe(false);
    expect(isAppearance('')).toBe(false);
  });
});

describe('VALID_THEMES / persistence integration', () => {
  it('includes every palette so isAppTheme() accepts persisted values', () => {
    for (const p of THEME_PALETTES) {
      expect(VALID_THEMES).toContain(p);
    }
  });

  it('does not carry the legacy dark/light/system ids as palettes', () => {
    // Those modes now live in AppAppearance, not AppTheme.
    expect(VALID_THEMES).not.toContain('dark');
    expect(VALID_THEMES).not.toContain('light');
    expect(VALID_THEMES).not.toContain('system');
    expect(VALID_THEMES).not.toContain('solarized-light');
  });
});
