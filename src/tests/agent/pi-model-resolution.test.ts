import { describe, expect, it } from 'vitest';
import type { Api, Model } from '@mariozechner/pi-ai';
import {
  applyPiModelRuntimeOverrides,
  resolvePiRegistryModel,
} from '../../main/agent/pi-model-resolution';

const openAIResponsesModel = {
  id: 'gpt-5.4',
  name: 'GPT-5.4',
  api: 'openai-responses',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  reasoning: true,
  input: ['text', 'image'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 16384,
} as Model<Api>;

describe('pi model runtime overrides', () => {
  it('keeps OpenAI Responses for custom OpenAI configs that target official OpenAI', () => {
    const model = resolvePiRegistryModel('openai/gpt-5.4', {
      configProvider: 'openai',
      rawProvider: 'custom',
      customProtocol: 'openai',
      customBaseUrl: 'https://api.openai.com/v1',
    });

    expect(model?.api).toBe('openai-responses');
    expect(model?.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('still downgrades Responses models for generic custom OpenAI-compatible relays', () => {
    const model = applyPiModelRuntimeOverrides(openAIResponsesModel, {
      configProvider: 'openai',
      rawProvider: 'custom',
      customProtocol: 'openai',
      customBaseUrl: 'https://relay.example.test/v1',
    });

    expect(model.api).toBe('openai-completions');
    expect(model.baseUrl).toBe('https://relay.example.test/v1');
    expect(model.compat).toMatchObject({
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsStrictMode: false,
    });
  });

  it('does not set requiresThinkingInContent for DeepSeek V4 models on custom endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'deepseek-v4-pro',
        name: 'deepseek-v4-pro',
        api: 'openai-completions',
        provider: 'custom',
        baseUrl: 'https://my-relay.example.com/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      } as Model<Api>,
      {
        configProvider: 'custom',
        rawProvider: 'custom',
        customBaseUrl: 'https://my-relay.example.com/v1',
      }
    );

    expect(
      (model.compat as { requiresThinkingInContent?: boolean } | undefined)
        ?.requiresThinkingInContent
    ).toBeUndefined();
  });

  it('does not set requiresThinkingInContent for provider-prefixed DeepSeek V4 model ids', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'deepseek/deepseek-v4-flash',
        name: 'deepseek/deepseek-v4-flash',
        api: 'openai-completions',
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      } as Model<Api>,
      {
        configProvider: 'openrouter',
        rawProvider: 'openrouter',
        customBaseUrl: 'https://openrouter.ai/api/v1',
      }
    );

    expect(
      (model.compat as { requiresThinkingInContent?: boolean } | undefined)
        ?.requiresThinkingInContent
    ).toBeUndefined();
  });

  it('does not set requiresThinkingInContent for non-V4 DeepSeek models on custom endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'deepseek-reasoner',
        name: 'deepseek-reasoner',
        api: 'openai-completions',
        provider: 'custom',
        baseUrl: 'https://my-relay.example.com/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      } as Model<Api>,
      {
        configProvider: 'custom',
        rawProvider: 'custom',
        customBaseUrl: 'https://my-relay.example.com/v1',
      }
    );

    expect(
      (model.compat as { requiresThinkingInContent?: boolean } | undefined)
        ?.requiresThinkingInContent
    ).toBeUndefined();
  });
});
