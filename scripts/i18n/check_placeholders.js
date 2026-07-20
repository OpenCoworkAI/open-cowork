#!/usr/bin/env node
// Usage: node scripts/i18n/check_placeholders.js <localeCode>
const path = require('path');
const { readJson, flatten, extractPlaceholders } = require('./_util');

const code = process.argv[2];
if (!code) {
  console.error('Usage: node check_placeholders.js <localeCode>');
  process.exit(1);
}

const localesDir = path.resolve(__dirname, '../../src/renderer/i18n/locales');
const en = flatten(readJson(path.join(localesDir, 'en.json')));
const locale = flatten(readJson(path.join(localesDir, `${code}.json`)));

let mismatches = 0;
for (const [key, enValue] of Object.entries(en)) {
  const localeValue = locale[key];
  if (localeValue === undefined) continue;
  const enPh = extractPlaceholders(enValue).join(',');
  const localePh = extractPlaceholders(localeValue).join(',');
  if (enPh !== localePh) {
    mismatches++;
    console.error(`MISMATCH ${key}: en=[${enPh}] ${code}=[${localePh}]`);
  }
}

console.log(mismatches === 0 ? 'VERDICT: PASS (all placeholders match)' : `VERDICT: FAIL (${mismatches} mismatches)`);
process.exit(mismatches === 0 ? 0 : 1);