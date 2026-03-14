#!/usr/bin/env node
/**
 * Proxy-path latency benchmark — measures:
 *   1. Cold start: proxy spawn + first query TTFT
 *   2. Warm path: subsequent queries hitting the lock-free fast path
 *
 * Tests the R2 optimizations (lock-free warm path, cached resolution, warmup state).
 *
 * Usage:
 *   node scripts/bench-proxy-path.mjs
 *   node scripts/bench-proxy-path.mjs --set glm
 *   node scripts/bench-proxy-path.mjs --warm-runs 5
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync, spawn } from 'node:child_process';

// ─── config decryption (same as bench-api.mjs) ──────────────────────────────

function decryptConfig() {
  const configPath = path.join(
    os.homedir(),
    'Library/Application Support/open-cowork/config.json',
  );
  const data = fs.readFileSync(configPath);
  const iv = data.slice(0, 16);
  const password = crypto.pbkdf2Sync('open-cowork-config-v1', iv, 10_000, 32, 'sha512');
  const decipher = crypto.createDecipheriv('aes-256-cbc', password, iv);
  const dec = Buffer.concat([decipher.update(data.slice(17)), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

// ─── proxy lifecycle ─────────────────────────────────────────────────────────

const PROXY_HOST = '127.0.0.1';

function findVendorRoot() {
  const candidates = [
    path.resolve(process.cwd(), 'vendor', 'claude-code-proxy'),
    path.resolve(process.cwd(), 'src', 'vendor', 'claude-code-proxy'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'server.py'))) return c;
  }
  throw new Error('vendor root not found');
}

async function findAvailablePort(start = 18200, end = 18250) {
  const net = await import('node:net');
  for (let port = start; port <= end; port++) {
    const ok = await new Promise((resolve) => {
      const srv = net.default.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => { srv.close(() => resolve(true)); });
      srv.listen(port, PROXY_HOST);
    });
    if (ok) return port;
  }
  throw new Error('no available port');
}

function buildProxyEnv(preset) {
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
    GEMINI_API_KEY: '',
    OPENAI_BASE_URL: '',
    ANTHROPIC_BASE_URL: '',
    GEMINI_BASE_URL: '',
    OPENAI_DEFAULT_HEADERS_JSON: '',
    OPENAI_ACCOUNT_ID: '',
    OPENAI_CODEX_OAUTH: '0',
    USE_VERTEX_AUTH: '0',
    VERTEX_PROJECT: '',
    VERTEX_LOCATION: '',
  };

  if (preset.upstreamKind === 'openai') {
    env.PREFERRED_PROVIDER = 'openai';
    env.OPENAI_API_KEY = preset.apiKey;
    env.OPENAI_BASE_URL = preset.baseUrl;
  } else if (preset.upstreamKind === 'gemini') {
    env.PREFERRED_PROVIDER = 'google';
    env.GEMINI_API_KEY = preset.apiKey;
    env.GEMINI_BASE_URL = preset.baseUrl;
  } else {
    env.PREFERRED_PROVIDER = 'anthropic';
    env.ANTHROPIC_API_KEY = preset.apiKey;
    env.ANTHROPIC_BASE_URL = preset.baseUrl;
  }

  env.BIG_MODEL = preset.model;
  env.SMALL_MODEL = preset.model;
  return env;
}

async function spawnProxy(vendorRoot, port, env) {
  const venvPython = path.join(
    os.homedir(),
    'Library/Application Support/open-cowork/claude-proxy-runtime/venv/bin/python3',
  );
  const python = process.env.OPEN_COWORK_PYTHON_PATH
    || (fs.existsSync(venvPython) ? venvPython : 'python3');
  const child = spawn(
    python,
    ['-m', 'uvicorn', 'server:app', '--host', PROXY_HOST, '--port', String(port), '--log-level', 'warning'],
    { cwd: vendorRoot, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  // Wait for healthy
  const deadline = Date.now() + 25_000;
  let delay = 50;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`proxy exited: ${child.exitCode}`);
    try {
      const r = await fetch(`http://${PROXY_HOST}:${port}/`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.ceil(delay * 1.6), 400);
  }
  child.kill();
  throw new Error('proxy health timeout');
}

// ─── streaming through proxy ─────────────────────────────────────────────────

async function measureViaProxy(proxyBase, model) {
  // Proxy always speaks Anthropic protocol to the SDK
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Reply with just the number 1.' }],
    max_tokens: 16,
    stream: true,
  });

  const t0 = performance.now();
  let ttft = null;

  const res = await fetch(`${proxyBase}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': 'sk-ant-local-proxy',
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (ttft === null && chunk.includes('"type":"content_block_delta"')) {
      ttft = performance.now() - t0;
    }
  }

  return { ttft: ttft ?? performance.now() - t0, total: performance.now() - t0 };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function ms(n) { return n == null ? '  —   ' : `${Math.round(n).toString().padStart(5)}ms`; }
function pad(s, n) { return String(s ?? '').padEnd(n); }

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      set: { type: 'string' },
      'warm-runs': { type: 'string', default: '3' },
    },
    strict: false,
  });

  const warmRuns = Math.max(1, parseInt(values['warm-runs'] ?? '3', 10));
  const config = decryptConfig();
  const vendorRoot = findVendorRoot();

  // Build testable presets
  let presets = [];
  for (const cs of config.configSets ?? []) {
    const ak = cs.activeProfileKey;
    const p = (cs.profiles || {})[ak] || {};
    const model = p.model || cs.model;
    const apiKey = p.apiKey?.trim();
    const baseUrl = p.baseUrl;
    const provider = cs.provider;
    const protocol = cs.customProtocol;

    if (!model || !apiKey) { presets.push({ name: cs.name, skip: 'no key' }); continue; }
    if (provider === 'openai' && apiKey.startsWith('eyJ')) { presets.push({ name: cs.name, skip: 'codex OAuth' }); continue; }

    let upstreamKind = 'anthropic';
    if (provider === 'openai' || protocol === 'openai' || provider === 'openrouter') upstreamKind = 'openai';
    else if (provider === 'gemini' || protocol === 'gemini') upstreamKind = 'gemini';

    presets.push({ name: cs.name, model, apiKey, baseUrl, upstreamKind });
  }

  if (values.set) {
    presets = presets.filter((p) => p.name === values.set);
    if (!presets.length) { console.error(`No preset "${values.set}"`); process.exit(1); }
  }

  console.log(`\nProxy-Path Latency Benchmark — ${warmRuns} warm run(s) per preset\n`);
  console.log(
    `${pad('Preset', 14)} ${pad('Model', 35)} ${pad('Cold (spawn+1st)', 18)} ${pad('Warm avg/min', 18)}  Status`
  );
  console.log('─'.repeat(100));

  for (const preset of presets) {
    if (preset.skip) {
      console.log(`${pad(preset.name, 14)} ${'—'.padEnd(35)} ${'—'.padStart(18)}  ${'—'.padStart(18)}  skip: ${preset.skip}`);
      continue;
    }

    let child = null;
    try {
      const port = await findAvailablePort();
      const proxyBase = `http://${PROXY_HOST}:${port}`;
      const env = buildProxyEnv(preset);

      // ── Cold start: spawn + first query ──
      const t0 = performance.now();
      child = await spawnProxy(vendorRoot, port, env);
      const spawnTime = performance.now() - t0;

      const coldResult = await measureViaProxy(proxyBase, preset.model);
      const coldTotal = spawnTime + coldResult.total;

      // ── Warm runs ──
      const warmTtfts = [];
      for (let i = 0; i < warmRuns; i++) {
        const r = await measureViaProxy(proxyBase, preset.model);
        warmTtfts.push(r.ttft);
      }

      const avg = warmTtfts.reduce((a, b) => a + b, 0) / warmTtfts.length;
      const min = Math.min(...warmTtfts);

      console.log(
        `${pad(preset.name, 14)} ${pad(preset.model, 35)} ${ms(coldTotal).padStart(18)}  ${(ms(avg) + ' / ' + ms(min)).padStart(18)}`
      );
    } catch (err) {
      console.log(
        `${pad(preset.name, 14)} ${pad(preset.model || '—', 35)} ${'—'.padStart(18)}  ${'—'.padStart(18)}  ERROR: ${err.message.slice(0, 50)}`
      );
    } finally {
      if (child && child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise((r) => setTimeout(r, 500));
        if (child.exitCode === null) child.kill('SIGKILL');
      }
    }
  }

  console.log('');
}

main().catch((err) => { console.error(err); process.exit(1); });
