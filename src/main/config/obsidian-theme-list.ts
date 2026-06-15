/**
 * @module main/config/obsidian-theme-list
 *
 * Main-process wrapper around the shared, environment-agnostic obsidian-theme
 * list helpers (see shared/obsidian-theme-list.ts). Wires in a crypto-backed
 * id generator so main-process callers don't have to pass one every time.
 *
 * The pure logic lives in shared/ so the renderer can import the SAME code
 * (with its own id generator) — single source of truth, no drift between
 * main and renderer list behavior.
 */
import * as crypto from 'crypto';
import type { ObsidianImportedTheme } from '../../renderer/types';
import type { IdGenerator } from '../../shared/obsidian-theme-list';

export type { IdGenerator } from '../../shared/obsidian-theme-list';

/** Crypto-backed id generator for use on the main side. */
export const cryptoIdGenerator: IdGenerator = () => crypto.randomBytes(8).toString('hex');

export {
  activateImportedTheme,
  addImportedTheme,
  getActiveThemeCss,
  migrateLegacyObsidianTheme,
  removeImportedTheme,
} from '../../shared/obsidian-theme-list';

// Re-export the type so main callers can reference it from one place.
export type { ObsidianImportedTheme };
