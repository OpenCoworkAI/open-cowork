/**
 * Tests for the AppTheme palette helpers in src/main/config/config-store.
 *
 * Covers:
 *   - isPaletteTheme(): recognizes the six built-in palettes, rejects modes/garbage
 *   - isLightTheme(): classifies light vs dark for modes and palettes
 *   - VALID_THEMES membership (ensures validators will accept palettes)
 */
import { describe, it, expect } from 'vitest';
import {
  isPaletteTheme,
  isLightTheme,
  THEME_PALETTES,
  VALID_THEMES,
  type AppTheme,
} from '../../main/config/config-store';

describe('isPaletteTheme', () => {
  it.each(THEME_PALETTES)('returns true for built-in palette %s', (palette) => {
    expect(isPaletteTheme(palette)).toBe(true);
  });

  it('returns false for the classic light/dark/system modes', () => {
    expect(isPaletteTheme('light')).toBe(false);
    expect(isPaletteTheme('dark')).toBe(false);
    expect(isPaletteTheme('system')).toBe(false);
  });

  it('returns false for unknown / malformed values', () => {
    expect(isPaletteTheme('dracula')).toBe(false);
    expect(isPaletteTheme('')).toBe(false);
    expect(isPaletteTheme('NORDIC')).toBe(false); // case-sensitive
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

describe('isLightTheme', () => {
  it('classifies the classic modes', () => {
    expect(isLightTheme('light')).toBe(true);
    expect(isLightTheme('dark')).toBe(false);
    // 'system' defers to the OS — main/index.ts resolves it; here it is dark
    // by convention so window-bg selection picks the dark fallback.
    expect(isLightTheme('system')).toBe(false);
  });

  it('classifies solarized-light as the only light palette', () => {
    expect(isLightTheme('solarized-light')).toBe(true);
  });

  it('classifies every other palette as dark', () => {
    const darkPalettes = THEME_PALETTES.filter((p) => p !== 'solarized-light');
    for (const p of darkPalettes) {
      expect(isLightTheme(p)).toBe(false);
    }
  });
});

describe('VALID_THEMES / persistence integration', () => {
  it('includes every palette so isAppTheme() accepts persisted values', () => {
    for (const p of THEME_PALETTES) {
      expect(VALID_THEMES).toContain(p);
    }
  });

  it('still contains the classic modes for backward compatibility', () => {
    expect(VALID_THEMES).toContain('dark');
    expect(VALID_THEMES).toContain('light');
    expect(VALID_THEMES).toContain('system');
  });
});
