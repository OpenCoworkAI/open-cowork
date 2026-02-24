/**
 * Build the Navi standalone agent bundle for guest VM deployment.
 *
 * Bundles src/openclaw/server/index.ts and all its dependencies into
 * a single JS file at resources/provision/navi-agent/server/index.js
 *
 * Run: node scripts/build-navi-bundle.js
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ENTRY = path.resolve(__dirname, '../src/openclaw/server/index.ts');
const OUT_DIR = path.resolve(__dirname, '../resources/provision/navi-agent/server');

async function build() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: path.join(OUT_DIR, 'index.js'),
    external: [],
    format: 'cjs',
    minify: false,
    sourcemap: true,
  });

  if (result.errors.length > 0) {
    console.error('[build-navi-bundle] Build errors:', result.errors);
    process.exit(1);
  }

  const stat = fs.statSync(path.join(OUT_DIR, 'index.js'));
  console.log(`[build-navi-bundle] Bundle created at ${OUT_DIR} (${(stat.size / 1024).toFixed(0)} KB)`);
}

build().catch((err) => {
  console.error('[build-navi-bundle] Failed:', err);
  process.exit(1);
});
