import { describe, expect, it } from 'vitest';
import { buildPiSessionRuntimeSignature } from '../src/main/agent/pi-session-runtime';
import { DEFAULT_SUBAGENT_CONFIG } from '../src/shared/subagent-config';

describe('pi session runtime signature', () => {
  const baseInput = {
    configProvider: 'custom',
    customProtocol: 'openai',
    modelProvider: 'openai',
    modelApi: 'openai-completions',
    modelBaseUrl: 'https://relay.example.com/v1',
    effectiveCwd: '/workspace/demo',
    apiKey: 'sk-demo-key',
  };

  it('changes when provider runtime changes even if the session id stays the same', () => {
    const original = buildPiSessionRuntimeSignature(baseInput);
    const changedProvider = buildPiSessionRuntimeSignature({
      ...baseInput,
      configProvider: 'openrouter',
    });

    expect(changedProvider).not.toBe(original);
  });

  it('changes when base url, api, key, or cwd changes', () => {
    const original = buildPiSessionRuntimeSignature(baseInput);

    expect(
      buildPiSessionRuntimeSignature({
        ...baseInput,
        modelBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      })
    ).not.toBe(original);

    expect(
      buildPiSessionRuntimeSignature({
        ...baseInput,
        modelApi: 'openai-responses',
      })
    ).not.toBe(original);

    expect(
      buildPiSessionRuntimeSignature({
        ...baseInput,
        apiKey: 'sk-another-key',
      })
    ).not.toBe(original);

    expect(
      buildPiSessionRuntimeSignature({
        ...baseInput,
        effectiveCwd: '/workspace/other',
      })
    ).not.toBe(original);
  });

  it('normalizes equivalent urls with trailing slashes', () => {
    const original = buildPiSessionRuntimeSignature(baseInput);
    const normalized = buildPiSessionRuntimeSignature({
      ...baseInput,
      modelBaseUrl: 'https://relay.example.com/v1/',
    });

    expect(normalized).toBe(original);
  });

  it('refreshes cached tool descriptions after a named agent changes', () => {
    const input = { ...baseInput, subagent: DEFAULT_SUBAGENT_CONFIG };
    const original = buildPiSessionRuntimeSignature(input);
    const updated = buildPiSessionRuntimeSignature({
      ...input,
      subagent: {
        ...DEFAULT_SUBAGENT_CONFIG,
        presets: [
          ...DEFAULT_SUBAGENT_CONFIG.presets,
          { name: 'custom', description: 'Custom role', prompt: 'Review files.', model: '' },
        ],
      },
    });
    expect(updated).not.toBe(original);
    expect(buildPiSessionRuntimeSignature(structuredClone(input))).toBe(original);
  });
});
