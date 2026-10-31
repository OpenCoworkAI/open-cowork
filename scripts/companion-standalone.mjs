#!/usr/bin/env node
/**
 * Companion standalone (subprocess) mode.
 *
 * Runs src/main/remote/companion/companion-server.ts in its own process with
 * the built-in stub agent, so the phone companion surface (one-time QR pairing
 * on POST /companion/pair + WS /companion/stream) can be exercised without the
 * Electron app — for development and smoke tests.
 *
 * Usage:
 *   node scripts/companion-standalone.mjs [--port 18790] [--bind 0.0.0.0]
 *                                         [--gateway-port <gateway port>]
 *                                         [--gateway-token <gateway token>]
 *
 * With --gateway-port/--gateway-token the process links its /companion/stream
 * clients through to a running gateway (loopback proxy). Without them it runs
 * the stub agent and answers prompts locally.
 */

import { build } from 'esbuild';
import { pathToFileURL } from 'url';
import path from 'path';
import os from 'os';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = mkdtempSync(path.join(os.tmpdir(), 'companion-standalone-'));
const outfile = path.join(outdir, 'companion-server.cjs');

// The logger pulls in `electron` (app.getPath). In a subprocess there is no
// Electron, so send the bundler to a minimal stub instead.
const electronStub = path.join(outdir, 'electron-stub.cjs');
writeFileSync(
  electronStub,
  "module.exports = { app: { getPath: () => require('os').tmpdir(), getVersion: () => '0.0.0-standalone' }, ipcMain: { on() {}, handle() {} }, BrowserWindow: function Stub() {} };"
);

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key || !key.startsWith('--')) break;
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

const args = parseArgs(process.argv);

await build({
  entryPoints: [path.join(root, 'src/main/remote/companion/companion-server.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  alias: { electron: electronStub },
  external: ['esbuild'],
});

const { CompanionServer } = await import(pathToFileURL(outfile).href);

const server = new CompanionServer({
  gatewayPort: args['gateway-port'] ? Number(args['gateway-port']) : undefined,
  gatewayToken: args['gateway-token'],
});

const port = args.port ? Number(args.port) : 18790;
const bind = args.bind || '0.0.0.0';

const shutdown = async () => {
  await server.stop();
  try {
    rmSync(outdir, { recursive: true, force: true });
  } catch {
    // Temp dir cleanup is best effort.
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await server.start(port, bind);

console.log(`[companion-standalone] listening on ${bind}:${server.port}`);
console.log('[companion-standalone] pair endpoint   : POST http://<host>:' + server.port + '/companion/pair/start (loopback) + POST /companion/pair');
console.log('[companion-standalone] stream endpoint : WS ws://<host>:' + server.port + '/companion/stream');
if (args['gateway-port']) {
  console.log(`[companion-standalone] proxying to gateway ws://127.0.0.1:${args['gateway-port']}/ws`);
} else {
  console.log('[companion-standalone] running the stub agent (no --gateway-port given)');
}
