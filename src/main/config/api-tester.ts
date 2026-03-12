import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import { PROVIDER_PRESETS } from './config-store';
import {
  normalizeAnthropicBaseUrl,
  resolveOpenAICredentials,
  shouldAllowEmptyAnthropicApiKey,
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
const LOCAL_ANTHROPIC_PLACEHOLDER_KEY = 'sk-ant-local-proxy';

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
  const normalizeForAnthropic = (value: string | undefined): string | undefined => (
    input.provider === 'openai' || (input.provider === 'custom' && input.customProtocol === 'openai')
      ? value
      : normalizeAnthropicBaseUrl(value)
  );
  if (input.baseUrl && input.baseUrl.trim()) {
    return normalizeForAnthropic(input.baseUrl.trim());
  }
  if (input.provider !== 'custom') {
    return normalizeForAnthropic(PROVIDER_PRESETS[input.provider]?.baseUrl);
  }
  return undefined;
}

interface OpenAITestCredentials {
  apiKey: string;
  baseUrl?: string;
}

async function testOpenAICredentials(
  credentials: OpenAITestCredentials,
  modelInput: string | undefined,
  useLiveRequest: boolean
): Promise<void> {
  const client = new OpenAI({
    apiKey: credentials.apiKey,
    baseURL: credentials.baseUrl,
    timeout: REQUEST_TIMEOUT_MS,
  });

  if (useLiveRequest) {
    const model = modelInput || 'gpt-5-mini';
    try {
      await client.responses.create({
        model,
        input: 'ping',
        max_output_tokens: 1,
      });
    } catch {
      await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      });
    }
    return;
  }

  await client.models.list();
}

export async function testApiConnection(input: ApiTestInput): Promise<ApiTestResult> {
  const apiKey = input.apiKey?.trim() || '';
  const resolvedBaseUrl = resolveBaseUrl(input);
  const customUsesOpenAI = input.provider === 'custom' && input.customProtocol === 'openai';
  const useOpenAI = input.provider === 'openai' || customUsesOpenAI;
  const allowEmptyAnthropicApiKey = shouldAllowEmptyAnthropicApiKey({
    provider: input.provider,
    customProtocol: input.customProtocol,
    baseUrl: resolvedBaseUrl,
  });
  const resolvedOpenAI = useOpenAI
    ? resolveOpenAICredentials({
        provider: input.provider,
        customProtocol: input.customProtocol,
        apiKey,
        baseUrl: resolvedBaseUrl,
      })
    : null;
  const effectiveApiKey = apiKey || (allowEmptyAnthropicApiKey ? LOCAL_ANTHROPIC_PLACEHOLDER_KEY : '');
  const useAuthTokenHeader = shouldUseAnthropicAuthToken({
    provider: input.provider,
    customProtocol: input.customProtocol,
    apiKey: effectiveApiKey,
  });
  const useLiveRequest = Boolean(input.useLiveRequest);
  log('[Config][ApiTest] Start', {
    provider: input.provider,
    customProtocol: input.customProtocol || undefined,
    useOpenAI,
    hasApiKey: Boolean(apiKey),
    baseUrl: useOpenAI ? (resolvedOpenAI?.baseUrl || '(default)') : (resolvedBaseUrl || '(default)'),
    model: input.model || undefined,
    live: useLiveRequest,
  });

  if (useOpenAI && !apiKey) {
    logWarn('[Config][ApiTest] Missing credentials for test');
    return {
      ok: false,
      errorType: 'missing_key',
      details: 'No API key provided.',
    };
  }

  if (!useOpenAI && !effectiveApiKey) {
    logWarn('[Config][ApiTest] Missing credentials for test');
    return { ok: false, errorType: 'missing_key' };
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
      await testOpenAICredentials(
        {
          apiKey,
          baseUrl: resolvedOpenAI?.baseUrl || resolvedBaseUrl,
        },
        input.model,
        useLiveRequest
      );
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
          const model = input.model || 'claude-sonnet-4-6';
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
      latencyMs: result.latencyMs,
    });
    return result;
  } catch (error) {
    const normalized = normalizeApiTestError(error);
    logWarn('[Config][ApiTest] Failed', {
      provider: input.provider,
      useOpenAI,
      status: normalized.status,
      errorType: normalized.errorType,
      details: normalized.details?.slice(0, 300),
    });
    return normalized;
  }
}
