import { describe, expect, it } from 'vitest';
import { extractCodexModelIds, getFallbackCodexModels } from '../src/main/codex/codex-models';

describe('codex models helpers', () => {
  it('parses official Codex model ids from docs-like content', () => {
    const ids = extractCodexModelIds(`
      ## Recommended models
      gpt-5.4
      codex -m gpt-5.4
      gpt-5.4-mini
      codex -m gpt-5.4-mini
      gpt-5.3-codex
      codex -m gpt-5.3-codex
      gpt-5.3-codex-spark
      codex -m gpt-5.3-codex-spark
      ## Alternative models
      gpt-5.2-codex
      codex -m gpt-5.2-codex
    `);

    expect(ids).toEqual([
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.3-codex-spark',
      'gpt-5.2-codex',
    ]);
  });

  it('keeps a current fallback Codex model list', () => {
    expect(getFallbackCodexModels().map((item) => item.id)).toEqual(
      expect.arrayContaining(['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex'])
    );
  });
});
