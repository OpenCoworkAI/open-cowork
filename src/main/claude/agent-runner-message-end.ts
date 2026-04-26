import type { AssistantMessage, TextContent, ThinkingContent, ToolCall } from '@mariozechner/pi-ai';
import { splitThinkTagBlocks } from './think-tag-parser';
import { getLocalizedErrorMessage } from '../../shared/error-messages';

type MessageEndContentBlock = TextContent | ThinkingContent | ToolCall;

type MessageEndMessage = Pick<AssistantMessage, 'role' | 'content' | 'stopReason' | 'errorMessage'>;

interface ResolveMessageEndPayloadOptions {
  message?: MessageEndMessage;
  streamedText: string;
}

interface ResolvedMessageEndPayload {
  effectiveContent: MessageEndContentBlock[];
  errorText?: string;
  nextStreamedText: string;
  shouldEmitMessage: boolean;
}

const errorKeys: Record<string, string> = {
  TOOL_FIRST_RESPONSE_TIMEOUT: 'TOOL_FIRST_RESPONSE_TIMEOUT',
  TOOL_TRY_AGAIN_OR_CHECK: 'TOOL_TRY_AGAIN_OR_CHECK',
  TOOL_EMPTY_RESULT: 'TOOL_EMPTY_RESULT',
  TOOL_BAD_REQUEST_400: 'TOOL_BAD_REQUEST_400',
  TOOL_AUTH_FAILED: 'TOOL_AUTH_FAILED',
  TOOL_RATE_LIMITED_429: 'TOOL_RATE_LIMITED_429',
  TOOL_UPSTREAM_ERROR: 'TOOL_UPSTREAM_ERROR',
  TOOL_CONNECTION_INTERRUPTED: 'TOOL_CONNECTION_INTERRUPTED',
};

function getErrorText(key: string): string {
  return getLocalizedErrorMessage(key as 'TOOL_FIRST_RESPONSE_TIMEOUT');
}

export function toUserFacingErrorText(errorText: string): string {
  const lower = errorText.toLowerCase();
  if (lower.includes('first_response_timeout')) {
    return `${getErrorText(errorKeys.TOOL_FIRST_RESPONSE_TIMEOUT)}\n${getErrorText(errorKeys.TOOL_TRY_AGAIN_OR_CHECK)}`;
  }
  if (lower.includes('empty_success_result')) {
    return getErrorText(errorKeys.TOOL_EMPTY_RESULT);
  }
  if (
    /\b400\b/.test(errorText) ||
    lower.includes('bad request') ||
    lower.includes('invalid request')
  ) {
    return `${getErrorText(errorKeys.TOOL_BAD_REQUEST_400)}\nOriginal error: ${errorText}`;
  }
  if (
    /\b(401|403)\b/.test(errorText) ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden')
  ) {
    return `${getErrorText(errorKeys.TOOL_AUTH_FAILED)}\nOriginal error: ${errorText}`;
  }
  if (
    /\b429\b/.test(errorText) ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return `${getErrorText(errorKeys.TOOL_RATE_LIMITED_429)}\nOriginal error: ${errorText}`;
  }
  if (
    /\b(5\d{2})\b/.test(errorText) ||
    lower.includes('server error') ||
    lower.includes('internal error') ||
    lower.includes('service unavailable') ||
    lower.includes('overloaded')
  ) {
    return `${getErrorText(errorKeys.TOOL_UPSTREAM_ERROR)}\nOriginal error: ${errorText}`;
  }
  if (
    lower.includes('terminated') ||
    lower.includes('connection reset') ||
    lower.includes('connection closed') ||
    lower.includes('connection refused') ||
    lower.includes('connection error') ||
    lower.includes('fetch failed') ||
    lower.includes('other side closed') ||
    lower.includes('reset before headers') ||
    lower.includes('upstream connect') ||
    lower.includes('retry delay')
  ) {
    return getErrorText(errorKeys.TOOL_CONNECTION_INTERRUPTED);
  }
  return errorText;
}

export function resolveMessageEndPayload(
  options: ResolveMessageEndPayloadOptions
): ResolvedMessageEndPayload {
  const { message, streamedText } = options;
  const nextStreamedText = '';

  if (message?.stopReason === 'error' && message.errorMessage) {
    return {
      effectiveContent: [],
      errorText: toUserFacingErrorText(message.errorMessage),
      nextStreamedText,
      shouldEmitMessage: false,
    };
  }

  const rawContent =
    Array.isArray(message?.content) && message.content.length > 0
      ? message.content
      : streamedText
        ? [{ type: 'text' as const, text: streamedText }]
        : [];

  if (rawContent.length === 0) {
    return {
      effectiveContent: [],
      errorText: toUserFacingErrorText('empty_success_result'),
      nextStreamedText,
      shouldEmitMessage: false,
    };
  }

  // Post-process: split any <think>...</think> tags in text blocks into
  // separate thinking + text content blocks for proper UI rendering.
  const effectiveContent: MessageEndContentBlock[] = [];
  for (const block of rawContent) {
    if (block.type === 'text') {
      const splitBlocks = splitThinkTagBlocks(block.text);
      for (const splitBlock of splitBlocks) {
        if (splitBlock.type === 'thinking') {
          effectiveContent.push({
            type: 'thinking',
            thinking: splitBlock.thinking,
          } as ThinkingContent);
        } else {
          effectiveContent.push({ type: 'text', text: splitBlock.text } as TextContent);
        }
      }
    } else {
      effectiveContent.push(block);
    }
  }

  return {
    effectiveContent,
    nextStreamedText,
    shouldEmitMessage: effectiveContent.length > 0 && (message?.role === 'assistant' || !message),
  };
}
