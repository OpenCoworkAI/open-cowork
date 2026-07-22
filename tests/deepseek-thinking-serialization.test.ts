import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const completionsPath = path.resolve(
  'node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js'
);
const completionsSource = fs.readFileSync(completionsPath, 'utf8');
const isPatched = completionsSource.includes('requiresThinkingInContent');

if (!isPatched) {
  throw new Error('Expected @earendil-works/pi-ai patch to be applied before running this suite');
}

const mod = await import(pathToFileURL(completionsPath).href);
const { convertMessages } = mod;

describe('DeepSeek thinking block serialization', () => {
  const baseModel = {
    id: 'deepseek-v4-pro',
    name: 'deepseek-v4-pro',
    api: 'openai-completions' as const,
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    reasoning: true,
    input: ['text' as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  };

  const baseCompat = {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    reasoningEffortMap: {},
    supportsUsageInStreaming: true,
    maxTokensField: 'max_completion_tokens' as const,
    requiresToolResultName: false,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: false,
    requiresThinkingInContent: true,
    thinkingFormat: 'openai' as const,
    openRouterRouting: {},
    vercelGatewayRouting: {},
    supportsStrictMode: true,
  };

  const nonDeepSeekCompat = {
    ...baseCompat,
    requiresThinkingInContent: false,
  };

  // Same-model assistant message metadata so transformMessages preserves thinking blocks
  const sameModelMeta = {
    provider: 'deepseek',
    api: 'openai-completions',
    model: 'deepseek-v4-pro',
  };

  it('puts thinking blocks in content[] when requiresThinkingInContent is true', () => {
    const context = {
      systemPrompt: undefined,
      messages: [
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
        {
          role: 'assistant' as const,
          ...sameModelMeta,
          content: [
            {
              type: 'thinking' as const,
              thinking: 'Let me think about this...',
              thinkingSignature: 'reasoning_content',
            },
            { type: 'text' as const, text: 'Hi there!' },
          ],
        },
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Follow up' }] },
      ],
    };

    const result = convertMessages(baseModel, context, baseCompat);

    const assistantMsg = result.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();

    // Content should be an array with thinking block first, then text
    expect(Array.isArray(assistantMsg!.content)).toBe(true);
    const content = assistantMsg!.content as Array<{
      type: string;
      thinking?: string;
      text?: string;
    }>;
    expect(content[0].type).toBe('thinking');
    expect(content[0].thinking).toBe('Let me think about this...');
    expect(content[1].type).toBe('text');
    expect(content[1].text).toBe('Hi there!');

    // Should NOT have top-level reasoning_content
    expect((assistantMsg as Record<string, unknown>).reasoning_content).toBeUndefined();
  });

  it('prefers content[] thinking blocks when text fallback compat is also enabled', () => {
    const context = {
      systemPrompt: undefined,
      messages: [
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
        {
          role: 'assistant' as const,
          ...sameModelMeta,
          content: [
            {
              type: 'thinking' as const,
              thinking: 'Preserve this exact thinking block',
              thinkingSignature: 'reasoning_content',
            },
            { type: 'text' as const, text: 'Final answer' },
          ],
        },
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Follow up' }] },
      ],
    };

    const result = convertMessages(baseModel, context, {
      ...baseCompat,
      requiresThinkingAsText: true,
    });

    const assistantMsg = result.find((m: { role: string }) => m.role === 'assistant');
    const content = assistantMsg!.content as Array<{
      type: string;
      thinking?: string;
      text?: string;
    }>;

    expect(Array.isArray(assistantMsg!.content)).toBe(true);
    expect(content[0]).toEqual({
      type: 'thinking',
      thinking: 'Preserve this exact thinking block',
    });
    expect(content[1]).toEqual({ type: 'text', text: 'Final answer' });
  });

  it('puts thinking as top-level field when requiresThinkingInContent is false', () => {
    const context = {
      systemPrompt: undefined,
      messages: [
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
        {
          role: 'assistant' as const,
          ...sameModelMeta,
          content: [
            {
              type: 'thinking' as const,
              thinking: 'Let me think about this...',
              thinkingSignature: 'reasoning_content',
            },
            { type: 'text' as const, text: 'Hi there!' },
          ],
        },
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Follow up' }] },
      ],
    };

    const result = convertMessages(baseModel, context, nonDeepSeekCompat);

    const assistantMsg = result.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();

    // Content should be a plain string
    expect(typeof assistantMsg!.content).toBe('string');
    expect(assistantMsg!.content).toBe('Hi there!');

    // Should have top-level reasoning_content
    expect((assistantMsg as Record<string, unknown>).reasoning_content).toBe(
      'Let me think about this...'
    );
  });

  it('preserves array content shape for requiresThinkingAsText compatibility', () => {
    const context = {
      systemPrompt: undefined,
      messages: [
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
        {
          role: 'assistant' as const,
          ...sameModelMeta,
          content: [
            {
              type: 'thinking' as const,
              thinking: 'Zai style reasoning',
              thinkingSignature: 'reasoning_content',
            },
            { type: 'text' as const, text: 'Visible answer' },
          ],
        },
      ],
    };

    const result = convertMessages(baseModel, context, {
      ...baseCompat,
      requiresThinkingAsText: true,
      requiresThinkingInContent: false,
    });

    const assistantMsg = result.find((m: { role: string }) => m.role === 'assistant');
    expect(Array.isArray(assistantMsg!.content)).toBe(true);
    expect(assistantMsg!.content).toEqual([
      { type: 'text', text: 'Zai style reasoning' },
      { type: 'text', text: 'Visible answer' },
    ]);
  });

  it('handles assistant message with only thinking blocks (no text)', () => {
    const context = {
      systemPrompt: undefined,
      messages: [
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
        {
          role: 'assistant' as const,
          ...sameModelMeta,
          content: [
            {
              type: 'thinking' as const,
              thinking: 'Deep reasoning here...',
              thinkingSignature: 'reasoning_content',
            },
          ],
        },
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Follow up' }] },
      ],
    };

    const result = convertMessages(baseModel, context, baseCompat);

    const assistantMsg = result.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();

    // Content should be an array with only the thinking block
    expect(Array.isArray(assistantMsg!.content)).toBe(true);
    const content = assistantMsg!.content as Array<{ type: string; thinking?: string }>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('thinking');
    expect(content[0].thinking).toBe('Deep reasoning here...');
  });

  it('handles multiple thinking blocks in content[]', () => {
    const context = {
      systemPrompt: undefined,
      messages: [
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
        {
          role: 'assistant' as const,
          ...sameModelMeta,
          content: [
            {
              type: 'thinking' as const,
              thinking: 'First thought',
              thinkingSignature: 'reasoning_content',
            },
            {
              type: 'thinking' as const,
              thinking: 'Second thought',
              thinkingSignature: 'reasoning_content',
            },
            { type: 'text' as const, text: 'Response' },
          ],
        },
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Follow up' }] },
      ],
    };

    const result = convertMessages(baseModel, context, baseCompat);

    const assistantMsg = result.find((m: { role: string }) => m.role === 'assistant');
    const content = assistantMsg!.content as Array<{
      type: string;
      thinking?: string;
      text?: string;
    }>;

    // Should have 2 thinking blocks + 1 text block
    expect(content).toHaveLength(3);
    expect(content[0].type).toBe('thinking');
    expect(content[0].thinking).toBe('First thought');
    expect(content[1].type).toBe('thinking');
    expect(content[1].thinking).toBe('Second thought');
    expect(content[2].type).toBe('text');
    expect(content[2].text).toBe('Response');
  });
});
