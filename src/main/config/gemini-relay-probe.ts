import type { ApiTestResult } from '../../renderer/types';

const AUTH_ERROR_RE =
  /authentication[_\s-]?failed|\bunauthorized\b|invalid[_\s-]?api[_\s-]?key|api[_\s-]?key[_\s-]?invalid|api[_\s]+key[_\s]+not[_\s]+valid|\bforbidden\b|permission[_\s-]?denied|\b401\b|\b403\b/i;
const RATE_LIMIT_RE = /rate[_\s-]?limit|too\s+many\s+requests|429/i;
const SERVER_ERROR_RE = /server[_\s-]?error|internal\s+server\s+error|\b5\d\d\b/i;
const NETWORK_ERROR_RE =
  /enotfound|econnrefused|etimedout|eai_again|enetunreach|timed?\s*out|timeout|abort|network\s*error|fetch failed/i;

export function isGeminiSdkProbeUnavailableError(message: string): boolean {
  return /models\.get|reading ['"]get['"]|reading get/i.test(message);
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** POST …/models/{id}:generateContent (pi-ai clears apiVersion when baseUrl is set). */
export function geminiRelayGenerateBaseUrl(baseUrl: string): string {
  return stripTrailingSlash(baseUrl.trim());
}

/** GET …/v1beta/models/{id} (matches @google/genai default path layout). */
export function geminiRelayMetadataBaseUrl(baseUrl: string): string {
  const base = stripTrailingSlash(baseUrl.trim());
  if (base.endsWith('/v1beta')) {
    return base;
  }
  if (base.endsWith('/gemini')) {
    return `${base}/v1beta`;
  }
  return `${base}/v1beta`;
}

export function geminiModelId(model: string): string {
  return model.trim().replace(/^models\//, '');
}

function mapHttpProbeError(status: number, body: string, latencyMs: number): ApiTestResult {
  const details = body.trim() || `HTTP ${status}`;
  const lowered = details.toLowerCase();

  if (status === 401 || status === 403 || AUTH_ERROR_RE.test(lowered)) {
    return { ok: false, latencyMs, status, errorType: 'unauthorized', details };
  }
  if (status === 404) {
    return { ok: false, latencyMs, status, errorType: 'not_found', details };
  }
  if (status === 429 || RATE_LIMIT_RE.test(lowered)) {
    return { ok: false, latencyMs, status, errorType: 'rate_limited', details };
  }
  if (status >= 500 || SERVER_ERROR_RE.test(lowered)) {
    return { ok: false, latencyMs, status, errorType: 'server_error', details };
  }
  return { ok: false, latencyMs, status, errorType: 'unknown', details };
}

function mapThrownProbeError(error: unknown, latencyMs: number): ApiTestResult {
  const details = error instanceof Error ? error.message : String(error);
  const lowered = details.toLowerCase();
  if (NETWORK_ERROR_RE.test(lowered)) {
    return { ok: false, latencyMs, errorType: 'network_error', details };
  }
  if (AUTH_ERROR_RE.test(lowered)) {
    return { ok: false, latencyMs, errorType: 'unauthorized', details };
  }
  return { ok: false, latencyMs, errorType: 'unknown', details };
}

/** Lightweight auth check: GET /v1beta/models/{model} against a Gemini-compatible relay (e.g. one-api). */
export async function fetchGeminiRelayModelMetadata(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}): Promise<void> {
  const modelId = geminiModelId(input.model);
  const url = `${geminiRelayMetadataBaseUrl(input.baseUrl)}/models/${encodeURIComponent(modelId)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 15000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'x-goog-api-key': input.apiKey },
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      const err = new Error(body || `HTTP ${response.status}`) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** Live inference probe via native Gemini generateContent (works with one-api /gemini base). */
export async function probeGeminiRelayGenerateContent(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}): Promise<ApiTestResult> {
  const started = Date.now();
  const modelId = geminiModelId(input.model);
  const url = `${geminiRelayGenerateBaseUrl(input.baseUrl)}/models/${encodeURIComponent(modelId)}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 30000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 16 },
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    const latencyMs = Date.now() - started;

    if (!response.ok) {
      return mapHttpProbeError(response.status, body, latencyMs);
    }

    return { ok: true, latencyMs, status: response.status };
  } catch (error) {
    return mapThrownProbeError(error, Date.now() - started);
  } finally {
    clearTimeout(timeout);
  }
}
