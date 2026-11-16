import { describe, expect, it } from 'vitest';
import { OPENAI_CODEX_BASE_URL, isTrustedOpenAICodexBaseUrl } from '../../shared/openai-codex';

describe('isTrustedOpenAICodexBaseUrl', () => {
  it('accepts only the official ChatGPT Codex endpoint', () => {
    expect(isTrustedOpenAICodexBaseUrl(OPENAI_CODEX_BASE_URL)).toBe(true);
    expect(isTrustedOpenAICodexBaseUrl(`${OPENAI_CODEX_BASE_URL}/`)).toBe(true);
    expect(isTrustedOpenAICodexBaseUrl(`${OPENAI_CODEX_BASE_URL}/codex`)).toBe(true);
    expect(isTrustedOpenAICodexBaseUrl(`${OPENAI_CODEX_BASE_URL}/codex/responses`)).toBe(true);
    expect(isTrustedOpenAICodexBaseUrl('https://chatgpt.com.evil.test/backend-api/codex')).toBe(
      false
    );
    expect(isTrustedOpenAICodexBaseUrl('https://chatgpt.com/backend-api-evil')).toBe(false);
    expect(isTrustedOpenAICodexBaseUrl(`${OPENAI_CODEX_BASE_URL}?target=evil`)).toBe(false);
    expect(isTrustedOpenAICodexBaseUrl('http://chatgpt.com/backend-api/codex')).toBe(false);
  });
});
