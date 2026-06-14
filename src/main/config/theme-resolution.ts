/**
 * @module main/config/theme-resolution
 *
 * Pure helpers that map a persisted AppTheme (which may be a classic
 * dark/light/system mode or a named palette like 'tokyo-night') to the
 * values the Electron main process actually needs:
 *
 *   - the effective light/dark identity (for window background color)
 *   - the nativeTheme.themeSource value (dark | light | system)
 *
 * Extracted from main/index.ts so they can be unit-tested without booting
 * the full Electron main process. The only impure input — the OS's current
 * dark-color preference, used to resolve 'system' — is passed in as an
 * argument by the caller.
 */
import { isLightTheme, isPaletteTheme, type AppTheme } from './config-store';

/**
 * Accept the persisted theme if it is a known mode or palette; otherwise
 * fall back to 'light' (matching the historical default).
 */
export function getSavedThemePreference(raw: AppTheme): AppTheme {
  if (raw === 'dark' || raw === 'light' || raw === 'system' || isPaletteTheme(raw)) {
    return raw;
  }
  return 'light';
}

/**
 * Resolve any AppTheme to its effective light/dark identity.
 * `systemPrefersDark` is the OS-level preference (nativeTheme.shouldUseDarkColors)
 * passed in by the caller to keep this function pure.
 */
export function resolveEffectiveTheme(
  theme: AppTheme,
  systemPrefersDark: boolean
): 'dark' | 'light' {
  if (theme === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return isLightTheme(theme) ? 'light' : 'dark';
}

/**
 * Map any AppTheme to the value nativeTheme.themeSource understands.
 * Palettes collapse to their underlying dark/light mode so native widgets
 * (context menus, scrollbars, dialog chrome) match the chosen palette.
 */
export function resolveNativeThemeSource(theme: AppTheme): 'system' | 'dark' | 'light' {
  if (theme === 'system') return 'system';
  return isLightTheme(theme) ? 'light' : 'dark';
}
