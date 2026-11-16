import { describe, expect, it } from 'vitest';
import { convertMessages } from '@mariozechner/pi-ai/openai-completions';
import type { OpenAICompletionsCompat } from '@mariozechner/pi-ai';
import {
  buildSyntheticPiModel,
  resolvePiRegistryModel,
} from '../src/main/agent/pi-model-resolution';

const compat: Required<OpenAICompletionsCompat> = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  reasoningEffortMap: {},
  supportsUsageInStreaming: true,
  maxTokensField: 'max_tokens',
  requiresToolResultName: false,
  requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: false,
  thinkingFormat: 'openai',
  openRouterRouting: {},
  vercelGatewayRouting: {},
  supportsStrictMode: false,
};

describe('synthetic model modalities', () => {
  it('filters user and tool images through the actual SDK for unknown text models', () => {
    const resolved = buildSyntheticPiModel('deepseek-v4-pro', 'openai', 'openai');
    expect(resolved.input).toEqual(['text']);
    const converted = convertMessages(
      { ...resolved, api: 'openai-completions' },
      {
        messages: [
          {
            role: 'user',
            timestamp: 1,
            content: [
              { type: 'text', text: 'Read the output' },
              { type: 'image', data: 'cG5n', mimeType: 'image/png' },
            ],
          },
          {
            role: 'toolResult',
            timestamp: 2,
            toolCallId: 'read',
            toolName: 'read',
            isError: false,
            content: [
              { type: 'text', text: 'text output' },
              { type: 'image', data: 'cG5n', mimeType: 'image/png' },
            ],
          },
        ],
      },
      compat
    );
    expect(JSON.stringify(converted)).not.toContain('image_url');
    expect(JSON.stringify(converted)).toContain('Read the output');
    expect(JSON.stringify(converted)).toContain('text output');
  });

  it('preserves verified image capabilities for registered vision models', () => {
    expect(resolvePiRegistryModel('anthropic/claude-sonnet-4-6')?.input).toContain('image');
  });
});
