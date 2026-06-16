import { afterEach, describe, expect, it } from 'vitest';

import {
  backendCatalog,
  DEFAULT_BACKEND_LANGUAGE,
  SUPPORTED_BACKEND_LANGUAGES,
  type BackendMessageKey,
} from '../../main/i18n/catalog';
import { getBackendLanguage, mt, setBackendLanguage } from '../../main/i18n';

// setBackendLanguage mutates module state; restore the default after each test.
afterEach(() => setBackendLanguage(DEFAULT_BACKEND_LANGUAGE));

describe('backend i18n catalog', () => {
  const zhKeys = Object.keys(backendCatalog.zh).sort();

  it('defaults to Chinese (the project is Chinese-first)', () => {
    expect(DEFAULT_BACKEND_LANGUAGE).toBe('zh');
  });

  it('every supported language has exactly the same keys as the zh source', () => {
    for (const lang of SUPPORTED_BACKEND_LANGUAGES) {
      expect(backendCatalog[lang], `missing table for ${lang}`).toBeDefined();
      expect(Object.keys(backendCatalog[lang]).sort(), `key drift in ${lang}`).toEqual(zhKeys);
    }
  });

  it('preserves placeholders and underscores in every translation', () => {
    for (const lang of SUPPORTED_BACKEND_LANGUAGES) {
      const table = backendCatalog[lang];
      expect(table.errBadRequest, `${lang} errBadRequest`).toContain('{{error}}');
      expect(table.startupFailedBody, `${lang} startupFailedBody`).toContain('{{message}}');
      expect(table.configFallbackSetName, `${lang} configFallbackSetName`).toContain('{{index}}');
      expect(table.errCheckConfigHint.startsWith('_'), `${lang} hint italics`).toBe(true);
      expect(table.errCheckConfigHint.endsWith('_'), `${lang} hint italics`).toBe(true);
    }
  });
});

describe('mt()', () => {
  it('translates into the active language', () => {
    setBackendLanguage('en');
    expect(getBackendLanguage()).toBe('en');
    expect(mt('startupFailedTitle')).toBe('Open Cowork failed to start');
    setBackendLanguage('zh');
    expect(mt('startupFailedTitle')).toBe('Open Cowork 启动失败');
  });

  it('interpolates {{params}} and leaves none behind', () => {
    setBackendLanguage('en');
    const out = mt('errBadRequest', { error: 'boom-detail' });
    expect(out).toContain('boom-detail');
    expect(out).not.toContain('{{error}}');
  });

  it('normalizes region variants and Norwegian forms to a catalog table', () => {
    setBackendLanguage('es-ES');
    expect(getBackendLanguage()).toBe('es');
    setBackendLanguage('zh-CN');
    expect(getBackendLanguage()).toBe('zh');
    setBackendLanguage('nb-NO');
    expect(getBackendLanguage()).toBe('no');
    setBackendLanguage('nn');
    expect(getBackendLanguage()).toBe('no');
  });

  it('falls back to the default language for unknown locales', () => {
    setBackendLanguage('xx-YY');
    expect(getBackendLanguage()).toBe(DEFAULT_BACKEND_LANGUAGE);
    expect(mt('configDefaultSetName')).toBe(backendCatalog.zh.configDefaultSetName);
  });

  it('falls back to the key name for an unknown key', () => {
    setBackendLanguage('en');
    expect(mt('not_a_real_key' as BackendMessageKey)).toBe('not_a_real_key');
  });
});
