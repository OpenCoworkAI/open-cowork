const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const relativePath = path.join('dist', 'auth', 'oauth', 'load.js');
const candidates = [
  path.join(root, 'node_modules', '@earendil-works', 'pi-ai', relativePath),
  path.join(
    root,
    'node_modules',
    '@earendil-works',
    'pi-coding-agent',
    'node_modules',
    '@earendil-works',
    'pi-ai',
    relativePath,
  ),
];

const dynamicLoader = 'return (await importOAuthModule("./openai-codex.ts")).openaiCodexOAuth;';
const staticLoader = 'return openaiCodexOAuth;';
const importLine = 'import { openaiCodexOAuth } from "./openai-codex.js";';

let patched = 0;

for (const file of candidates) {
  if (!fs.existsSync(file)) continue;

  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(importLine) && source.includes(staticLoader)) {
    patched++;
    continue;
  }
  if (!source.includes(dynamicLoader)) {
    throw new Error(`Unexpected Pi AI OAuth loader format: ${file}`);
  }

  const updated = source
    .replace(
      '};\nlet bundledLoaders;',
      `};\n// Electron bundles pi-ai into a single CommonJS entrypoint.\n${importLine}\nlet bundledLoaders;`,
    )
    .replace(dynamicLoader, staticLoader);
  fs.writeFileSync(file, updated);
  console.log(`[pi-ai] patched OAuth loader: ${file}`);
  patched++;
}

if (patched === 0) {
  throw new Error(`pi-ai OAuth loader not found; checked: ${candidates.join(', ')}`);
}

