import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const openaiModelsList = vi.fn();
  const openaiResponsesCreate = vi.fn();
  const openaiChatCompletionsCreate = vi.fn();
  const openaiCtor = vi.fn().mockImplementation(function (this: any) {
    this.models = { list: openaiModelsList };
    this.responses = { create: openaiResponsesCreate };
    this.chat = { completions: { create: openaiChatCompletionsCreate } };
  });

  const anthropicModelsList = vi.fn();
  const anthropicMessagesCreate = vi.fn();
  const anthropicCtor = vi.fn().mockImplementation(function (this: any) {
    this.models = { list: anthropicModelsList };
    this.messages = { create: anthropicMessagesCreate };
  });

  return {
    openaiCtor,
    openaiModelsList,
    openaiResponsesCreate,
    openaiChatCompletionsCreate,
    anthropicCtor,
    anthropicModelsList,
    anthropicMessagesCreate,
  };
});

vi.mock('openai', () => ({
  default: mocks.openaiCtor,
}));

vi.mock('@anthropic-ai/sdk', () => ({
  Anthropic: mocks.anthropicCtor,
}));

vi.mock('../src/main/config/config-store', () => ({
  PROVIDER_PRESETS: {
    openai: { baseUrl: 'https://api.openai.com/v1' },
    openrouter: { baseUrl: 'https://openrouter.ai/api' },
    anthropic: { baseUrl: 'https://api.anthropic.com' },
    custom: { baseUrl: 'https://example.com' },
  },
}));

import { testApiConnection } from '../src/main/config/api-tester';

describe('testApiConnection', () => {
  beforeEach(() => {
    mocks.openaiCtor.mockImplementation(function (this: any) {
      this.models = { list: mocks.openaiModelsList };
      this.responses = { create: mocks.openaiResponsesCreate };
      this.chat = { completions: { create: mocks.openaiChatCompletionsCreate } };
    });
    mocks.anthropicCtor.mockImplementation(function (this: any) {
      this.models = { list: mocks.anthropicModelsList };
      this.messages = { create: mocks.anthropicMessagesCreate };
    });

    mocks.openaiModelsList.mockReset();
    mocks.openaiResponsesCreate.mockReset();
    mocks.openaiChatCompletionsCreate.mockReset();
    mocks.anthropicModelsList.mockReset();
    mocks.anthropicMessagesCreate.mockReset();

    mocks.openaiModelsList.mockResolvedValue({});
    mocks.openaiResponsesCreate.mockResolvedValue({});
    mocks.openaiChatCompletionsCreate.mockResolvedValue({});
    mocks.anthropicModelsList.mockResolvedValue({});
    mocks.anthropicMessagesCreate.mockResolvedValue({});
  });

  it('uses messages.create for custom anthropic-compatible provider', async () => {
    const result = await testApiConnection({
      provider: 'custom',
      customProtocol: 'anthropic',
      apiKey: 'sk-test',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      model: 'glm-4.7',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(true);
    expect(mocks.anthropicCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-test',
        baseURL: 'https://open.bigmodel.cn/api/anthropic',
        timeout: 30000,
      }),
    );
    expect(mocks.anthropicMessagesCreate).toHaveBeenCalledTimes(1);
    expect(mocks.anthropicModelsList).not.toHaveBeenCalled();
  });

  it('keeps models.list check for direct anthropic when not live request', async () => {
    const result = await testApiConnection({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-5',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(true);
    expect(mocks.anthropicCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-ant-test',
        timeout: 30000,
      }),
    );
    expect(mocks.anthropicModelsList).toHaveBeenCalledTimes(1);
    expect(mocks.anthropicMessagesCreate).not.toHaveBeenCalled();
  });

  it('maps timeout message to network_error', async () => {
    mocks.anthropicMessagesCreate.mockRejectedValueOnce(new Error('Request timed out'));

    const result = await testApiConnection({
      provider: 'custom',
      customProtocol: 'anthropic',
      apiKey: 'sk-test',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      model: 'glm-4.7',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('network_error');
    expect(result.details).toMatch(/timed out/i);
  });
});
