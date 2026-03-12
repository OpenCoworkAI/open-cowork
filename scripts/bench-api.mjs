#!/usr/bin/env node
/**
 * API latency benchmark — measures TTFT and total response time for each
 * configured provider preset.
 *
 * Usage:
 *   npm run bench:api                   # test all presets
 *   npm run bench:api -- --set glm      # test a specific configSet by name
 *   npm run bench:api -- --runs 3       # repeat each test N times (default 2)
 *
 * The script reads the encrypted app config directly (same key used by
 * electron-store) so no manual API key setup is needed.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

// ─── config decryption ───────────────────────────────────────────────────────

function decryptConfig() {
  const configPath = path.join(
    os.homedir(),
    'Library/Application Support/open-cowork/config.json',
  );
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found at ${configPath}. Is the app installed?`);
  }
  const data = fs.readFileSync(configPath);
  const iv = data.slice(0, 16);
  const password = crypto.pbkdf2Sync('open-cowork-config-v1', iv, 10_000, 32, 'sha512');
  const decipher = crypto.createDecipheriv('aes-256-cbc', password, iv);
  const dec = Buffer.concat([decipher.update(data.slice(17)), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

// ─── provider endpoint resolvers ────────────────────────────────────────────

function resolveAnthropicEndpoint(baseUrl) {
  const base = (baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  return `${base}/v1/messages`;
}

function resolveOpenAIEndpoint(baseUrl) {
  const base = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  // Avoid double /v1
  if (base.endsWith('/v1')) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

// ─── streaming request helpers ───────────────────────────────────────────────

async function measureAnthropicStreaming(endpoint, apiKey, model) {
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Reply with just the number 1.' }],
    max_tokens: 16,
    stream: true,
  });

  const t0 = performance.now();
  let ttft = null;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
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

async function measureOpenAIStreaming(endpoint, apiKey, model, extraHeaders = {}) {
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Reply with just the number 1.' }],
    max_tokens: 16,
    stream: true,
  });

  const t0 = performance.now();
  let ttft = null;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...extraHeaders,
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
    if (ttft === null && chunk.includes('"delta"') && chunk.includes('"content"')) {
      ttft = performance.now() - t0;
    }
  }

  return { ttft: ttft ?? performance.now() - t0, total: performance.now() - t0 };
}

// ─── preset resolution ───────────────────────────────────────────────────────

/**
 * Build a list of testable presets from the decrypted config.
 * Each preset knows its protocol, endpoint, model, and credentials.
 */
function resolvePresets(config) {
  const presets = [];

  for (const cs of config.configSets ?? []) {
    const activeKey = cs.activeProfileKey;
    const profiles = cs.profiles ?? {};
    const p = profiles[activeKey] ?? {};

    const model = p.model || cs.model;
    const baseUrl = p.baseUrl;
    const apiKey = p.apiKey?.trim();
    const provider = cs.provider;
    const protocol = cs.customProtocol;

    if (!model || !apiKey) {
      presets.push({ name: cs.name, id: cs.id, skip: 'no key or model configured' });
      continue;
    }

    // Determine effective protocol
    let effectiveProtocol = 'anthropic';
    if (provider === 'openai' || protocol === 'openai') effectiveProtocol = 'openai';
    else if (provider === 'gemini' || protocol === 'gemini') effectiveProtocol = 'gemini';
    else if (provider === 'openrouter') effectiveProtocol = 'openai'; // openrouter is openai-compat

    // Skip providers that need a special proxy (e.g. OpenAI Codex OAuth JWT)
    if (provider === 'openai' && apiKey.startsWith('eyJ')) {
      presets.push({ name: cs.name, id: cs.id, skip: 'codex OAuth JWT — needs proxy (skip for direct test)' });
      continue;
    }

    if (effectiveProtocol === 'anthropic') {
      presets.push({
        name: cs.name,
        id: cs.id,
        protocol: 'anthropic',
        endpoint: resolveAnthropicEndpoint(baseUrl),
        model,
        apiKey,
        baseUrl,
      });
    } else if (effectiveProtocol === 'openai') {
      presets.push({
        name: cs.name,
        id: cs.id,
        protocol: 'openai',
        endpoint: resolveOpenAIEndpoint(baseUrl),
        model,
        apiKey,
        baseUrl,
      });
    } else {
      presets.push({ name: cs.name, id: cs.id, skip: `unsupported protocol: ${effectiveProtocol}` });
    }
  }

  return presets;
}

// ─── formatting helpers ───────────────────────────────────────────────────────

function ms(n) {
  if (n == null) return '  —   ';
  return `${Math.round(n).toString().padStart(5)}ms`;
}

function pad(s, n) {
  return String(s ?? '').padEnd(n);
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      set:  { type: 'string' },
      runs: { type: 'string', default: '2' },
    },
    strict: false,
  });

  const runs = Math.max(1, parseInt(values.runs ?? '2', 10));

  let config;
  try {
    config = decryptConfig();
  } catch (err) {
    console.error('Failed to read config:', err.message);
    process.exit(1);
  }

  let presets = resolvePresets(config);
  if (values.set) {
    presets = presets.filter((p) => p.name === values.set || p.id === values.set);
    if (presets.length === 0) {
      console.error(`No configSet named "${values.set}" found.`);
      process.exit(1);
    }
  }

  console.log(`\nAPI Latency Benchmark — ${runs} run(s) per preset\n`);
  const label = runs > 1 ? 'TTFT avg/min' : 'TTFT';
  const totalLabel = runs > 1 ? 'Total avg/min' : 'Total';
  console.log(
    `${'Preset'.padEnd(14)} ${'Protocol'.padEnd(10)} ${'Model'.padEnd(30)} ${label.padStart(15)}  ${totalLabel.padStart(15)}  ${'Status'}`
  );
  console.log('─'.repeat(100));

  for (const preset of presets) {
    if (preset.skip) {
      console.log(
        `${pad(preset.name, 14)} ${'—'.padEnd(10)} ${'—'.padEnd(30)} ${'—'.padStart(15)}  ${'—'.padStart(15)}  skip: ${preset.skip}`
      );
      continue;
    }

    const ttfts = [];
    const totals = [];
    let lastError = null;

    for (let i = 0; i < runs; i++) {
      try {
        const result =
          preset.protocol === 'anthropic'
            ? await measureAnthropicStreaming(preset.endpoint, preset.apiKey, preset.model)
            : await measureOpenAIStreaming(preset.endpoint, preset.apiKey, preset.model);

        ttfts.push(result.ttft);
        totals.push(result.total);
      } catch (err) {
        lastError = err.message;
        break;
      }
    }

    if (lastError) {
      const short = lastError.slice(0, 60);
      console.log(
        `${pad(preset.name, 14)} ${pad(preset.protocol, 10)} ${pad(preset.model, 30)} ${'—'.padStart(15)}  ${'—'.padStart(15)}  ERROR: ${short}`
      );
      continue;
    }

    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const avgTtft = avg(ttfts);
    const avgTotal = avg(totals);
    const minTtft = Math.min(...ttfts);
    const minTotal = Math.min(...totals);

    const ttftStr = runs > 1 ? `${ms(avgTtft)} / ${ms(minTtft)}` : ms(avgTtft);
    const totalStr = runs > 1 ? `${ms(avgTotal)} / ${ms(minTotal)}` : ms(avgTotal);

    console.log(
      `${pad(preset.name, 14)} ${pad(preset.protocol, 10)} ${pad(preset.model, 30)} ${ttftStr.padStart(15)}  ${totalStr.padStart(15)}`
    );
  }

  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
