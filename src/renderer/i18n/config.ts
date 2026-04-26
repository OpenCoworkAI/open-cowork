import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enTranslations from './locales/en.json';
import zhTranslations from './locales/zh.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: enTranslations,
      },
      zh: {
        translation: zhTranslations,
      },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh'],
    interpolation: {
      escapeValue: false,
    },
    pluralSeparator: '_',
    contextSeparator: '_',
    detection: {
      order: ['navigator', 'htmlTag', 'localStorage'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
      htmlTag: document.documentElement,
      navigator: {
        layouts: ['en', 'zh'],
      },
    },
  });

export default i18n;

export async function changeLanguage(lng: string): Promise<void> {
  if (lng !== 'en' && lng !== 'zh') {
    console.warn(`[i18n] Unsupported language: ${lng}. Falling back to 'en'.`);
    lng = 'en';
  }
  await i18n.changeLanguage(lng);
}

export function getCurrentLanguage(): string {
  return i18n.language;
}

export function getSupportedLanguages(): Array<{ code: string; name: string }> {
  return [
    { code: 'en', name: 'English' },
    { code: 'zh', name: '中文' },
  ];
}
