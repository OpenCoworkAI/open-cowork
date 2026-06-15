/**
 * @module main/config/theme-resolution
 *
 * Pure helpers that map persisted theme settings onto the values the
 * Electron main process needs:
 *
 *   - the effective light/dark identity (for window background color)
 *   - the nativeTheme.themeSource value (dark | light | system)
 *
 * The theme model has two orthogonal axes:
 *   - `theme` (AppTheme): which color palette ('claude', 'nordic', ...)
 *   - `appearance` (AppAppearance): dark / light / system
 *
 * The palette choice has no effect on light/dark anymore — that's purely the
 * appearance axis. The palette only affects which CSS variables the renderer
 * loads (handled in the renderer via `.theme-<palette>` + `.light`/`.dark`
 * classes on <html>).
 *
 * Extracted from main/index.ts so these can be unit-tested without booting
 * the full Electron main process. The only impure input — the OS dark-color
 * preference, used to resolve 'system' — is passed in as an argument.
 */
import { isAppearance, type AppAppearance, type AppTheme } from './config-store';

/**
 * Normalize a persisted appearance value. Accepts known modes; otherwise
 * falls back to 'system' (matching the default).
 */
export function getSavedAppearance(raw: unknown): AppAppearance {
  return isAppearance(raw) ? raw : 'system';
}

/**
 * Normalize a persisted palette (theme) value. Accepts known palettes;
 * otherwise maps any renamed legacy id ('solarized-light' -> 'solarized')
 * and finally falls back to 'claude' (the default).
 */
export function getSavedPalette(raw: AppTheme | string | undefined): AppTheme {
  const KNOWN: AppTheme[] = [
    'claude',
    'nordic',
    'tokyo-night',
    'gruvbox',
    'catppuccin',
    'rose-pine',
    'solarized',
  ];
  const LEGACY: Record<string, AppTheme> = { 'solarized-light': 'solarized' };
  if ((KNOWN as string[]).includes(raw as string)) return raw as AppTheme;
  if (typeof raw === 'string' && LEGACY[raw]) return LEGACY[raw];
  return 'claude';
}

/**
 * Resolve an appearance setting to its effective light/dark identity.
 * `systemPrefersDark` is the OS-level preference (nativeTheme.shouldUseDarkColors)
 * passed in by the caller to keep this function pure.
 */
export function resolveEffectiveAppearance(
  appearance: AppAppearance,
  systemPrefersDark: boolean
): 'dark' | 'light' {
  if (appearance === 'system') return systemPrefersDark ? 'dark' : 'light';
  return appearance;
}

/**
 * Map an appearance setting to the value nativeTheme.themeSource understands.
 * The palette axis is irrelevant here — native widgets only care about
 * light/dark/system.
 */
export function resolveNativeThemeSource(appearance: AppAppearance): 'system' | 'dark' | 'light' {
  return appearance;
}
