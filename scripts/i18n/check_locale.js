#!/usr/bin/env node
// Usage: node scripts/i18n/check_locale.js <localeCode>
const path = require('path');
const fs = require('fs');
const { readJson, flatten } = require('./_util');

const code = process.argv[2];
if (!code) {
  console.error('Usage: node check_locale.js <localeCode>');
  process.exit(1);
}

const ALLOWLIST = new Set([
  'welcome.chromeRequired',
  'welcome.notionRequired',
  'common.appLogoAlt',
  'welcome.logoAlt',
  'mcp.namePlaceholder',
  'remote.slackAppToken',
  'language.english',
]);

const localesDir = path.resolve(__dirname, '../../src/renderer/i18n/locales');
const en = flatten(readJson(path.join(localesDir, 'en.json')));
const localePath = path.join(localesDir, `${code}.json`);
if (!fs.existsSync(localePath)) {
  console.error(`FAIL: ${localePath} does not exist.`);
  process.exit(1);
}
const locale = flatten(readJson(localePath));

let ok = true;
const enKeys = Object.keys(en);
const localeKeys = Object.keys(locale);

const missing = enKeys.filter((k) => !(k in locale));
const extra = localeKeys.filter((k) => !(k in en));
if (missing.length) {
  ok = false;
  console.error(`MISSING keys (${missing.length}):`, missing);
}
if (extra.length) {
  ok = false;
  console.error(`EXTRA keys not in en.json (${extra.length}):`, extra);
}

const stillEnglish = enKeys.filter((k) => !ALLOWLIST.has(k) && locale[k] === en[k]);

console.log(`${code}: ${enKeys.length} total keys, ${missing.length} missing, ${extra.length} extra, ${stillEnglish.length} still identical to English.`);
if (stillEnglish.length) {
  console.log('Untranslated keys:', stillEnglish.slice(0, 50), stillEnglish.length > 50 ? `... (+${stillEnglish.length - 50} more)` : '');
}

console.log(ok && stillEnglish.length === 0 ? 'VERDICT: PASS' : 'VERDICT: FAIL');
process.exit(ok && stillEnglish.length === 0 ? 0 : 1);