/**
 * Tests for the pure theme-resolution helpers in
 * src/main/config/theme-resolution.
 *
 * These were previously private functions inside main/index.ts (untestable
 * without booting Electron). Extracted so the palette → native-theme mapping
 * is unit-covered, as requested in PR review.
 *
 * Covers:
 *   - getSavedThemePreference: accepts known modes + palettes, rejects garbage
 *   - resolveEffectiveTheme: every palette resolves to dark/light correctly,
 *     'system' honors the passed OS preference
 *   - resolveNativeThemeSource: maps to the three nativeTheme.themeSource
 *     values, with palettes collapsing to their underlying mode
 */
import { describe, it, expect } from 'vitest';
import {
  getSavedThemePreference,
  resolveEffectiveTheme,
  resolveNativeThemeSource,
} from '../../main/config/theme-resolution';
import { THEME_PALETTES } from '../../main/config/config-store';

describe('getSavedThemePreference', () => {
  it.each(['dark', 'light', 'system', ...THEME_PALETTES] as const)(
    'passes known theme %s through unchanged',
    (theme) => {
      expect(getSavedThemePreference(theme)).toBe(theme);
    }
  );

  it('coerces garbage strings to the light default', () => {
    // The function accepts AppTheme, so we cast to exercise the fallback path.
    expect(getSavedThemePreference('dracula' as never)).toBe('light');
    expect(getSavedThemePreference('' as never)).toBe('light');
    expect(getSavedThemePreference('Nordic' as never)).toBe('light');
  });
});

describe('resolveEffectiveTheme', () => {
  it('resolves the classic modes', () => {
    expect(resolveEffectiveTheme('dark', false)).toBe('dark');
    expect(resolveEffectiveTheme('dark', true)).toBe('dark');
    expect(resolveEffectiveTheme('light', false)).toBe('light');
    expect(resolveEffectiveTheme('light', true)).toBe('light');
  });

  it('resolves "system" from the passed OS preference', () => {
    expect(resolveEffectiveTheme('system', true)).toBe('dark');
    expect(resolveEffectiveTheme('system', false)).toBe('light');
  });

  it('resolves every dark palette to dark regardless of OS pref', () => {
    const darkPalettes = THEME_PALETTES.filter((p) => p !== 'solarized-light');
    for (const p of darkPalettes) {
      expect(resolveEffectiveTheme(p, false)).toBe('dark');
      expect(resolveEffectiveTheme(p, true)).toBe('dark');
    }
  });

  it('resolves solarized-light to light regardless of OS pref', () => {
    expect(resolveEffectiveTheme('solarized-light', false)).toBe('light');
    expect(resolveEffectiveTheme('solarized-light', true)).toBe('light');
  });
});

describe('resolveNativeThemeSource', () => {
  it('passes "system" through for native themeSource', () => {
    expect(resolveNativeThemeSource('system')).toBe('system');
  });

  it('maps light/dark modes to themselves', () => {
    expect(resolveNativeThemeSource('light')).toBe('light');
    expect(resolveNativeThemeSource('dark')).toBe('dark');
  });

  it('collapses every dark palette to "dark"', () => {
    const darkPalettes = THEME_PALETTES.filter((p) => p !== 'solarized-light');
    for (const p of darkPalettes) {
      expect(resolveNativeThemeSource(p)).toBe('dark');
    }
  });

  it('collapses solarized-light to "light"', () => {
    expect(resolveNativeThemeSource('solarized-light')).toBe('light');
  });
});
