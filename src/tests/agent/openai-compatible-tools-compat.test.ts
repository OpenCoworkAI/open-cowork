import { describe, expect, it } from 'vitest';
import type { Context, Model } from '@mariozechner/pi-ai';
import { streamOpenAICompletions } from '@mariozechner/pi-ai/openai-completions';
import {
  applyPiModelRuntimeOverrides,
  buildSyntheticPiModel,
} from '../../main/agent/pi-model-resolution';

const readFileTool = {
  name: 'read_file',
  description: 'Read a file',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
    },
    required: ['path'],
  },
} as unknown as NonNullable<Context['tools']>[number];

async function captureChatCompletionTools(model: Model<'openai-completions'>) {
  let tools: unknown;
  const stream = streamOpenAICompletions(
    model,
    {
      messages: [{ role: 'user', content: 'Read the file', timestamp: 1 }],
      tools: [readFileTool],
    },
    {
      apiKey: 'test-key',
      onPayload: (payload) => {
        tools = (payload as { tools?: unknown }).tools;
        throw new Error('captured payload');
      },
    }
  );

  const message = await stream.result();
  expect(message.stopReason).toBe('error');
  expect(message.errorMessage).toContain('captured payload');
  return tools;
}

function functionTool(tools: unknown): Record<string, unknown> {
  expect(Array.isArray(tools)).toBe(true);
  const first = (tools as Array<{ type?: string; function?: Record<string, unknown> }>)[0];
  expect(first?.type).toBe('function');
  return first?.function ?? {};
}

describe('OpenAI-compatible tool request shaping', () => {
  it('omits function.strict for TokenMix custom OpenAI relays', async () => {
    const model = applyPiModelRuntimeOverrides(
      buildSyntheticPiModel('gemini-3.1-pro', 'openai', 'openai', 'https://api.tokenmix.ai/v1'),
      {
        configProvider: 'openai',
        rawProvider: 'custom',
        customProtocol: 'openai',
        customBaseUrl: 'https://api.tokenmix.ai/v1',
      }
    );
    expect(model.api).toBe('openai-completions');

    const fn = functionTool(await captureChatCompletionTools(model as Model<'openai-completions'>));

    expect(fn.name).toBe('read_file');
    expect(fn.strict).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(fn, 'strict')).toBe(false);
  });

  it('omits function.strict for OpenRouter, matching the non-strict default', async () => {
    const model = applyPiModelRuntimeOverrides(
      buildSyntheticPiModel(
        'anthropic/claude-sonnet-4-6',
        'openrouter',
        'openai',
        'https://openrouter.ai/api/v1'
      ),
      {
        configProvider: 'openrouter',
        rawProvider: 'openrouter',
        customBaseUrl: 'https://openrouter.ai/api/v1',
      }
    );
    expect(model.api).toBe('openai-completions');

    const fn = functionTool(await captureChatCompletionTools(model as Model<'openai-completions'>));

    expect(Object.prototype.hasOwnProperty.call(fn, 'strict')).toBe(false);
  });

  it('still emits strict: false for first-party OpenAI completions', async () => {
    const model = applyPiModelRuntimeOverrides(
      buildSyntheticPiModel('gpt-5.4', 'openai', 'openai', 'https://api.openai.com/v1'),
      {
        configProvider: 'openai',
        rawProvider: 'openai',
        customBaseUrl: 'https://api.openai.com/v1',
      }
    );
    expect(model.api).toBe('openai-completions');

    const fn = functionTool(await captureChatCompletionTools(model as Model<'openai-completions'>));

    expect(fn.strict).toBe(false);
  });
});
