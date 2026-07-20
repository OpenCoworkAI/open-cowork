#!/usr/bin/env node
// Usage: node scripts/i18n/apply_translations.js <localeCode> <translatedBatchFile.json>
const path = require('path');
const { readJson, writeJson, flatten, setAtPath } = require('./_util');

const code = process.argv[2];
const batchFile = process.argv[3];
if (!code || !batchFile) {
  console.error('Usage: node apply_translations.js <localeCode> <translatedBatchFile.json>');
  process.exit(1);
}

const localesDir = path.resolve(__dirname, '../../src/renderer/i18n/locales');
const localePath = path.join(localesDir, `${code}.json`);
const locale = readJson(localePath);
const enFlat = flatten(readJson(path.join(localesDir, 'en.json')));
const translations = readJson(path.resolve(batchFile));

const notFound = [];
let applied = 0;
for (const [key, value] of Object.entries(translations)) {
  if (!(key in enFlat)) {
    notFound.push(key);
    continue;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    console.warn(`Skipping empty/non-string translation for ${key}`);
    continue;
  }
  setAtPath(locale, key, value);
  applied++;
}

writeJson(localePath, locale);
console.log(`${code}: applied ${applied} translations.`);
if (notFound.length) {
  console.warn(`${code}: ${notFound.length} keys not found in en.json (skipped):`, notFound);
}