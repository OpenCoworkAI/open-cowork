import type { ApiTestInput, ApiTestResult, ProviderModelInfo } from '../../renderer/types';
import { normalizeOllamaBaseUrl } from './auth-utils';

const REQUEST_TIMEOUT_MS = 30000;

function buildBaseUrl(baseUrl: string | undefined): string {
  return normalizeOllamaBaseUrl(baseUrl) || 'http://localhost:11434/v1';
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
  const directCode = typeof (error as Error & { code?: unknown }).code === 'string'
    ? (error as Error & { code?: string }).code
    : '';
  const causeCode = typeof (error as Error & { cause?: { code?: unknown } }).cause?.code === 'string'
    ? (error as Error & { cause?: { code?: string } }).cause!.code
    : '';
  return directCode || causeCode || '';
}

function normalizeError(error: unknown): ApiTestResult {
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
  if (
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    /timed?\s*out|timeout|network|fetch failed|enotfound|eai_again/i.test(message)
  ) {
    return { ok: false, errorType: 'network_error', details: message };
  }
  return { ok: false, errorType: 'unknown', details: message };
}

async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return text ? JSON.parse(text) : {};
}

export async function listOllamaModels(input: {
  baseUrl?: string;
  apiKey?: string;
}): Promise<ProviderModelInfo[]> {
  const response = await fetch(`${buildBaseUrl(input.baseUrl)}/models`, {
    method: 'GET',
    headers: buildHeaders(input.apiKey),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await parseJsonResponse(response);
  const models = Array.isArray(data?.data) ? data.data : [];
  return models
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
