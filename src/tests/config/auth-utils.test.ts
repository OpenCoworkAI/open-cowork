import { describe, it, expect } from 'vitest';
import { normalizeOpenAICompatibleBaseUrl } from '../../main/config/auth-utils';

describe('normalizeOpenAICompatibleBaseUrl', () => {
  // --- Empty / undefined inputs ---
  it('returns undefined for undefined input', () => {
    expect(normalizeOpenAICompatibleBaseUrl(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(normalizeOpenAICompatibleBaseUrl('')).toBeUndefined();
  });

  it('returns undefined for whitespace-only string', () => {
    expect(normalizeOpenAICompatibleBaseUrl('   ')).toBeUndefined();
  });

  // --- URLs that already end with /v1 (should be unchanged) ---
  it('preserves URL that already ends with /v1', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1'
    );
  });

  it('preserves URL with sub-path ending in /v1', () => {
    expect(
      normalizeOpenAICompatibleBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1')
    ).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  // --- URLs without /v1 (should NOT be modified — respect user intent) ---
  it('preserves bare host URL without appending /v1', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://my-proxy.example.com')).toBe(
      'https://my-proxy.example.com'
    );
  });

  it('preserves URL with custom path without appending /v1', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://dashscope.aliyuncs.com/compatible-mode')).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode'
    );
  });

  it('preserves URL with /v2 path (no /v1 auto-append)', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://api.example.com/v2')).toBe(
      'https://api.example.com/v2'
    );
  });

  // --- URLs with /chat/completions suffix (should be stripped) ---
  it('strips /v1/chat/completions and preserves /v1', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1/chat/completions')).toBe(
      'https://api.openai.com/v1'
    );
  });

  it('strips /chat/completions from sub-path', () => {
    expect(
      normalizeOpenAICompatibleBaseUrl(
        'https://dashscope.aliyuncs.com/compatible-mode/chat/completions'
      )
    ).toBe('https://dashscope.aliyuncs.com/compatible-mode');
  });

  it('strips /chat/completions from bare host', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://my-proxy.example.com/chat/completions')).toBe(
      'https://my-proxy.example.com'
    );
  });

  it('strips /v1/chat/completions from sub-path URL', () => {
    expect(
      normalizeOpenAICompatibleBaseUrl(
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
      )
    ).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  // --- Strips /completions (legacy endpoint) ---
  it('strips /v1/completions suffix', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1/completions')).toBe(
      'https://api.openai.com/v1'
    );
  });

  // --- Strips /responses (OpenAI responses API) ---
  it('strips /v1/responses suffix', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1/responses')).toBe(
      'https://api.openai.com/v1'
    );
  });

  // --- Trailing slashes ---
  it('cleans trailing slashes from URL ending with /v1/', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1'
    );
  });

  it('cleans multiple trailing slashes', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1///')).toBe(
      'https://api.openai.com/v1'
    );
  });

  // --- OpenRouter URLs (special handling preserved) ---
  it('adds /api/v1 to bare OpenRouter URL', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai')).toBe(
      'https://openrouter.ai/api/v1'
    );
  });

  it('adds /api/v1 to OpenRouter URL with trailing slash', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai/')).toBe(
      'https://openrouter.ai/api/v1'
    );
  });

  it('completes /api to /api/v1 for OpenRouter', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai/api')).toBe(
      'https://openrouter.ai/api/v1'
    );
  });

  it('preserves correct OpenRouter /api/v1 path', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai/api/v1')).toBe(
      'https://openrouter.ai/api/v1'
    );
  });

  it('strips /chat/completions from OpenRouter URL', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai/api/v1/chat/completions')).toBe(
      'https://openrouter.ai/api/v1'
    );
  });

  it('strips /completions from OpenRouter URL', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai/api/v1/completions')).toBe(
      'https://openrouter.ai/api/v1'
    );
  });

  it('strips /responses from OpenRouter URL', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai/api/v1/responses')).toBe(
      'https://openrouter.ai/api/v1'
    );
  });

  // --- DeepSeek URLs (official OpenAI-compatible endpoint) ---
  it('normalizes DeepSeek bare host to /v1', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/v1'
    );
  });

  it('normalizes DeepSeek /anthropic URL to /v1', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://api.deepseek.com/anthropic')).toBe(
      'https://api.deepseek.com/v1'
    );
  });

  it('strips DeepSeek endpoint suffixes before normalizing to /v1', () => {
    expect(
      normalizeOpenAICompatibleBaseUrl('https://api.deepseek.com/anthropic/chat/completions')
    ).toBe('https://api.deepseek.com/v1');
  });

  // --- Whitespace handling ---
  it('trims leading and trailing whitespace', () => {
    expect(normalizeOpenAICompatibleBaseUrl('  https://api.openai.com/v1  ')).toBe(
      'https://api.openai.com/v1'
    );
  });

  // --- Port and protocol preservation ---
  it('preserves port in URL', () => {
    expect(normalizeOpenAICompatibleBaseUrl('http://localhost:8080')).toBe('http://localhost:8080');
  });

  it('preserves port in URL that already has /v1', () => {
    expect(normalizeOpenAICompatibleBaseUrl('http://localhost:8080/v1')).toBe(
      'http://localhost:8080/v1'
    );
  });

  // --- MSRA relay URL (important for this project) ---
  it('preserves MSRA relay URL with /v1 suffix', () => {
    expect(
      normalizeOpenAICompatibleBaseUrl('https://msra-im-relay.servicebus.windows.net/coproxy/v1')
    ).toBe('https://msra-im-relay.servicebus.windows.net/coproxy/v1');
  });

  // --- Idempotency ---
  it('is idempotent — calling twice produces same result', () => {
    const url = 'https://api.openai.com/v1/chat/completions';
    const once = normalizeOpenAICompatibleBaseUrl(url);
    const twice = normalizeOpenAICompatibleBaseUrl(once);
    expect(twice).toBe(once);
  });

  it('is idempotent for bare URL', () => {
    const url = 'https://api.deepseek.com';
    const once = normalizeOpenAICompatibleBaseUrl(url);
    const twice = normalizeOpenAICompatibleBaseUrl(once);
    expect(twice).toBe(once);
  });
});
