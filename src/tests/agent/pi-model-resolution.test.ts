import { describe, expect, it } from 'vitest';
import type { Api, Model } from '@earendil-works/pi-ai';
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
    });
  });
});
