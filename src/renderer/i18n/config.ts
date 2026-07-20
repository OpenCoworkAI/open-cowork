import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enTranslations from './locales/en.json';
import zhTranslations from './locales/zh.json';
import arTranslations from './locales/ar.json';
import ptBRTranslations from './locales/pt-BR.json';
import bsTranslations from './locales/bs.json';
import daTranslations from './locales/da.json';
import deTranslations from './locales/de.json';
import esTranslations from './locales/es.json';
import frTranslations from './locales/fr.json';
import jaTranslations from './locales/ja.json';
import koTranslations from './locales/ko.json';
import nbTranslations from './locales/nb.json';
import plTranslations from './locales/pl.json';
import ruTranslations from './locales/ru.json';
import thTranslations from './locales/th.json';
import trTranslations from './locales/tr.json';
import zhTWTranslations from './locales/zh-TW.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: enTranslations },
      zh: { translation: zhTranslations },
      ar: { translation: arTranslations },
      'pt-BR': { translation: ptBRTranslations },
      bs: { translation: bsTranslations },
      da: { translation: daTranslations },
      de: { translation: deTranslations },
      es: { translation: esTranslations },
      fr: { translation: frTranslations },
      ja: { translation: jaTranslations },
      ko: { translation: koTranslations },
      nb: { translation: nbTranslations },
      pl: { translation: plTranslations },
      ru: { translation: ruTranslations },
      th: { translation: thTranslations },
      tr: { translation: trTranslations },
      'zh-TW': { translation: zhTWTranslations },
    },
    fallbackLng: 'en',
    supportedLngs: [
      'en', 'zh', 'ar', 'pt-BR', 'bs', 'da', 'de', 'es', 'fr',
      'ja', 'ko', 'nb', 'pl', 'ru', 'th', 'tr', 'zh-TW',
    ],
    interpolation: {
      escapeValue: false,
    },
    pluralSeparator: '_',
    contextSeparator: '_',
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  });

export default i18n;