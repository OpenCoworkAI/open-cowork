import { describe, expect, it } from 'vitest';
import {
  applyPiModelRuntimeOverrides,
  buildPiModelLookupCandidates,
  buildSyntheticPiModel,
  inferPiApi,
  resolvePiModelString,
  resolvePiRouteProtocol,
  resolveSyntheticPiModelFallback,
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

  it('routes openrouter through the openai-compatible protocol', () => {
    expect(resolvePiRouteProtocol('openrouter', 'anthropic')).toBe('openai');
    expect(resolvePiRouteProtocol('ollama', 'openai')).toBe('openai');
    expect(resolvePiRouteProtocol('custom', 'gemini')).toBe('gemini');
    expect(resolvePiRouteProtocol('custom', 'anthropic')).toBe('anthropic');
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

  it('preserves explicit provider-prefixed ids for openrouter synthetic fallbacks', () => {
    const fallback = resolveSyntheticPiModelFallback({
      rawModel: 'z-ai/glm-5-turbo',
      resolvedModelString: 'z-ai/glm-5-turbo',
      rawProvider: 'openrouter',
      routeProtocol: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
    });

    expect(fallback).toEqual({
      provider: 'openrouter',
      modelId: 'z-ai/glm-5-turbo',
    });
  });

  it('strips helper-added provider prefixes for first-party openai fallbacks', () => {
    const fallback = resolveSyntheticPiModelFallback({
      rawModel: 'gpt-5.4',
      resolvedModelString: 'openai/gpt-5.4',
      rawProvider: 'openai',
      routeProtocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
    });

    expect(fallback).toEqual({
      provider: 'openai',
      modelId: 'gpt-5.4',
    });
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

  it('disables developer role for third-party openai-compatible endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'kimi-k2.5',
        name: 'kimi-k2.5',
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'openai',
        rawProvider: 'openai',
        customBaseUrl: 'https://api.moonshot.cn/v1',
      }
    );

    expect(model.baseUrl).toBe('https://api.moonshot.cn/v1');
    expect(model.compat?.supportsDeveloperRole).toBe(false);
  });

  it('keeps developer role enabled for first-party openai endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'gpt-5.4',
        name: 'gpt-5.4',
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: true,
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

    expect(model.compat?.supportsDeveloperRole).toBeUndefined();
  });

  it('auto-detects reasoning models by model id pattern', () => {
    const thinking = buildSyntheticPiModel('kimi-k2-thinking', 'moonshot', 'openai', 'https://api.moonshot.cn/v1');
    expect(thinking.reasoning).toBe(true);

    const kimiK2 = buildSyntheticPiModel('kimi-k2.5', 'moonshot', 'openai', 'https://api.moonshot.cn/v1');
    expect(kimiK2.reasoning).toBe(true);

    const deepseekR1 = buildSyntheticPiModel('deepseek-r1-distill', 'deepseek', 'openai', 'https://api.deepseek.com/v1');
    expect(deepseekR1.reasoning).toBe(true);

    const reasoner = buildSyntheticPiModel('o3-reasoner', 'openai', 'openai');
    expect(reasoner.reasoning).toBe(true);

    // Non-reasoning models should default to false
    const gpt = buildSyntheticPiModel('gpt-5.4', 'openai', 'openai');
    expect(gpt.reasoning).toBe(false);

    const llama = buildSyntheticPiModel('llama-4-scout', 'meta', 'openai');
    expect(llama.reasoning).toBe(false);
  });

  it('allows explicit reasoning override in buildSyntheticPiModel', () => {
    // Force reasoning=true on a model that wouldn't auto-detect
    const forced = buildSyntheticPiModel('custom-model', 'custom', 'openai', '', undefined, true);
    expect(forced.reasoning).toBe(true);

    // Force reasoning=false on a model that would auto-detect
    const suppressed = buildSyntheticPiModel('kimi-k2.5', 'moonshot', 'openai', '', undefined, false);
    expect(suppressed.reasoning).toBe(false);
  });

  it('does not false-positive on models with thinking as a substring', () => {
    // "critical-thinking-v2" should NOT match — \bthinking\b requires word boundary,
    // but here "thinking" IS a whole word between hyphens, so it WILL match.
    // This is intentional — hyphens are not \w so \b fires.
    const critical = buildSyntheticPiModel('critical-thinking-v2', 'custom', 'openai');
    expect(critical.reasoning).toBe(true);

    // But a model like "rethinkingai" should NOT match — no word boundary around "thinking"
    const rethinking = buildSyntheticPiModel('rethinkingai', 'custom', 'openai');
    expect(rethinking.reasoning).toBe(false);
  });

  it('disables developer role for ollama with custom endpoint', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'qwen3:8b',
        name: 'qwen3:8b',
        api: 'openai-completions',
        provider: 'ollama',
        baseUrl: '',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 40960,
        maxTokens: 8192,
      },
      {
        configProvider: 'ollama',
        rawProvider: 'ollama',
        customBaseUrl: 'http://localhost:11434/v1',
      },
    );

    expect(model.baseUrl).toBe('http://localhost:11434/v1');
    expect(model.compat?.supportsDeveloperRole).toBe(false);
  });

  it('disables developer role for openrouter with custom endpoint', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'anthropic/claude-sonnet-4-6',
        name: 'claude-sonnet-4-6',
        api: 'openai-completions',
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 8192,
      },
      {
        configProvider: 'openrouter',
        rawProvider: 'openrouter',
        customBaseUrl: 'https://openrouter.ai/api/v1',
      },
    );

    expect(model.compat?.supportsDeveloperRole).toBe(false);
  });

  it('disables supportsStore alongside developer role for non-standard endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'kimi-k2.5',
        name: 'kimi-k2.5',
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'openai',
        rawProvider: 'openai',
        customBaseUrl: 'https://api.moonshot.cn/v1',
      },
    );

    expect(model.compat?.supportsDeveloperRole).toBe(false);
    expect(model.compat?.supportsStore).toBe(false);
  });

  it('preserves existing compat fields when disabling developer role', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'custom-model',
        name: 'custom-model',
        api: 'openai-completions',
        provider: 'custom',
        baseUrl: '',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
        compat: { supportsStreaming: true } as any,
      } as any,
      {
        configProvider: 'custom',
        rawProvider: 'custom',
        customBaseUrl: 'https://my-relay.example.com/v1',
      },
    );

    expect(model.compat?.supportsDeveloperRole).toBe(false);
    expect(model.compat?.supportsStore).toBe(false);
    expect((model.compat as any)?.supportsStreaming).toBe(true);
  });
});
