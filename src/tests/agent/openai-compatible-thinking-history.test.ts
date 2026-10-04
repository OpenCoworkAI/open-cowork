/**
 * OpenAI-compatible outbound history must drop Anthropic-style `thinking` blocks
 * (DeepSeek V4 on https://api.deepseek.com 400s with
 * `unknown variant 'thinking', expected 'text'`). Anthropic-compatible conversion
 * must still replay thinking blocks. See issue #231.
 */

import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  filterHistoryBlocksForChatProtocol,
  findOpenAICompatibleThinkingVariants,
  stripThinkingBlocksFromOpenAICompatibleMessages,
} from '../../main/agent/openai-compatible-history';
import { applyPiModelRuntimeOverrides } from '../../main/agent/pi-model-resolution';
import type { Api, Model } from '@mariozechner/pi-ai';

const completionsPath = path.resolve(
  'node_modules/@mariozechner/pi-ai/dist/providers/openai-completions.js'
);
const anthropicPath = path.resolve('node_modules/@mariozechner/pi-ai/dist/providers/anthropic.js');

if (!fs.existsSync(completionsPath) || !fs.existsSync(anthropicPath)) {
  throw new Error('Expected @mariozechner/pi-ai to be installed before running this suite');
}

const openaiMod = await import(pathToFileURL(completionsPath).href);
const anthropicMod = await import(pathToFileURL(anthropicPath).href);
const { convertMessages } = openaiMod;
const convertAnthropicMessages = anthropicMod.convertMessages as (
  messages: unknown[],
  model: unknown,
  isOAuthToken: boolean,
  cacheControl: unknown
) => Array<{ role: string; content?: unknown; tool_calls?: unknown }>;

type OpenAICompat = {
  supportsStore: boolean;
  supportsDeveloperRole: boolean;
  supportsReasoningEffort: boolean;
  reasoningEffortMap: Record<string, string>;
  supportsUsageInStreaming: boolean;
  maxTokensField: 'max_completion_tokens' | 'max_tokens';
  requiresToolResultName: boolean;
  requiresAssistantAfterToolResult: boolean;
  requiresThinkingAsText: boolean;
  thinkingFormat: 'openai' | 'zai';
  openRouterRouting: Record<string, unknown>;
  vercelGatewayRouting: Record<string, unknown>;
  supportsStrictMode: boolean;
  requiresThinkingInContent?: boolean;
};

const openaiCompat: OpenAICompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  reasoningEffortMap: {},
  supportsUsageInStreaming: true,
  maxTokensField: 'max_completion_tokens',
  requiresToolResultName: false,
  requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: false,
  thinkingFormat: 'openai',
  openRouterRouting: {},
  vercelGatewayRouting: {},
  supportsStrictMode: true,
};

const deepseekOpenAIModel = {
  id: 'deepseek-v4-flash',
  name: 'deepseek-v4-flash',
  api: 'openai-completions' as const,
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  reasoning: true,
  input: ['text' as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 16384,
};

const sameDeepseekMeta = {
  provider: 'deepseek',
  api: 'openai-completions',
  model: 'deepseek-v4-flash',
  timestamp: 1,
  stopReason: 'stop' as const,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};

const anthropicModel = {
  id: 'claude-sonnet-4-6',
  name: 'Claude Sonnet 4.6',
  api: 'anthropic-messages' as const,
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  reasoning: true,
  input: ['text' as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 16384,
};

const sameAnthropicMeta = {
  provider: 'anthropic',
  api: 'anthropic-messages',
  model: 'claude-sonnet-4-6',
  timestamp: 1,
  stopReason: 'stop' as const,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};

function contentPartTypes(messages: Array<{ content?: unknown }>): string[] {
  const types: string[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part && typeof part === 'object' && 'type' in part && typeof part.type === 'string') {
        types.push(part.type);
      }
    }
  }
  return types;
}

describe('filterHistoryBlocksForChatProtocol', () => {
  const storedTurn = [
    { type: 'thinking', thinking: 'plan the tool call' },
    { type: 'text', text: 'Let me list the directory.' },
    { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } },
    { type: 'tool_result', toolUseId: 'toolu_1', content: 'src\nREADME.md' },
  ];

  it('drops thinking blocks for OpenAI-compatible history and keeps text/tool blocks', () => {
    expect(filterHistoryBlocksForChatProtocol(storedTurn, 'openai-compatible')).toEqual([
      { type: 'text', text: 'Let me list the directory.' },
      { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', toolUseId: 'toolu_1', content: 'src\nREADME.md' },
    ]);
  });

  it('keeps thinking blocks for Anthropic-compatible history', () => {
    expect(filterHistoryBlocksForChatProtocol(storedTurn, 'anthropic-compatible')).toEqual(
      storedTurn
    );
  });
});

describe('stripThinkingBlocksFromOpenAICompatibleMessages', () => {
  it('removes thinking parts that would 400 on DeepSeek OpenAI-compatible JSON', () => {
    const outbound = [
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hidden chain of thought' },
          { type: 'text', text: 'Hi there!' },
        ],
      },
      { role: 'user', content: 'Follow up' },
    ];

    expect(findOpenAICompatibleThinkingVariants(outbound)).toEqual([
      { messageIndex: 1, partIndex: 0, role: 'assistant' },
    ]);

    const stripped = stripThinkingBlocksFromOpenAICompatibleMessages(outbound);
    expect(findOpenAICompatibleThinkingVariants(stripped)).toEqual([]);
    expect(stripped[1]?.content).toEqual([{ type: 'text', text: 'Hi there!' }]);
  });

  it('omits thinking-only assistant messages that would become content: []', () => {
    const stripped = stripThinkingBlocksFromOpenAICompatibleMessages([
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'only CoT, no visible text' }],
      },
      { role: 'user', content: 'Follow up' },
    ]);

    expect(stripped).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'user', content: 'Follow up' },
    ]);
    expect(
      stripped.some((message) => Array.isArray(message.content) && message.content.length === 0)
    ).toBe(false);
  });

  it('keeps tool_calls and uses empty-string content instead of []', () => {
    const stripped = stripThinkingBlocksFromOpenAICompatibleMessages([
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'call bash' }],
        tool_calls: [
          {
            id: 'call_ls',
            type: 'function',
            function: { name: 'Bash', arguments: '{"command":"ls"}' },
          },
        ],
      },
    ]);

    expect(stripped).toHaveLength(1);
    expect(stripped[0]?.content).toBe('');
    expect(stripped[0]?.tool_calls).toEqual([
      {
        id: 'call_ls',
        type: 'function',
        function: { name: 'Bash', arguments: '{"command":"ls"}' },
      },
    ]);
  });

  it('leaves top-level reasoning_content in place for DeepSeek V4 tool replay', () => {
    // Current V4 thinking-mode docs: when the request includes tools, omitting
    // reasoning_content 400s. Legacy deepseek-reasoner rejected it on input;
    // V4 ignores it when tools are absent. Open Cowork always sends tools.
    const stripped = stripThinkingBlocksFromOpenAICompatibleMessages([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'cot' },
          { type: 'text', text: 'answer' },
        ],
        reasoning_content: 'cot',
      },
    ]);
    expect(stripped[0]?.content).toEqual([{ type: 'text', text: 'answer' }]);
    expect(stripped[0]?.reasoning_content).toBe('cot');
  });
});

describe('OpenAI-compatible convertMessages (pi-ai openai-completions)', () => {
  it('drops thinking content blocks and keeps text plus tool calls/results', () => {
    const result = convertMessages(
      deepseekOpenAIModel,
      {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'List files' }], timestamp: 1 },
          {
            role: 'assistant',
            ...sameDeepseekMeta,
            content: [
              {
                type: 'thinking',
                thinking: 'I should call Bash',
                thinkingSignature: 'reasoning_content',
              },
              { type: 'text', text: 'Checking the directory.' },
              { type: 'toolCall', id: 'call_ls', name: 'Bash', arguments: { command: 'ls' } },
            ],
          },
          {
            role: 'toolResult',
            toolCallId: 'call_ls',
            toolName: 'Bash',
            content: [{ type: 'text', text: 'src\nREADME.md' }],
            isError: false,
            timestamp: 2,
          },
          { role: 'user', content: [{ type: 'text', text: 'Thanks, summarize' }], timestamp: 3 },
        ],
      },
      openaiCompat
    );

    expect(findOpenAICompatibleThinkingVariants(result)).toEqual([]);
    expect(contentPartTypes(result)).not.toContain('thinking');

    const assistant = result.find(
      (message: { role: string; tool_calls?: unknown }) =>
        message.role === 'assistant' && Array.isArray(message.tool_calls)
    ) as {
      content?: unknown;
      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
    };
    expect(assistant?.content).toBe('Checking the directory.');
    expect(assistant?.tool_calls?.[0]?.function?.name).toBe('Bash');
    expect(assistant?.tool_calls?.[0]?.function?.arguments).toContain('ls');

    const tool = result.find((message: { role: string }) => message.role === 'tool') as {
      content?: unknown;
      tool_call_id?: string;
    };
    expect(tool?.content).toBe('src\nREADME.md');
    expect(tool?.tool_call_id).toBe('call_ls');
  });

  it('does not emit thinking variants even when leftover requiresThinkingInContent is set', () => {
    const result = convertMessages(
      deepseekOpenAIModel,
      {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }], timestamp: 1 },
          {
            role: 'assistant',
            ...sameDeepseekMeta,
            content: [
              {
                type: 'thinking',
                thinking: 'Let me think about this...',
                thinkingSignature: 'reasoning_content',
              },
              { type: 'text', text: 'Hi there!' },
            ],
          },
          { role: 'user', content: [{ type: 'text', text: 'Follow up' }], timestamp: 2 },
        ],
      },
      { ...openaiCompat, requiresThinkingInContent: true }
    );

    expect(findOpenAICompatibleThinkingVariants(result)).toEqual([]);
    const assistant = result.find((message: { role: string }) => message.role === 'assistant') as {
      content?: unknown;
    };
    expect(assistant?.content).toBe('Hi there!');
    expect(JSON.stringify(result)).not.toMatch(/"type":"thinking"/);
  });

  it('drops type:thinking on a DeepSeek-like multi-turn fixture (the previous 400)', () => {
    // First turn works; the second request used to 400 because history included
    // `{ type: "thinking" }` in messages[2].content.
    const result = convertMessages(
      { ...deepseekOpenAIModel, id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' },
      {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }], timestamp: 1 },
          {
            role: 'assistant',
            ...sameDeepseekMeta,
            model: 'deepseek-v4-pro',
            content: [
              {
                type: 'thinking',
                thinking: 'hidden CoT from turn 1',
                thinkingSignature: 'reasoning_content',
              },
              { type: 'text', text: 'Hello! How can I help?' },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'text', text: 'What did you just think?' }],
            timestamp: 2,
          },
        ],
      },
      openaiCompat
    );

    expect(result).toHaveLength(3);
    expect(result[1]).toMatchObject({
      role: 'assistant',
      content: 'Hello! How can I help?',
    });
    expect(JSON.stringify(result)).not.toMatch(/"type":"thinking"/);
    expect(findOpenAICompatibleThinkingVariants(result)).toEqual([]);
  });

  it('omits thinking-only assistant turns with no tool calls', () => {
    const result = convertMessages(
      deepseekOpenAIModel,
      {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }], timestamp: 1 },
          {
            role: 'assistant',
            ...sameDeepseekMeta,
            content: [
              {
                type: 'thinking',
                thinking: 'still thinking, no answer yet',
                thinkingSignature: 'reasoning_content',
              },
            ],
          },
          { role: 'user', content: [{ type: 'text', text: 'Follow up' }], timestamp: 2 },
        ],
      },
      openaiCompat
    );

    expect(result.map((message: { role: string }) => message.role)).toEqual(['user', 'user']);
    expect(
      result.some(
        (message: { content?: unknown }) =>
          Array.isArray(message.content) && message.content.length === 0
      )
    ).toBe(false);
  });

  it('keeps requiresThinkingAsText as type:text parts, never type:thinking', () => {
    const result = convertMessages(
      deepseekOpenAIModel,
      {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }], timestamp: 1 },
          {
            role: 'assistant',
            ...sameDeepseekMeta,
            content: [
              {
                type: 'thinking',
                thinking: 'Zai style reasoning',
                thinkingSignature: 'reasoning_content',
              },
              { type: 'text', text: 'Visible answer' },
            ],
          },
        ],
      },
      { ...openaiCompat, requiresThinkingAsText: true }
    );

    const assistant = result.find((message: { role: string }) => message.role === 'assistant');
    expect(assistant?.content).toEqual([
      { type: 'text', text: 'Zai style reasoning' },
      { type: 'text', text: 'Visible answer' },
    ]);
    expect(findOpenAICompatibleThinkingVariants(result)).toEqual([]);
  });
});

describe('Anthropic-compatible convertMessages regression', () => {
  it('still forwards thinking blocks (with signature) on the Anthropic path', () => {
    const result = convertAnthropicMessages(
      [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }], timestamp: 1 },
        {
          role: 'assistant',
          ...sameAnthropicMeta,
          content: [
            {
              type: 'thinking',
              thinking: 'Anthropic replay must keep this',
              thinkingSignature: 'thinking-sig-1',
            },
            { type: 'text', text: 'Hi from Claude-compatible protocol' },
            { type: 'toolCall', id: 'toolu_99', name: 'Bash', arguments: { command: 'pwd' } },
          ],
        },
        {
          role: 'toolResult',
          toolCallId: 'toolu_99',
          toolName: 'Bash',
          content: [{ type: 'text', text: '/workspace' }],
          isError: false,
          timestamp: 2,
        },
      ],
      anthropicModel,
      false,
      undefined
    );

    const assistant = result.find((message) => message.role === 'assistant') as {
      content?: Array<{ type: string; thinking?: string; text?: string; name?: string }>;
    };
    expect(Array.isArray(assistant?.content)).toBe(true);
    expect(assistant?.content?.map((part) => part.type)).toEqual(['thinking', 'text', 'tool_use']);
    expect(assistant?.content?.[0]).toMatchObject({
      type: 'thinking',
      thinking: 'Anthropic replay must keep this',
      signature: 'thinking-sig-1',
    });
    expect(assistant?.content?.[1]).toEqual({
      type: 'text',
      text: 'Hi from Claude-compatible protocol',
    });
    expect(assistant?.content?.[2]).toMatchObject({
      type: 'tool_use',
      id: 'toolu_99',
      name: 'Bash',
    });

    const userWithToolResult = result.find((message) => {
      if (message.role !== 'user' || !Array.isArray(message.content)) {
        return false;
      }
      return message.content.some((part: { type?: string }) => part?.type === 'tool_result');
    }) as { content?: Array<{ type: string; tool_use_id?: string; content?: unknown }> };
    const toolResult = userWithToolResult?.content?.find((part) => part.type === 'tool_result');
    expect(toolResult).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'toolu_99',
    });
  });
});

describe('DeepSeek V4 model resolution does not re-inject thinking-in-content', () => {
  it('does not set requiresThinkingInContent for DeepSeek V4 on OpenAI-compatible endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'deepseek-v4-pro',
        name: 'deepseek-v4-pro',
        api: 'openai-completions',
        provider: 'custom',
        baseUrl: 'https://api.deepseek.com',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      } as Model<Api>,
      {
        configProvider: 'custom',
        rawProvider: 'custom',
        customBaseUrl: 'https://api.deepseek.com',
        customProtocol: 'openai',
      }
    );

    expect(
      (model.compat as { requiresThinkingInContent?: boolean } | undefined)
        ?.requiresThinkingInContent
    ).toBeUndefined();
  });
});
