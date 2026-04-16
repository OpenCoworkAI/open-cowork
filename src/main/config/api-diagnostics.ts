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
import { PROVIDER_PRESETS, configStore } from './config-store';
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
  DiagnosticVerificationLevel,
  LocalOllamaDiscoveryResult,
} from '../../renderer/types';
import { log, logWarn } from '../utils/logger';
import { probeWithClaudeSdk } from '../claude/claude-sdk-one-shot';
import { fetchOllamaModelIndex } from './ollama-api';

const STEP_NAMES: DiagnosticStepName[] = ['dns', 'tcp', 'tls', 'auth', 'model'];
const TCP_TIMEOUT_MS = 5000;
const TLS_TIMEOUT_MS = 5000;
const LOCAL_ANTHROPIC_PLACEHOLDER_KEY = 'sk-ant-local-proxy';

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

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getApiErrorInfo(err: unknown): { status?: number; message: string } {
  if (err instanceof Error) {
    const apiErr = err as Error & { status?: number };
    return { status: apiErr.status, message: apiErr.message };
  }
  if (typeof err === 'object' && err !== null) {
    const obj = err as { status?: number; message?: unknown };
    return {
      status: typeof obj.status === 'number' ? obj.status : undefined,
      message: typeof obj.message === 'string' ? obj.message : String(err),
    };
  }
  return { message: String(err) };
}

function getModelDiagnosticFix(
  errorType: Awaited<ReturnType<typeof probeWithClaudeSdk>>['errorType'],
  model: string
): string {
  switch (errorType) {
    case 'unauthorized':
      return 'auth_invalid_key';
    case 'network_error':
      return `model_network_error:${model}`;
    case 'rate_limited':
      return `model_rate_limited:${model}`;
    case 'server_error':
      return `model_request_failed:${model}`;
    case 'ollama_loading':
      return `ollama_model_loading:${model}`;
    default:
      return `model_unavailable:${model}`;
  }
}

/**
 * Build an Anthropic client with credentials passed explicitly.
 * baseURL and apiKey/authToken are always provided directly so the SDK
 * never falls back to reading process.env, avoiding race conditions in
 * concurrent diagnostic runs.
 */
function makeAnthropicClient(opts: {
  effectiveKey: string;
  useAuthToken: boolean;
  baseUrl: string | undefined;
}): Anthropic {
  const base = { baseURL: opts.baseUrl, timeout: 15000 };
  return opts.useAuthToken
    ? new Anthropic({ ...base, authToken: opts.effectiveKey })
    : new Anthropic({ ...base, apiKey: opts.effectiveKey });
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
    step.error = getErrorMessage(err);
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
    step.error = getErrorMessage(err);
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
    step.error = getErrorMessage(err);
    step.fix = 'tls_handshake_failed';
  }
  step.latencyMs = Date.now() - start;
}

async function stepAuth(input: DiagnosticInput, step: DiagnosticStep): Promise<void> {
  // Gemini: verify key via models.get() — lightweight and always available
  if (isGeminiProtocol(input)) {
    const start = Date.now();
    const apiKey = input.apiKey?.trim() || '';

    if (!apiKey) {
      step.status = 'fail';
      step.error = 'No API key provided';
      step.fix = 'missing_api_key';
      step.latencyMs = Date.now() - start;
      return;
    }

    try {
      const { GoogleGenAI } = (await import('@google/genai')) as typeof import('@google/genai');
      const clientBaseUrl = resolveClientBaseUrl(input);
      const httpOptions = { ...(clientBaseUrl ? { baseUrl: clientBaseUrl } : {}), timeout: 15000 };
      const client = new GoogleGenAI({ apiKey, httpOptions });
      const modelToCheck = input.model?.trim() || 'gemini-2.0-flash';
      await client.models.get({ model: modelToCheck });
      step.status = 'ok';
    } catch (err) {
      const e = getApiErrorInfo(err);
      if (e.status === 404) {
        // Custom Gemini proxy may not implement models.get — treat like OpenAI 404 path
        step.status = 'ok';
        step.fix = 'models_get_not_supported';
        log(
          '[Diagnostics] Gemini auth: models.get returned 404 — proxy may not support this endpoint, continuing to model check'
        );
      } else {
        step.status = 'fail';
        step.error = e.message;
        step.fix =
          e.status === 401 || e.status === 403 ? 'auth_invalid_key' : 'auth_request_failed';
      }
    }

    step.latencyMs = Date.now() - start;
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

      // Credentials are passed explicitly so the SDK never reads process.env
      const client = makeAnthropicClient({ effectiveKey, useAuthToken, baseUrl: clientBaseUrl });
      await client.models.list();
    }

    step.status = 'ok';
  } catch (err) {
    const e = getApiErrorInfo(err);

    if (e.status === 404) {
      // Many OpenAI-compatible providers (e.g. Alibaba DashScope) don't
      // implement GET /v1/models.  A 404 does NOT mean auth failed — let
      // stepModel (which uses chat completion) make the real determination.
      step.status = 'ok';
      step.fix = 'models_list_not_supported';
      log(
        '[Diagnostics] Auth: models.list returned 404 — provider may not support this endpoint, continuing to model check'
      );
    } else {
      step.status = 'fail';
      step.error = e.message;

      if (e.status === 401 || e.status === 403) {
        step.fix = 'auth_invalid_key';
      } else {
        step.fix = 'auth_request_failed';
      }
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
  try {
    const verificationLevel: DiagnosticVerificationLevel = input.verificationLevel ?? 'deep';
    if (input.provider === 'ollama' && verificationLevel === 'fast') {
      const result = await fetchOllamaModelIndex({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
      });
      const modelId = input.model.trim();
      const exists = result.models.some((item) => item.id === modelId);

      if (!result.models.length) {
        step.status = 'fail';
        step.error = 'No models returned by endpoint';
        step.fix = 'ollama_no_models_loaded';
        step.latencyMs = Date.now() - start;
        return;
      }

      if (!exists) {
        step.status = 'fail';
        step.error = `Model ${modelId} is not in the endpoint model list`;
        step.fix = `ollama_model_not_listed:${modelId}`;
        step.latencyMs = Date.now() - start;
        return;
      }

      step.status = 'ok';
      step.latencyMs = Date.now() - start;
      return;
    }

    const config = configStore.getAll();
    const result = await probeWithClaudeSdk(
      {
        provider: input.provider,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        customProtocol: input.customProtocol,
        model: input.model,
        verificationLevel,
      },
      config
    );

    if (result.ok) {
      step.status = 'ok';
    } else {
      step.status = 'fail';
      step.error = result.details;
      step.fix = getModelDiagnosticFix(result.errorType, input.model);
    }
  } catch (err) {
    step.status = 'fail';
    step.error = getErrorMessage(err);
    step.fix = `model_unavailable:${input.model}`;
  }
  step.latencyMs = Date.now() - start;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

// Guard to prevent concurrent diagnostic runs
let diagnosticsRunning = false;

export async function runDiagnostics(input: DiagnosticInput): Promise<DiagnosticResult> {
  const verificationLevel: DiagnosticVerificationLevel = input.verificationLevel ?? 'deep';
  if (diagnosticsRunning) {
    log('[Diagnostics] Skipping — another run is already in progress');
    return {
      steps: STEP_NAMES.map((name) => ({ name, status: 'skip' as const, latencyMs: 0 })),
      overallOk: true,
      verificationLevel,
      skippedReason: 'concurrent_run',
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
  const verificationLevel: DiagnosticVerificationLevel = input.verificationLevel ?? 'deep';
  log('[Diagnostics] Starting', {
    provider: input.provider,
    customProtocol: input.customProtocol,
    hasApiKey: Boolean(input.apiKey?.trim()),
    baseUrl: input.baseUrl || '(default)',
    model: input.model || '(none)',
    verificationLevel,
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
    verificationLevel,
  };

  if (overallOk && input.provider === 'ollama' && verificationLevel === 'fast') {
    result.advisoryCode = 'not_deep_verified';
    result.advisoryText =
      'Endpoint is reachable and the selected model is listed, but no live inference was performed.';
  }

  if (
    !overallOk &&
    input.provider === 'ollama' &&
    verificationLevel === 'deep' &&
    failedStep?.name === 'model' &&
    failedStep.fix?.startsWith('ollama_model_loading:')
  ) {
    result.advisoryCode = 'model_loading';
    result.advisoryText =
      'The endpoint is reachable, but the model may still be loading into memory.';
  }

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
  const baseUrl =
    preferredBaseUrl && isLoopbackBaseUrl(preferredBaseUrl)
      ? normalizeOllamaBaseUrl(preferredBaseUrl) || DEFAULT_OLLAMA_BASE_URL
      : DEFAULT_OLLAMA_BASE_URL;

  try {
    const result = await fetchOllamaModelIndex({ baseUrl });
    const models = result.models.map((item) => item.id);

    if (!models?.length) {
      log('[Diagnostics] Local Ollama discovered without loaded models');
      return { available: true, baseUrl: result.baseUrl, models: [], status: 'service_available' };
    }

    log('[Diagnostics] Local Ollama discovered', {
      modelCount: models.length,
      baseUrl: result.baseUrl,
    });
    return { available: true, baseUrl: result.baseUrl, models, status: 'models_available' };
  } catch {
    return { available: false, baseUrl, status: 'unavailable' };
  }
}
