/**
 * @module main/config/api-diagnostics
 *
 * Step-by-step API connection diagnostics engine.
 * Runs DNS → TCP → TLS → Auth → Model checks in sequence,
 * short-circuiting on the first failure.
 */
import * as dns from 'dns';
import * as net from 'net';
import * as tls from 'tls';
import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import { PROVIDER_PRESETS } from './config-store';
import { DEFAULT_OLLAMA_BASE_URL } from '../../shared/ollama-base-url';
import { isLoopbackBaseUrl } from '../../shared/network/loopback';
import {
  normalizeAnthropicBaseUrl,
  resolveOllamaCredentials,
  resolveOpenAICredentials,
  shouldAllowEmptyAnthropicApiKey,
  shouldUseAnthropicAuthToken,
  normalizeOpenAICompatibleBaseUrl,
  normalizeOllamaBaseUrl,
} from './auth-utils';
import type {
  DiagnosticInput,
  DiagnosticResult,
  DiagnosticStep,
  DiagnosticStepName,
} from '../../renderer/types';
import { log, logWarn } from '../utils/logger';

const STEP_NAMES: DiagnosticStepName[] = ['dns', 'tcp', 'tls', 'auth', 'model'];
const TCP_TIMEOUT_MS = 5000;
const TLS_TIMEOUT_MS = 5000;
const LOCAL_ANTHROPIC_PLACEHOLDER_KEY = 'sk-ant-local-proxy';

export interface LocalOllamaDiscoveryResult {
  available: boolean;
  baseUrl: string;
  models?: string[];
  status: 'unavailable' | 'service_available' | 'model_usable' | 'model_unusable';
  probeModel?: string;
  probeError?: string;
}

async function probeOllamaModel(baseUrl: string, model: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const probeResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!probeResponse.ok) {
      const probeError = await probeResponse.text();
      return { ok: false, error: probeError || `HTTP ${probeResponse.status}` };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep(name: DiagnosticStepName): DiagnosticStep {
  return { name, status: 'pending' };
}

function normalizeNetworkHostname(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function isLoopback(hostname: string): boolean {
  const normalized = normalizeNetworkHostname(hostname);
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function resolveEffectiveUrl(input: DiagnosticInput): URL {
  let raw = input.baseUrl?.trim();

  if (!raw && input.provider !== 'custom') {
    raw = PROVIDER_PRESETS[input.provider]?.baseUrl;
  }

  if (!raw) {
    // Fallback for custom without baseUrl — use a dummy so we can still surface errors
    raw = 'https://localhost';
  }

  // Add protocol if missing
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }

  try {
    return new URL(raw);
  } catch {
    // Last resort — if URL is truly unparseable, return a localhost URL
    // The DNS step will catch the real issue
    return new URL('https://localhost');
  }
}

function defaultPort(
  protocol: string,
  provider: DiagnosticInput['provider'],
  hostname: string
): number {
  if (provider === 'ollama' && isLoopback(hostname)) {
    return 11434;
  }
  return protocol === 'https:' ? 443 : 80;
}

function isOpenAICompatible(input: DiagnosticInput): boolean {
  return (
    input.provider === 'openai' ||
    input.provider === 'ollama' ||
    input.provider === 'openrouter' ||
    (input.provider === 'custom' && input.customProtocol === 'openai')
  );
}

function isAnthropicCompatible(input: DiagnosticInput): boolean {
  return (
    input.provider === 'anthropic' ||
    (input.provider === 'custom' && (input.customProtocol ?? 'anthropic') === 'anthropic')
  );
}

function isGeminiProtocol(input: DiagnosticInput): boolean {
  return (
    input.provider === 'gemini' ||
    (input.provider === 'custom' && input.customProtocol === 'gemini')
  );
}

/**
 * Run a callback with ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN temporarily
 * removed from process.env, then restore them. Prevents SDK from reading
 * stale env vars during diagnostics.
 */
async function withSuppressedAnthropicEnv<T>(fn: () => Promise<T>): Promise<T> {
  const savedApiKey = process.env.ANTHROPIC_API_KEY;
  const savedAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    return await fn();
  } finally {
    if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey;
    if (savedAuthToken !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = savedAuthToken;
  }
}

/**
 * Resolve the effective base URL for SDK clients, applying provider-specific normalization.
 */
function resolveClientBaseUrl(input: DiagnosticInput): string | undefined {
  const raw = input.baseUrl?.trim();

  if (input.provider === 'ollama') {
    return normalizeOllamaBaseUrl(raw || PROVIDER_PRESETS.ollama?.baseUrl);
  }

  if (isOpenAICompatible(input)) {
    if (raw) return normalizeOpenAICompatibleBaseUrl(raw);
    if (input.provider !== 'custom') {
      return PROVIDER_PRESETS[input.provider]?.baseUrl;
    }
    return undefined;
  }

  if (isAnthropicCompatible(input)) {
    if (raw) return normalizeAnthropicBaseUrl(raw);
    if (input.provider === 'anthropic') {
      return normalizeAnthropicBaseUrl(PROVIDER_PRESETS.anthropic?.baseUrl);
    }
    return undefined;
  }

  // Gemini or unknown
  if (raw) return raw;
  if (input.provider !== 'custom') {
    return PROVIDER_PRESETS[input.provider as keyof typeof PROVIDER_PRESETS]?.baseUrl;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Individual diagnostic steps
// ---------------------------------------------------------------------------

async function stepDns(hostname: string, step: DiagnosticStep): Promise<void> {
  if (isLoopback(hostname)) {
    step.status = 'ok';
    step.latencyMs = 0;
    return;
  }

  const start = Date.now();
  try {
    await dns.promises.lookup(hostname);
    step.status = 'ok';
  } catch (err) {
    step.status = 'fail';
    step.error = (err as Error).message;
    step.fix = `dns_resolve_failed:${hostname}`;
  }
  step.latencyMs = Date.now() - start;
}

async function stepTcp(hostname: string, port: number, step: DiagnosticStep): Promise<void> {
  const start = Date.now();
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: hostname, port, timeout: TCP_TIMEOUT_MS });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error('Connection timed out'));
      });
      socket.once('error', (err) => {
        socket.destroy();
        reject(err);
      });
    });
    step.status = 'ok';
  } catch (err) {
    step.status = 'fail';
    step.error = (err as Error).message;
    step.fix = `tcp_connect_failed:${hostname}:${port}`;
  }
  step.latencyMs = Date.now() - start;
}

async function stepTls(
  hostname: string,
  port: number,
  isHttps: boolean,
  step: DiagnosticStep
): Promise<void> {
  if (!isHttps) {
    step.status = 'skip';
    step.latencyMs = 0;
    return;
  }

  const start = Date.now();
  try {
    await new Promise<void>((resolve, reject) => {
      const servername = net.isIP(hostname) === 0 ? hostname : undefined;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) {
          reject(error);
          return;
        }
        resolve();
      };
      const socket = tls.connect(
        {
          host: hostname,
          port,
          timeout: TLS_TIMEOUT_MS,
          ...(servername ? { servername } : {}),
        },
        () => {
          if (!socket.authorized && socket.authorizationError) {
            finish(new Error(String(socket.authorizationError)));
            return;
          }
          finish();
        }
      );
      socket.once('secureConnect', () => {
        if (!socket.authorized && socket.authorizationError) {
          finish(new Error(String(socket.authorizationError)));
        }
      });
      socket.once('timeout', () => {
        finish(new Error('TLS handshake timed out'));
      });
      socket.once('error', (err) => {
        finish(err);
      });
    });
    step.status = 'ok';
  } catch (err) {
    step.status = 'fail';
    step.error = (err as Error).message;
    step.fix = 'tls_handshake_failed';
  }
  step.latencyMs = Date.now() - start;
}

async function stepAuth(input: DiagnosticInput, step: DiagnosticStep): Promise<void> {
  // Gemini has no simple auth check endpoint
  if (isGeminiProtocol(input)) {
    step.status = 'skip';
    step.latencyMs = 0;
    return;
  }

  const start = Date.now();
  const apiKey = input.apiKey?.trim() || '';
  const clientBaseUrl = resolveClientBaseUrl(input);

  try {
    if (isOpenAICompatible(input)) {
      const resolved =
        input.provider === 'ollama'
          ? resolveOllamaCredentials({
              provider: input.provider,
              customProtocol: input.customProtocol,
              apiKey,
              baseUrl: clientBaseUrl,
            })
          : resolveOpenAICredentials({
              provider: input.provider,
              customProtocol: input.customProtocol,
              apiKey,
              baseUrl: clientBaseUrl,
            });

      if (!resolved?.apiKey) {
        step.status = 'fail';
        step.error = 'No API key provided';
        step.fix = 'missing_api_key';
        step.latencyMs = Date.now() - start;
        return;
      }

      const client = new OpenAI({
        apiKey: resolved.apiKey,
        baseURL: resolved.baseUrl || clientBaseUrl,
        timeout: 15000,
      });
      await client.models.list();
    } else {
      // Anthropic-compatible
      const allowEmpty = shouldAllowEmptyAnthropicApiKey({
        provider: input.provider,
        customProtocol: input.customProtocol,
        baseUrl: clientBaseUrl,
      });
      const effectiveKey = apiKey || (allowEmpty ? LOCAL_ANTHROPIC_PLACEHOLDER_KEY : '');

      if (!effectiveKey) {
        step.status = 'fail';
        step.error = 'No API key provided';
        step.fix = 'missing_api_key';
        step.latencyMs = Date.now() - start;
        return;
      }

      const useAuthToken = shouldUseAnthropicAuthToken({
        provider: input.provider,
        customProtocol: input.customProtocol,
        apiKey: effectiveKey,
      });

      // Temporarily clear env vars to prevent SDK from reading them
      await withSuppressedAnthropicEnv(async () => {
        const client = useAuthToken
          ? new Anthropic({ authToken: effectiveKey, baseURL: clientBaseUrl, timeout: 15000 })
          : new Anthropic({ apiKey: effectiveKey, baseURL: clientBaseUrl, timeout: 15000 });
        await client.models.list();
      });
    }

    step.status = 'ok';
  } catch (err) {
    step.status = 'fail';
    const e = err as { status?: number; message?: string };
    step.error = e.message ?? String(err);

    if (e.status === 401 || e.status === 403) {
      step.fix = 'auth_invalid_key';
    } else if (e.status === 404) {
      step.fix = 'auth_endpoint_not_found';
    } else {
      step.fix = 'auth_request_failed';
    }
  }
  step.latencyMs = Date.now() - start;
}

async function stepModel(input: DiagnosticInput, step: DiagnosticStep): Promise<void> {
  if (!input.model) {
    step.status = 'skip';
    step.latencyMs = 0;
    return;
  }

  const start = Date.now();
  const apiKey = input.apiKey?.trim() || '';
  const clientBaseUrl = resolveClientBaseUrl(input);
  const model = input.model;

  try {
    if (isOpenAICompatible(input)) {
      const resolved =
        input.provider === 'ollama'
          ? resolveOllamaCredentials({
              provider: input.provider,
              customProtocol: input.customProtocol,
              apiKey,
              baseUrl: clientBaseUrl,
            })
          : resolveOpenAICredentials({
              provider: input.provider,
              customProtocol: input.customProtocol,
              apiKey,
              baseUrl: clientBaseUrl,
            });

      const client = new OpenAI({
        apiKey: resolved?.apiKey || apiKey,
        baseURL: resolved?.baseUrl || clientBaseUrl,
        timeout: 30000,
      });
      await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      });
    } else if (isAnthropicCompatible(input)) {
      const allowEmpty = shouldAllowEmptyAnthropicApiKey({
        provider: input.provider,
        customProtocol: input.customProtocol,
        baseUrl: clientBaseUrl,
      });
      const effectiveKey = apiKey || (allowEmpty ? LOCAL_ANTHROPIC_PLACEHOLDER_KEY : '');
      const useAuthToken = shouldUseAnthropicAuthToken({
        provider: input.provider,
        customProtocol: input.customProtocol,
        apiKey: effectiveKey,
      });

      await withSuppressedAnthropicEnv(async () => {
        const client = useAuthToken
          ? new Anthropic({ authToken: effectiveKey, baseURL: clientBaseUrl, timeout: 30000 })
          : new Anthropic({ apiKey: effectiveKey, baseURL: clientBaseUrl, timeout: 30000 });
        await client.messages.create({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        });
      });
    } else {
      // Gemini or unknown — skip model check
      step.status = 'skip';
      step.latencyMs = 0;
      return;
    }

    step.status = 'ok';
  } catch (err) {
    step.status = 'fail';
    step.error = (err as Error).message;
    step.fix = `model_unavailable:${model}`;
  }
  step.latencyMs = Date.now() - start;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

// Guard to prevent concurrent diagnostic runs
let diagnosticsRunning = false;

export async function runDiagnostics(input: DiagnosticInput): Promise<DiagnosticResult> {
  if (diagnosticsRunning) {
    log('[Diagnostics] Skipping — another run is already in progress');
    return {
      steps: STEP_NAMES.map((name) => ({ name, status: 'skip' as const, latencyMs: 0 })),
      overallOk: false,
      failedAt: undefined,
      totalLatencyMs: 0,
    };
  }
  diagnosticsRunning = true;
  try {
    return await runDiagnosticsImpl(input);
  } finally {
    diagnosticsRunning = false;
  }
}

async function runDiagnosticsImpl(input: DiagnosticInput): Promise<DiagnosticResult> {
  log('[Diagnostics] Starting', {
    provider: input.provider,
    customProtocol: input.customProtocol,
    hasApiKey: Boolean(input.apiKey?.trim()),
    baseUrl: input.baseUrl || '(default)',
    model: input.model || '(none)',
  });

  const steps: DiagnosticStep[] = STEP_NAMES.map(makeStep);
  const stepMap = Object.fromEntries(steps.map((s) => [s.name, s])) as Record<
    DiagnosticStepName,
    DiagnosticStep
  >;

  let failed = false;
  const isFail = (s: DiagnosticStep): boolean => s.status === 'fail';

  // Parse URL for network checks
  const url = resolveEffectiveUrl(input);
  const hostname = normalizeNetworkHostname(url.hostname);
  const isHttps = url.protocol === 'https:';
  const port = url.port ? Number(url.port) : defaultPort(url.protocol, input.provider, hostname);

  // Step 1: DNS
  if (!failed) {
    stepMap.dns.status = 'running';
    await stepDns(hostname, stepMap.dns);
    if (isFail(stepMap.dns)) failed = true;
  }

  // Step 2: TCP
  if (!failed) {
    stepMap.tcp.status = 'running';
    await stepTcp(hostname, port, stepMap.tcp);
    if (isFail(stepMap.tcp)) failed = true;
  }

  // Step 3: TLS
  if (!failed) {
    stepMap.tls.status = 'running';
    await stepTls(hostname, port, isHttps, stepMap.tls);
    if (isFail(stepMap.tls)) failed = true;
  }

  // Step 4: Auth
  if (!failed) {
    stepMap.auth.status = 'running';
    await stepAuth(input, stepMap.auth);
    if (isFail(stepMap.auth)) failed = true;
  }

  // Step 5: Model
  if (!failed) {
    stepMap.model.status = 'running';
    await stepModel(input, stepMap.model);
    if (isFail(stepMap.model)) failed = true;
  }

  // Mark remaining pending steps as skipped
  for (const step of steps) {
    if (step.status === 'pending') {
      step.status = 'skip';
      step.latencyMs = 0;
    }
  }

  const totalLatencyMs = steps.reduce((sum, s) => sum + (s.latencyMs ?? 0), 0);
  const failedStep = steps.find((s) => s.status === 'fail');
  const overallOk = !failedStep;

  const result: DiagnosticResult = {
    steps,
    overallOk,
    failedAt: failedStep?.name,
    totalLatencyMs,
  };

  if (overallOk) {
    log('[Diagnostics] All checks passed', { totalLatencyMs });
  } else {
    logWarn('[Diagnostics] Failed', {
      failedAt: result.failedAt,
      error: failedStep?.error?.slice(0, 200),
      totalLatencyMs,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Local Ollama discovery
// ---------------------------------------------------------------------------

export async function discoverLocalOllama(input?: {
  baseUrl?: string;
}): Promise<LocalOllamaDiscoveryResult> {
  const preferredBaseUrl = input?.baseUrl?.trim();
  const baseUrl = preferredBaseUrl && isLoopbackBaseUrl(preferredBaseUrl)
    ? (normalizeOllamaBaseUrl(preferredBaseUrl) || DEFAULT_OLLAMA_BASE_URL)
    : DEFAULT_OLLAMA_BASE_URL;
  const modelsUrl = `${baseUrl}/models`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(modelsUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return { available: false, baseUrl, status: 'unavailable' };
    }

    const body = (await response.json()) as { data?: Array<{ id: string }> };
    const models = body.data?.map((m) => m.id).filter(Boolean) as string[] | undefined;

    if (!models?.length) {
      log('[Diagnostics] Local Ollama discovered without loaded models');
      return { available: true, baseUrl, models: [], status: 'service_available' };
    }

    let lastProbeError = '';
    for (const probeModel of models) {
      const probeResult = await probeOllamaModel(baseUrl, probeModel);
      if (probeResult.ok) {
        log('[Diagnostics] Local Ollama discovered', { modelCount: models?.length ?? 0, probeModel });
        return { available: true, baseUrl, models, status: 'model_usable', probeModel };
      }

      lastProbeError = probeResult.error;
      logWarn('[Diagnostics] Local Ollama model probe failed', {
        model: probeModel,
        error: probeResult.error.slice(0, 200),
      });
    }

    return {
      available: true,
      baseUrl,
      models,
      status: 'model_unusable',
      probeModel: models[0],
      probeError: lastProbeError,
    };
  } catch {
    return { available: false, baseUrl, status: 'unavailable' };
  }
}
