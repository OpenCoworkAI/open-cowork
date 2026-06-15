/**
 * @module shared/obsidian-theme-list
 *
 * Pure, environment-agnostic helpers for managing the user's collection of
 * imported Obsidian themes. Imported by BOTH the main process and the
 * renderer, so it must not depend on Node-only APIs (no `crypto`, no `fs`).
 *
 * The persistent state is two config fields:
 *   - `obsidianThemes: ObsidianImportedTheme[]` — every imported theme.
 *   - `activeObsidianThemeId: string | null` — which one (if any) is live.
 *
 * The id generator is INJECTED (every function that would create a new theme
 * takes a `genId` arg) so this module stays renderer-safe. Callers pass a
 * crypto-backed generator on the main side and `crypto.randomUUID` (browser
 * global, available in the renderer) on the renderer side.
 *
 * ## Migration
 *
 * The original implementation stored a single imported theme as
 * `obsidianThemeCss: string`. `migrateLegacyObsidianTheme` lifts it into a
 * one-element list and marks it active, so existing users keep their theme.
 */
import type { ObsidianImportedTheme } from '../renderer/types';

/** Injected id generator. Returns an opaque string. */
export type IdGenerator = () => string;

/**
 * Add a theme to the list. If a theme with the same `name` already exists,
 * it is REPLACED (re-importing updates in place rather than creating a
 * duplicate). Returns the new list and the id of the added theme.
 *
 * The newly-added theme is NOT auto-activated — the caller decides whether
 * to flip `activeObsidianThemeId`.
 */
export function addImportedTheme(
  list: ObsidianImportedTheme[],
  theme: { name: string; css: string },
  genId: IdGenerator
): { list: ObsidianImportedTheme[]; id: string } {
  const id = genId();
  const entry: ObsidianImportedTheme = { id, name: theme.name, css: theme.css };
  // Replace an existing theme of the same name (re-import = update).
  const filtered = list.filter((t) => t.name !== theme.name);
  return { list: [...filtered, entry], id };
}

/**
 * Remove a theme by id. If the removed theme was active, `activeId` is
 * cleared to null.
 */
export function removeImportedTheme(
  list: ObsidianImportedTheme[],
  activeId: string | null,
  idToRemove: string
): { list: ObsidianImportedTheme[]; activeId: string | null } {
  return {
    list: list.filter((t) => t.id !== idToRemove),
    activeId: activeId === idToRemove ? null : activeId,
  };
}

/**
 * Activate a theme by id. Pass `null` to deactivate (use the built-in
 * palettes only). Returns the new activeId unchanged if the id isn't in the
 * list (defensive — don't set an activeId pointing at nothing).
 */
export function activateImportedTheme(
  list: ObsidianImportedTheme[],
  activeId: string | null,
  idToActivate: string | null
): string | null {
  if (idToActivate === null) return null;
  return list.some((t) => t.id === idToActivate) ? idToActivate : activeId;
}

/**
 * Migrate the legacy single-theme storage to the new list storage.
 *
 * - If `legacyCss` is empty/whitespace, returns the inputs unchanged.
 * - If a list is already present and non-empty, does nothing (the new field
 *   wins; we don't double-import).
 * - Otherwise lifts `legacyCss` into a one-element list with the given name
 *   (defaulting to "Imported theme" if none) and marks it active.
 */
export function migrateLegacyObsidianTheme(args: {
  legacyCss: string;
  legacyName?: string;
  list: ObsidianImportedTheme[];
  activeId: string | null;
  genId: IdGenerator;
}): { list: ObsidianImportedTheme[]; activeId: string | null; migrated: boolean } {
  const { legacyCss, legacyName, list, activeId, genId } = args;
  if (!legacyCss.trim()) return { list, activeId, migrated: false };
  if (list.length > 0) return { list, activeId, migrated: false };
  const id = genId();
  const entry: ObsidianImportedTheme = {
    id,
    name: legacyName?.trim() || 'Imported theme',
    css: legacyCss,
  };
  return { list: [entry], activeId: id, migrated: true };
}

/** Look up the active theme's CSS, or null if none is active. */
export function getActiveThemeCss(
  list: ObsidianImportedTheme[],
  activeId: string | null
): string | null {
  if (!activeId) return null;
  const found = list.find((t) => t.id === activeId);
  return found ? found.css : null;
}
