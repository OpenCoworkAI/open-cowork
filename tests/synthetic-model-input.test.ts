import { describe, it, expect } from 'vitest';
import { buildSyntheticPiModel } from '../src/main/claude/pi-model-resolution';

/**
 * Regression guard for the text-only-model image bug.
 *
 * Synthetic models (built for ids not in the pi-ai registry) must NOT claim
 * image input. Falsely advertising vision support means image content — e.g.
 * screenshots from the GUI/computer-use tools — is sent to text-only endpoints,
 * which hard-fail instead of gracefully dropping the images. For example Ollama
 * returns HTTP 400 "this model does not support image input" for a text-only
 * model like deepseek-v4-pro, which the app surfaces as an opaque
 * "invalid message format" error.
 */
describe('buildSyntheticPiModel input modalities', () => {
  it('defaults an unknown synthetic model to text-only input', () => {
    const m = buildSyntheticPiModel('deepseek-v4-pro', 'openai', 'openai', 'https://ollama.com/v1');
    expect(m.input).toEqual(['text']);
    expect(m.input).not.toContain('image');
  });

  it('still resolves other core model fields normally', () => {
    const m = buildSyntheticPiModel('some-custom-model', 'openai', 'openai', 'https://example.com/v1');
    expect(m.id).toBe('some-custom-model');
    expect(m.api).toBeTruthy();
    expect(m.contextWindow).toBeGreaterThan(0);
    expect(m.maxTokens).toBeGreaterThan(0);
  });
});
