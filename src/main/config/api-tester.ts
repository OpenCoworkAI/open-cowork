import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import { PROVIDER_PRESETS } from './config-store';
import {
  buildOpenAICodexHeaders,
  resolveOpenAICredentials,
  shouldUseAnthropicAuthToken,
} from './auth-utils';
import type { ApiTestInput, ApiTestResult } from '../../renderer/types';
import { log, logWarn } from '../utils/logger';

const NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
]);

const REQUEST_TIMEOUT_MS = 30000;
const CODEX_USAGE_ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage';

type ApiTestError = Error & { status?: number };

function normalizeApiTestError(error: unknown): ApiTestResult {
  const err = error as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
    code?: string;
    message?: string;
    error?: { message?: string };
    cause?: { code?: string; message?: string };
  };
  const status = err?.status ?? err?.statusCode ?? err?.response?.status;
  const code = err?.code ?? err?.cause?.code;
  const message = err?.message ?? err?.error?.message ?? err?.cause?.message;

  if (status === 401 || status === 403) {
    return { ok: false, status, errorType: 'unauthorized', details: message };
  }
  if (status === 404) {
    return { ok: false, status, errorType: 'not_found', details: message };
  }
  if (status === 429) {
    return { ok: false, status, errorType: 'rate_limited', details: message };
  }
  if (typeof status === 'number' && status >= 500) {
    return { ok: false, status, errorType: 'server_error' };
  }
  if (
    (code && NETWORK_ERROR_CODES.has(code)) ||
    (message && /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|timed?\s*out|timeout|abort/i.test(message))
  ) {
    return { ok: false, status, errorType: 'network_error', details: message || code };
  }

  return { ok: false, status, errorType: 'unknown', details: message };
}

function resolveBaseUrl(input: ApiTestInput): string | undefined {
  if (input.baseUrl && input.baseUrl.trim()) {
    return input.baseUrl.trim();
  }
  if (input.provider !== 'custom') {
    return PROVIDER_PRESETS[input.provider]?.baseUrl;
  }
  return undefined;
}

function withStatusError(status: number, message: string): ApiTestError {
  const error = new Error(message) as ApiTestError;
  error.status = status;
  return error;
}

async function testCodexUsageEndpoint(apiKey: string, accountId?: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(CODEX_USAGE_ENDPOINT, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...buildOpenAICodexHeaders(accountId),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const bodyText = await response.text();
      logWarn('[Config][ApiTest] Codex usage probe failed', {
        status: response.status,
        hasAccountId: Boolean(accountId),
        bodyPreview: bodyText.slice(0, 300),
      });
      throw withStatusError(response.status, bodyText);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function testCodexLiveRequest(client: OpenAI, model: string): Promise<void> {
  const stream = client.responses.stream({
    model,
    instructions: 'You are a connectivity probe. Reply with a single short word.',
    store: false,
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'ping' }] }],
  });

  for await (const _event of stream) {
    // drain stream
  }
  await stream.finalResponse();
}

export async function testApiConnection(input: ApiTestInput): Promise<ApiTestResult> {
  const apiKey = input.apiKey?.trim() || '';
  const resolvedBaseUrl = resolveBaseUrl(input);
  const customUsesOpenAI = input.provider === 'custom' && input.customProtocol === 'openai';
  const useOpenAI = input.provider === 'openai' || customUsesOpenAI;
  const resolvedOpenAI = useOpenAI
    ? resolveOpenAICredentials({
        provider: input.provider,
        customProtocol: input.customProtocol,
        apiKey,
        baseUrl: resolvedBaseUrl,
      })
    : null;
  const effectiveApiKey = useOpenAI ? resolvedOpenAI?.apiKey ?? '' : apiKey;
  const useAuthTokenHeader = shouldUseAnthropicAuthToken({
    provider: input.provider,
    customProtocol: input.customProtocol,
    apiKey: effectiveApiKey,
  });
  const useLiveRequest = Boolean(input.useLiveRequest);
  const useCodexOAuth = Boolean(resolvedOpenAI?.useCodexOAuth);
  log('[Config][ApiTest] Start', {
    provider: input.provider,
    customProtocol: input.customProtocol || undefined,
    useOpenAI,
    useCodexOAuth,
    source: resolvedOpenAI?.source || undefined,
    hasApiKey: Boolean(effectiveApiKey),
    baseUrl: useOpenAI ? (resolvedOpenAI?.baseUrl || resolvedBaseUrl || '(default)') : (resolvedBaseUrl || '(default)'),
    model: input.model || undefined,
    live: useLiveRequest,
  });

  if (!effectiveApiKey) {
    logWarn('[Config][ApiTest] Missing credentials for test');
    return useOpenAI
      ? {
          ok: false,
          errorType: 'missing_key',
          details: 'No API key or local Codex login found. Please run: codex auth login',
        }
      : { ok: false, errorType: 'missing_key' };
  }

  if (input.provider === 'custom' && !resolvedBaseUrl) {
    return { ok: false, errorType: 'missing_base_url' };
  }

  if (!useOpenAI && input.provider !== 'anthropic' && !resolvedBaseUrl) {
    return { ok: false, errorType: 'missing_base_url' };
  }

  const start = Date.now();

  try {
    if (useOpenAI) {
      const client = new OpenAI({
        apiKey: effectiveApiKey,
        baseURL: resolvedOpenAI?.baseUrl || resolvedBaseUrl,
        ...(useCodexOAuth ? { defaultHeaders: buildOpenAICodexHeaders(resolvedOpenAI?.accountId) } : {}),
        timeout: REQUEST_TIMEOUT_MS,
      });

      if (useCodexOAuth && !useLiveRequest) {
        await testCodexUsageEndpoint(effectiveApiKey, resolvedOpenAI?.accountId);
      } else if (useLiveRequest) {
        const model = input.model || (useCodexOAuth ? 'gpt-5.3-codex' : 'gpt-4o-mini');
        if (useCodexOAuth) {
          await testCodexLiveRequest(client, model);
        } else {
          try {
            await client.responses.create({
              model,
              input: 'ping',
              max_output_tokens: 1,
            });
          } catch (error) {
            await client.chat.completions.create({
              model,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 1,
            });
          }
        }
      } else {
        await client.models.list();
      }
    } else {
      // Save and clear environment variables to prevent SDK from reading them
      // SDK checks env vars if apiKey/authToken not explicitly provided
      const savedApiKey = process.env.ANTHROPIC_API_KEY;
      const savedAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_AUTH_TOKEN;
      
      try {
        // Build client with explicit credentials
        const client = useAuthTokenHeader
          ? new Anthropic({
              authToken: effectiveApiKey,
              baseURL: resolvedBaseUrl,
              timeout: REQUEST_TIMEOUT_MS,
            })
          : new Anthropic({
              apiKey: effectiveApiKey,
              baseURL: resolvedBaseUrl,
              timeout: REQUEST_TIMEOUT_MS,
            });
        // Anthropic-compatible custom providers usually don't support models.list().
        // Use a tiny messages.create request as a universal connectivity check.
        if (useLiveRequest || useAuthTokenHeader || input.provider === 'custom') {
          // OpenRouter/custom Anthropic-compatible services don't reliably support models.list(),
          // so we use a tiny messages.create request for compatibility.
          const model = input.model || 'claude-sonnet-4-5';
          await client.messages.create({
            model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          });
        } else {
          // Anthropic direct API supports models.list() for quick connectivity check
          await client.models.list();
        }
      } finally {
        // Restore environment variables
        if (savedApiKey !== undefined) {
          process.env.ANTHROPIC_API_KEY = savedApiKey;
        }
        if (savedAuthToken !== undefined) {
          process.env.ANTHROPIC_AUTH_TOKEN = savedAuthToken;
        }
      }
    }

    const result = { ok: true, latencyMs: Date.now() - start } as ApiTestResult;
    log('[Config][ApiTest] Success', {
      provider: input.provider,
      useOpenAI,
      useCodexOAuth,
      latencyMs: result.latencyMs,
    });
    return result;
  } catch (error) {
    const normalized = normalizeApiTestError(error);
    logWarn('[Config][ApiTest] Failed', {
      provider: input.provider,
      useOpenAI,
      useCodexOAuth,
      status: normalized.status,
      errorType: normalized.errorType,
      details: normalized.details?.slice(0, 300),
    });
    return normalized;
  }
}
