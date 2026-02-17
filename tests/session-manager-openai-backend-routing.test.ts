import { describe, expect, it } from 'vitest';
import { selectOpenAIBackendRoute } from '../src/main/session/openai-backend-routing';

describe('selectOpenAIBackendRoute', () => {
  it('uses codex-cli when local codex login exists and api key exists', () => {
    expect(selectOpenAIBackendRoute({ hasLocalCodexLogin: true, apiKey: 'sk-test' })).toBe('codex-cli');
  });

  it('uses codex-cli when local codex login exists and api key missing', () => {
    expect(selectOpenAIBackendRoute({ hasLocalCodexLogin: true, apiKey: '' })).toBe('codex-cli');
  });

  it('falls back to responses when local login missing but api key exists', () => {
    expect(selectOpenAIBackendRoute({ hasLocalCodexLogin: false, apiKey: 'sk-test' })).toBe('responses-fallback');
  });

  it('uses codex-cli when both local login and api key are missing', () => {
    expect(selectOpenAIBackendRoute({ hasLocalCodexLogin: false, apiKey: '' })).toBe('codex-cli');
  });
});
