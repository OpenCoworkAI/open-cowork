import { describe, it, expect } from 'vitest';
import enTranslations from '../src/renderer/i18n/locales/en.json';
import zhTranslations from '../src/renderer/i18n/locales/zh.json';

function getAllKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...getAllKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

describe('i18n completeness', () => {
  const enKeys = new Set(getAllKeys(enTranslations));
  const zhKeys = new Set(getAllKeys(zhTranslations));

  it('English translations have all required keys', () => {
    // Check key categories exist
    expect(enKeys.has('common.save')).toBe(true);
    expect(enKeys.has('welcome.title')).toBe(true);
    expect(enKeys.has('settings.title')).toBe(true);
    expect(enKeys.has('sidebar.recents')).toBe(true);
    expect(enKeys.has('chat.sendMessage')).toBe(true);
    expect(enKeys.has('permission.allow')).toBe(true);
  });

  it('English has messageCard keys for queued/cancelled', () => {
    expect(enKeys.has('messageCard.queued')).toBe(true);
    expect(enKeys.has('messageCard.cancelled')).toBe(true);
    expect(enKeys.has('messageCard.copyMessage')).toBe(true);
    expect(enKeys.has('messageCard.locateInFolder')).toBe(true);
  });

  it('English has sidebar.deleteAllConfirm key', () => {
    expect(enKeys.has('sidebar.deleteAllConfirm')).toBe(true);
  });

  it('Chinese has sidebar.deleteAllConfirm key', () => {
    expect(zhKeys.has('sidebar.deleteAllConfirm')).toBe(true);
  });

  it('Chinese has messageCard keys for queued/cancelled', () => {
    expect(zhKeys.has('messageCard.queued')).toBe(true);
    expect(zhKeys.has('messageCard.cancelled')).toBe(true);
    expect(zhKeys.has('messageCard.copyMessage')).toBe(true);
    expect(zhKeys.has('messageCard.locateInFolder')).toBe(true);
  });

  it('all English keys have Chinese translations', () => {
    const missingInZh: string[] = [];
    for (const key of enKeys) {
      if (!zhKeys.has(key)) {
        missingInZh.push(key);
      }
    }
    // Allow some tolerance for pluralization differences
    const realMissing = missingInZh.filter(k => !k.includes('_plural') && !k.includes('_one') && !k.includes('_other'));
    expect(realMissing).toEqual([]);
  });

  it('all Chinese keys have English translations', () => {
    const missingInEn: string[] = [];
    for (const key of zhKeys) {
      if (!enKeys.has(key)) {
        missingInEn.push(key);
      }
    }
    // Filter out pluralization variants and known differences between locale conventions
    const realMissing = missingInEn.filter(k =>
      !k.includes('_plural') && !k.includes('_one') && !k.includes('_other') &&
      // Chinese uses single connectorCount; English uses connectorCount_one/_other
      k !== 'chat.connectorCount'
    );
    expect(realMissing).toEqual([]);
  });

  it('English values do not contain Chinese characters (except language.chinese)', () => {
    const chinesePattern = /[\u4e00-\u9fff]/;
    const enValues = getAllKeys(enTranslations);
    // language.chinese is expected to contain Chinese characters (it's the Chinese language name)
    const exceptions = new Set(['language.chinese']);

    for (const key of enValues) {
      if (exceptions.has(key)) continue;

      const parts = key.split('.');
      let value: any = enTranslations;
      for (const part of parts) {
        value = value[part];
      }
      if (typeof value === 'string') {
        expect(
          chinesePattern.test(value),
          `English key "${key}" contains Chinese characters: "${value}"`
        ).toBe(false);
      }
    }
  });
});
