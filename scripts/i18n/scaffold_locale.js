#!/usr/bin/env node
// Usage: node scripts/i18n/scaffold_locale.js <localeCode>
const path = require('path');
const fs = require('fs');
const { readJson, writeJson } = require('./_util');

const code = process.argv[2];
if (!code) {
  console.error('Usage: node scaffold_locale.js <localeCode>');
  process.exit(1);
}

const localesDir = path.resolve(__dirname, '../../src/renderer/i18n/locales');
const enPath = path.join(localesDir, 'en.json');
const targetPath = path.join(localesDir, `${code}.json`);

if (fs.existsSync(targetPath)) {
  console.error(`Refusing to overwrite existing file: ${targetPath}`);
  process.exit(1);
}

const en = readJson(enPath);
writeJson(targetPath, en);
console.log(`Created ${targetPath} as an English-fallback skeleton.`);