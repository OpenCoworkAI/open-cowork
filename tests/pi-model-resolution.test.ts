import { describe, expect, it } from 'vitest';
import {
  applyPiModelRuntimeOverrides,
  buildPiModelLookupCandidates,
  buildSyntheticPiModel,
  inferPiApi,
  resolvePiModelString,
} from '../src/main/claude/pi-model-resolution';

describe('pi model resolution helpers', () => {
  it('skips invalid custom raw provider lookups and deduplicates candidates', () => {
    const candidates = buildPiModelLookupCandidates('openai/gpt-5.4', {
      configProvider: 'openai',
      rawProvider: 'custom',
    });

    expect(candidates).toEqual([
      { provider: 'openai', model: 'gpt-5.4' },
      { provider: 'anthropic', model: 'gpt-5.4' },
      { provider: 'google', model: 'gpt-5.4' },
    ]);
  });

  it('prefers openrouter full model id before native provider lookup', () => {
    const candidates = buildPiModelLookupCandidates('anthropic/claude-sonnet-4-6', {
      configProvider: 'anthropic',
      rawProvider: 'openrouter',
    });

    expect(candidates).toEqual([
      { provider: 'openrouter', model: 'anthropic/claude-sonnet-4-6' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { provider: 'openai', model: 'claude-sonnet-4-6' },
      { provider: 'google', model: 'claude-sonnet-4-6' },
    ]);
  });

  it('builds provider-prefixed model ids from config-like input', () => {
    expect(resolvePiModelString({ provider: 'openai', customProtocol: 'openai', model: 'gpt-5.4' })).toBe('openai/gpt-5.4');
    expect(resolvePiModelString({ provider: 'custom', customProtocol: 'gemini', model: 'gemini-3-flash-preview' })).toBe('gemini/gemini-3-flash-preview');
    expect(resolvePiModelString({ provider: 'anthropic', customProtocol: 'anthropic', model: 'anthropic/claude-sonnet-4-6' })).toBe('anthropic/claude-sonnet-4-6');
  });

  it('builds synthetic models with protocol-specific api defaults', () => {
    expect(inferPiApi('anthropic')).toBe('anthropic-messages');
    expect(inferPiApi('gemini')).toBe('google-generative-ai');
    expect(inferPiApi('unknown')).toBe('openai-completions');

    const model = buildSyntheticPiModel('grok-code-fast-1', 'xai', 'openai', 'https://api.x.ai/v1');
    expect(model.id).toBe('grok-code-fast-1');
    expect(model.provider).toBe('xai');
    expect(model.api).toBe('openai-completions');
    expect(model.baseUrl).toBe('https://api.x.ai/v1');
  });

  it('downgrades openai responses api to completions for custom endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'gpt-5.4',
        name: 'gpt-5.4',
        api: 'openai-responses',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'openai',
        rawProvider: 'custom',
        customBaseUrl: 'https://relay.example.com/v1',
      }
    );

    expect(model.baseUrl).toBe('https://relay.example.com/v1');
    expect(model.api).toBe('openai-completions');
  });

  it('keeps openai responses api for first-party openai endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'gpt-5.4',
        name: 'gpt-5.4',
        api: 'openai-responses',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'openai',
        rawProvider: 'openai',
        customBaseUrl: 'https://api.openai.com/v1',
      }
    );

    expect(model.api).toBe('openai-responses');
  });
});
