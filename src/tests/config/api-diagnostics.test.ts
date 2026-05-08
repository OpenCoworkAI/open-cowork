import { describe, expect, it } from 'vitest';
import {
  isLikelyAuthFailure,
  shouldContinueAfterGeminiAuthProbeError,
} from '../../main/config/api-diagnostics';

describe('Gemini diagnostics auth probe handling', () => {
  it('continues to model verification when the lightweight models.get probe is unavailable', () => {
    expect(
      shouldContinueAfterGeminiAuthProbeError({
        message: "Cannot read properties of undefined (reading 'get')",
      })
    ).toBe(true);

    expect(
      shouldContinueAfterGeminiAuthProbeError({
        status: 404,
        message: 'not found',
      })
    ).toBe(true);
  });

  it('does not continue when the auth probe fails with a network error', () => {
    expect(
      shouldContinueAfterGeminiAuthProbeError({
        message: 'fetch failed',
      })
    ).toBe(false);
  });

  it('does not continue past likely credential failures', () => {
    const invalidKey = {
      status: 400,
      message: 'API key not valid. Please pass a valid API key.',
    };

    expect(isLikelyAuthFailure(invalidKey)).toBe(true);
    expect(shouldContinueAfterGeminiAuthProbeError(invalidKey)).toBe(false);
  });
});
