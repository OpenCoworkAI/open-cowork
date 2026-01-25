import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import { PROVIDER_PRESETS } from './config-store';
import type { ApiTestInput, ApiTestResult } from '../../renderer/types';

const NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
]);

const REQUEST_TIMEOUT_MS = 10000;

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
    return { ok: false, status, errorType: 'unauthorized' };
  }
  if (status === 404) {
    return { ok: false, status, errorType: 'not_found' };
  }
  if (status === 429) {
    return { ok: false, status, errorType: 'rate_limited' };
  }
  if (typeof status === 'number' && status >= 500) {
    return { ok: false, status, errorType: 'server_error' };
  }
  if ((code && NETWORK_ERROR_CODES.has(code)) || (message && /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH/i.test(message))) {
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

export async function testApiConnection(input: ApiTestInput): Promise<ApiTestResult> {
  const apiKey = input.apiKey?.trim() || '';
  if (!apiKey) {
    return { ok: false, errorType: 'missing_key' };
  }

  const resolvedBaseUrl = resolveBaseUrl(input);
  const customUsesOpenAI = input.provider === 'custom' && input.customProtocol === 'openai';
  const useOpenAI = input.provider === 'openai' || customUsesOpenAI;
  // OpenRouter uses authToken (Authorization: Bearer), others use apiKey (X-Api-Key)
  const useAuthTokenHeader = input.provider === 'openrouter';
  const useLiveRequest = Boolean(input.useLiveRequest);

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
        apiKey,
        baseURL: resolvedBaseUrl,
        timeout: REQUEST_TIMEOUT_MS,
      });
      if (useLiveRequest) {
        const model = input.model || 'gpt-4o-mini';
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
              authToken: apiKey,
              baseURL: resolvedBaseUrl,
              timeout: REQUEST_TIMEOUT_MS,
            })
          : new Anthropic({
              apiKey: apiKey,
              baseURL: resolvedBaseUrl,
              timeout: REQUEST_TIMEOUT_MS,
            });
        if (useLiveRequest || useAuthTokenHeader) {
          // OpenRouter doesn't support models.list(), always use messages.create()
          // For other providers, use messages.create() only when useLiveRequest is true
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

    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return normalizeApiTestError(error);
  }
}
