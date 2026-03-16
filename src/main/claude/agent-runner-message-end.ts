import type { AssistantMessage, TextContent, ThinkingContent, ToolCall } from '@mariozechner/pi-ai';
import { splitThinkTagBlocks } from './think-tag-parser';

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

export function toUserFacingErrorText(errorText: string): string {
  const lower = errorText.toLowerCase();
  if (lower.includes('first_response_timeout')) {
    return '模型响应超时：长时间未收到上游返回，请稍后重试或检查当前模型/网关负载。';
  }
  if (lower.includes('empty_success_result')) {
    return '模型返回了一个空的成功结果，当前模型或网关兼容性可能有问题，请重试或切换协议后再试。';
  }
  if (/\b400\b/.test(errorText) || lower.includes('bad request') || lower.includes('invalid request')) {
    return `请求被上游拒绝（400），可能是模型/协议配置不兼容。请检查模型名称、协议设置和 API 端点。\n原始错误: ${errorText}`;
  }
  if (/\b(401|403)\b/.test(errorText) || lower.includes('unauthorized') || lower.includes('forbidden')) {
    return `认证失败，请检查 API Key 是否正确、是否已过期或无权访问当前模型。\n原始错误: ${errorText}`;
  }
  if (/\b429\b/.test(errorText) || lower.includes('rate limit')) {
    return `请求被限流（429），当前模型或 API 端点的调用频率已达上限，请稍后重试。\n原始错误: ${errorText}`;
  }
  return errorText;
}

export function resolveMessageEndPayload(
  options: ResolveMessageEndPayloadOptions,
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

  const rawContent = Array.isArray(message?.content) && message.content.length > 0
    ? message.content
    : (streamedText ? [{ type: 'text' as const, text: streamedText }] : []);

  // Post-process: split any <think>...</think> tags in text blocks into
  // separate thinking + text content blocks for proper UI rendering.
  const effectiveContent: MessageEndContentBlock[] = [];
  for (const block of rawContent) {
    if (block.type === 'text') {
      const splitBlocks = splitThinkTagBlocks(block.text);
      for (const splitBlock of splitBlocks) {
        if (splitBlock.type === 'thinking') {
          effectiveContent.push({ type: 'thinking', thinking: splitBlock.thinking } as ThinkingContent);
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
