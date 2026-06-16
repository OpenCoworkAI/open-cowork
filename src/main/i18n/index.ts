// Main-process (backend) translator.
//
// The renderer owns the active UI language (react-i18next) and mirrors it into
// the config store as `uiLanguage`; the main process reads that value and calls
// `setBackendLanguage()` so backend-produced strings (errors, dialogs, the
// default config-set name) match what the user picked. Chinese is the default
// and the ultimate fallback — the product is Chinese-first.

import { backendCatalog, DEFAULT_BACKEND_LANGUAGE, type BackendMessageKey } from './catalog';

export { DEFAULT_BACKEND_LANGUAGE } from './catalog';
export type { BackendMessageKey } from './catalog';

let currentLanguage: string = DEFAULT_BACKEND_LANGUAGE;

/**
 * Normalize an arbitrary locale tag to one of our catalog keys:
 * strip the region (`es-ES` -> `es`, `zh-CN` -> `zh`) and fold the Norwegian
 * variants (`nb`/`nn`) onto the shipped `no` table. Returns the default
 * language when the result isn't in the catalog.
 */
function normalizeBackendLanguage(lang: string | undefined | null): string {
  if (!lang) return DEFAULT_BACKEND_LANGUAGE;
  const base = lang.toLowerCase().split(/[-_]/)[0];
  const folded = base === 'nb' || base === 'nn' ? 'no' : base;
  return backendCatalog[folded] ? folded : DEFAULT_BACKEND_LANGUAGE;
}

/** Update the language used by mt(). Safe to call repeatedly. */
export function setBackendLanguage(lang: string | undefined | null): void {
  currentLanguage = normalizeBackendLanguage(lang);
}

/** The language mt() is currently translating into. */
export function getBackendLanguage(): string {
  return currentLanguage;
}

/**
 * Translate a backend message key into the active language, falling back to the
 * default (Chinese) table and finally to the key itself. `params` are
 * interpolated into `{{name}}` placeholders.
 */
export function mt(key: BackendMessageKey, params?: Record<string, string | number>): string {
  const table = backendCatalog[currentLanguage] ?? backendCatalog[DEFAULT_BACKEND_LANGUAGE];
  const template =
    table?.[key] ?? backendCatalog[DEFAULT_BACKEND_LANGUAGE]?.[key] ?? (key as string);
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}
