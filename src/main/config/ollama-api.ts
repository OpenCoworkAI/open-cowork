import type { ApiTestInput, ApiTestResult, ProviderModelInfo } from '../../renderer/types';
import { isLoopbackBaseUrl } from '../../shared/network/loopback';
import { normalizeOllamaBaseUrl } from './auth-utils';

export const REQUEST_TIMEOUT_MS = 120000;
export const OLLAMA_MODELS_TIMEOUT_LOCAL_MS = 5000;
export const OLLAMA_MODELS_TIMEOUT_REMOTE_MS = 8000;
const OLLAMA_MODELS_CACHE_TTL_MS = 10000;

interface OllamaModelIndexResult {
  baseUrl: string;
  models: ProviderModelInfo[];
}

const modelIndexCache = new Map<string, { expiresAt: number; result: OllamaModelIndexResult }>();
const modelIndexInflight = new Map<string, Promise<OllamaModelIndexResult>>();

export function resetOllamaModelIndexCache(): void {
  modelIndexCache.clear();
  modelIndexInflight.clear();
}

function buildBaseUrl(baseUrl: string | undefined): string {
  return normalizeOllamaBaseUrl(baseUrl) || 'http://localhost:11434/v1';
}

function buildCacheKey(baseUrl: string, apiKey: string | undefined): string {
  return `${baseUrl}::${apiKey?.trim() || ''}`;
}

function resolveModelsTimeoutMs(baseUrl: string): number {
  return isLoopbackBaseUrl(baseUrl)
    ? OLLAMA_MODELS_TIMEOUT_LOCAL_MS
    : OLLAMA_MODELS_TIMEOUT_REMOTE_MS;
}

function buildHeaders(apiKey: string | undefined): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const trimmedApiKey = apiKey?.trim();
  if (trimmedApiKey) {
    headers.Authorization = `Bearer ${trimmedApiKey}`;
  }
  return headers;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const causeMessage =
      typeof (error as Error & { cause?: { message?: unknown } }).cause?.message === 'string'
        ? (error as Error & { cause?: { message?: string } }).cause!.message
        : '';
    return [error.message, causeMessage].filter(Boolean).join(' | ');
  }
  return String(error);
}

function extractErrorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return '';
  }
  const directCode =
    typeof (error as Error & { code?: unknown }).code === 'string'
      ? (error as Error & { code?: string }).code
      : '';
  const causeCode =
    typeof (error as Error & { cause?: { code?: unknown } }).cause?.code === 'string'
      ? (error as Error & { cause?: { code?: string } }).cause!.code
      : '';
  return directCode || causeCode || '';
}

export function normalizeError(error: unknown): ApiTestResult {
  const message = extractErrorMessage(error);
  const code = extractErrorCode(error);
  if (/401|403|unauthorized|forbidden/i.test(message)) {
    return { ok: false, errorType: 'unauthorized', details: message };
  }
  if (/404|not found/i.test(message)) {
    return { ok: false, errorType: 'not_found', details: message };
  }
  if (/429|rate limit|too many requests/i.test(message)) {
    return { ok: false, errorType: 'rate_limited', details: message };
  }
  if (/5\d\d|server error|internal error/i.test(message)) {
    return { ok: false, errorType: 'server_error', details: message };
  }
  if (code === 'ECONNREFUSED' || /econnrefused/i.test(message)) {
    return { ok: false, errorType: 'ollama_not_running', details: message };
  }
  if (/timed?\s*out|timeout|abort/i.test(message)) {
    return { ok: false, errorType: 'ollama_loading', details: message };
  }
  if (
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    /network|fetch failed|enotfound|eai_again/i.test(message)
  ) {
    return { ok: false, errorType: 'network_error', details: message };
  }
  return { ok: false, errorType: 'unknown', details: message };
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Failed to parse Ollama API response: ${text.substring(0, 200)}`);
  }
}

export async function fetchOllamaModelIndex(input: {
  baseUrl?: string;
  apiKey?: string;
}): Promise<OllamaModelIndexResult> {
  const baseUrl = buildBaseUrl(input.baseUrl);
  const cacheKey = buildCacheKey(baseUrl, input.apiKey);
  const now = Date.now();
  const cached = modelIndexCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }

  const inflight = modelIndexInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const request = (async (): Promise<OllamaModelIndexResult> => {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: buildHeaders(input.apiKey),
      signal: AbortSignal.timeout(resolveModelsTimeoutMs(baseUrl)),
    });
    const data = await parseJsonResponse(response);
    const models = (Array.isArray(data?.data) ? data.data : [])
      .map((item: unknown) => {
        const modelItem = item as { id?: unknown };
        const id = typeof modelItem?.id === 'string' ? modelItem.id.trim() : '';
        if (!id) {
          return null;
        }
        return {
          id,
          name: id,
        };
      })
      .filter((item: ProviderModelInfo | null): item is ProviderModelInfo => Boolean(item));

    const result = { baseUrl, models };
    modelIndexCache.set(cacheKey, {
      expiresAt: Date.now() + OLLAMA_MODELS_CACHE_TTL_MS,
      result,
    });
    return result;
  })();

  modelIndexInflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    modelIndexInflight.delete(cacheKey);
  }
}

export async function listOllamaModels(input: {
  baseUrl?: string;
  apiKey?: string;
}): Promise<ProviderModelInfo[]> {
  const result = await fetchOllamaModelIndex(input);
  return result.models;
}

export async function testOllamaConnection(input: ApiTestInput): Promise<ApiTestResult> {
  const start = Date.now();
  try {
    if (input.useLiveRequest) {
      const model = input.model?.trim();
      if (!model) {
        return { ok: false, errorType: 'unknown', details: 'missing_model' };
      }
      const response = await fetch(`${buildBaseUrl(input.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(input.apiKey),
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      await parseJsonResponse(response);
    } else {
      await listOllamaModels({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
      });
    }

    return {
      ok: true,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      ...normalizeError(error),
      latencyMs: Date.now() - start,
    };
  }
}
