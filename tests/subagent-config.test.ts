import { describe, expect, it } from 'vitest';
import { normalizeSubagentConfig } from '../src/shared/subagent-config';

describe('subagent configuration', () => {
  it('preserves legacy defaults and rejects duplicate or invalid roles', () => {
    const config = normalizeSubagentConfig();
    expect(config.maxConcurrent).toBe(3);
    expect(config.presets.map((preset) => preset.name)).toContain('reviewer');
    expect(() => normalizeSubagentConfig({ ...config, maxConcurrent: 0 })).toThrow();
    expect(() =>
      normalizeSubagentConfig({ ...config, presets: [config.presets[0], config.presets[0]] })
    ).toThrow('unique');
    expect(() => normalizeSubagentConfig({ ...config, defaultAgent: 'missing' })).toThrow(
      'Unknown'
    );
  });
});
