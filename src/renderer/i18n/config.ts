import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enTranslations from './locales/en.json';
import zhTranslations from './locales/zh.json';
import deTranslations from './locales/de.json';

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
      de: {
        translation: deTranslations,
      },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh', 'de'],
    interpolation: {
      escapeValue: false, // React 已经处理了 XSS
    },
    pluralSeparator: '_', // 复数分隔符
    contextSeparator: '_', // 上下文分隔符
    detection: {
      order: ['localStorage', 'navigator'], // 先检查 localStorage，再检查浏览器语言
      caches: ['localStorage'], // 将语言选择保存到 localStorage
      lookupLocalStorage: 'i18nextLng', // localStorage key
    },
  });

export default i18n;
