#!/usr/bin/env node
// Usage: node scripts/i18n/extract_backlog.js <localeCode> [batchSize=80]
const path = require('path');
const fs = require('fs');
const { readJson, flatten } = require('./_util');

const code = process.argv[2];
const batchSize = parseInt(process.argv[3] || '80', 10);
if (!code) {
  console.error('Usage: node extract_backlog.js <localeCode> [batchSize]');
  process.exit(1);
}

// Keys whose value is a bare proper noun / brand name: leaving them
// identical to English across all locales is correct, not a translation gap.
const ALLOWLIST = new Set([
  'welcome.chromeRequired',
  'welcome.notionRequired',
]);

const localesDir = path.resolve(__dirname, '../../src/renderer/i18n/locales');
const en = flatten(readJson(path.join(localesDir, 'en.json')));
const localePath = path.join(localesDir, `${code}.json`);
if (!fs.existsSync(localePath)) {
  console.error(`Locale file not found: ${localePath}. Run scaffold_locale.js first.`);
  process.exit(1);
}
const locale = flatten(readJson(localePath));

const backlog = {};
for (const [key, enValue] of Object.entries(en)) {
  if (ALLOWLIST.has(key)) continue;
  if (typeof enValue !== 'string') continue;
  const localeValue = locale[key];
  if (localeValue === undefined || localeValue === enValue) {
    backlog[key] = enValue;
  }
}

const keys = Object.keys(backlog);
const outDir = path.resolve(__dirname, `../../.i18n-work/${code}`);
fs.mkdirSync(outDir, { recursive: true });

let batchCount = 0;
for (let i = 0; i < keys.length; i += batchSize) {
  batchCount++;
  const batchKeys = keys.slice(i, i + batchSize);
  const batch = {};
  for (const k of batchKeys) batch[k] = backlog[k];
  const file = path.join(outDir, `batch-${String(batchCount).padStart(3, '0')}.json`);
  fs.writeFileSync(file, JSON.stringify(batch, null, 2) + '\n', 'utf-8');
}

console.log(`${code}: ${keys.length} keys to translate, ${batchCount} batch file(s) written to ${outDir}`);