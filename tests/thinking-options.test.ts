import { describe, it, expect } from 'vitest';

import { buildThinkingOptions } from '../src/main/claude/thinking-options';

describe('buildThinkingOptions', () => {
  it('returns enabled thinking config when enabled', () => {
    expect(buildThinkingOptions(true)).toEqual({
      type: 'enabled',
      budget_tokens: 10000,
    });
  });

  it('returns disabled thinking config when disabled', () => {
    expect(buildThinkingOptions(false)).toEqual({
      type: 'disabled',
    });
  });
});
