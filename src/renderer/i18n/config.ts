import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enTranslations from './locales/en.json';
import zhTranslations from './locales/zh.json';

i18n
  .use(LanguageDetector) // 
  .use(initReactI18next) //  react-i18next
  .init({
    resources: {
      en: {
        translation: enTranslations,
      },
      zh: {
        translation: zhTranslations,
      },
    },
    fallbackLng: 'en', // 
    supportedLngs: ['en', 'zh'], // 
    interpolation: {
      escapeValue: false, // React  XSS
    },
    pluralSeparator: '_', // 
    contextSeparator: '_', // 
    detection: {
      order: ['localStorage', 'navigator'], //  localStorage
      caches: ['localStorage'], //  localStorage
      lookupLocalStorage: 'i18nextLng', // localStorage key
    },
  });

export default i18n;
