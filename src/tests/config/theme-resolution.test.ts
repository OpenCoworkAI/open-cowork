/**
 * Tests for the pure theme-resolution helpers in
 * src/main/config/theme-resolution.
 *
 * These were previously private functions inside main/index.ts (untestable
 * without booting Electron). Extracted so the palette/appearance mapping
 * is unit-covered.
 *
 * The model now has two orthogonal axes:
 *   - palette (AppTheme): which color palette
 *   - appearance (AppAppearance): dark / light / system
 *
 * Covers:
 *   - getSavedAppearance: accepts known modes, rejects garbage
 *   - getSavedPalette: accepts known palettes, rejects garbage/legacy ids
 *   - resolveEffectiveAppearance: resolves each mode; 'system' honors the
 *     passed OS preference
 *   - resolveNativeThemeSource: maps to the three nativeTheme.themeSource values
 */
import { describe, it, expect } from 'vitest';
import {
  getSavedAppearance,
  getSavedPalette,
  resolveEffectiveAppearance,
  resolveNativeThemeSource,
} from '../../main/config/theme-resolution';
import { THEME_PALETTES, VALID_APPEARANCES } from '../../main/config/config-store';

describe('getSavedAppearance', () => {
  it.each(VALID_APPEARANCES)('passes known appearance %s through unchanged', (mode) => {
    expect(getSavedAppearance(mode)).toBe(mode);
  });

  it('coerces garbage to the system default', () => {
    expect(getSavedAppearance('dracula')).toBe('system');
    expect(getSavedAppearance('')).toBe('system');
    expect(getSavedAppearance(undefined)).toBe('system');
    expect(getSavedAppearance(123)).toBe('system');
  });
});

describe('getSavedPalette', () => {
  it.each(THEME_PALETTES)('passes known palette %s through unchanged', (palette) => {
    expect(getSavedPalette(palette)).toBe(palette);
  });

  it('coerces legacy mode ids and garbage to the claude default', () => {
    expect(getSavedPalette('dark')).toBe('claude');
    expect(getSavedPalette('light')).toBe('claude');
    expect(getSavedPalette('system')).toBe('claude');
    expect(getSavedPalette('dracula')).toBe('claude');
    expect(getSavedPalette(undefined)).toBe('claude');
  });

  it('migrates the renamed legacy solarized-light id to solarized', () => {
    expect(getSavedPalette('solarized-light')).toBe('solarized');
  });
});

describe('resolveEffectiveAppearance', () => {
  it('resolves the explicit modes regardless of OS pref', () => {
    expect(resolveEffectiveAppearance('dark', false)).toBe('dark');
    expect(resolveEffectiveAppearance('dark', true)).toBe('dark');
    expect(resolveEffectiveAppearance('light', false)).toBe('light');
    expect(resolveEffectiveAppearance('light', true)).toBe('light');
  });

  it('resolves "system" from the passed OS preference', () => {
    expect(resolveEffectiveAppearance('system', true)).toBe('dark');
    expect(resolveEffectiveAppearance('system', false)).toBe('light');
  });
});

describe('resolveNativeThemeSource', () => {
  it('maps each appearance to the matching nativeTheme.themeSource value', () => {
    expect(resolveNativeThemeSource('dark')).toBe('dark');
    expect(resolveNativeThemeSource('light')).toBe('light');
    expect(resolveNativeThemeSource('system')).toBe('system');
  });
});
