import type {
  AssistantMessage,
  AssistantMessageEvent,
  TextContent,
  ThinkingContent,
  ToolCall,
} from '@mariozechner/pi-ai';

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

const FOUR_XX_ERROR_RE = /\b4\d{2}\b/;

export interface TerminalErrorEmissionDetails {
  partialText: string;
  messageText: string;
}

export interface AbortDispositionFlags {
  abortedByTimeout: boolean;
  abortedByLoopGuard: boolean;
  abortedByStreamError: boolean;
}

export type AbortDisposition = 'timeout' | 'loop_guard' | 'stream_error' | 'user';

export function toUserFacingErrorText(errorText: string): string {
  const lower = errorText.toLowerCase();
  if (lower.includes('first_response_timeout')) {
    return 'Model response timed out: no response from upstream for a while. Please retry later or check the current model/gateway load.';
  }
  if (lower.includes('empty_success_result')) {
    return 'The model returned an empty success result. There may be a compatibility issue with the current model or gateway. Please retry or switch protocol.';
  }
  if (
    /\b400\b/.test(errorText) ||
    lower.includes('bad request') ||
    lower.includes('invalid request')
  ) {
    return `Request rejected by upstream (400). This may be due to an incompatible model/protocol configuration. Please check the model name, protocol settings, and API endpoint.\nOriginal error: ${errorText}`;
  }
  if (
    /\b(401|403)\b/.test(errorText) ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden')
  ) {
    return `Authentication failed. Please check whether the API Key is correct, expired, or lacks access to the current model.\nOriginal error: ${errorText}`;
  }
  if (
    /\b429\b/.test(errorText) ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return `Request rate-limited (429). The current model or API endpoint has reached its call frequency limit. Please retry later.\nOriginal error: ${errorText}`;
  }
  if (
    /\b(5\d{2})\b/.test(errorText) ||
    lower.includes('server error') ||
    lower.includes('internal error') ||
    lower.includes('service unavailable') ||
    lower.includes('overloaded')
  ) {
    return `Upstream service error, possibly due to model overload or a temporary fault. The SDK will retry automatically.\nOriginal error: ${errorText}`;
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
    return `Network connection interrupted (${errorText}), possibly due to an unstable proxy/gateway. The SDK will retry automatically.`;
  }
  return errorText;
}

export function resolveAssistantStreamErrorText(
  event: Extract<AssistantMessageEvent, { type: 'error' }>
): string {
  const rawError = event.error?.errorMessage?.trim() || event.reason || 'stream_error';
  return toUserFacingErrorText(rawError);
}

export function buildTerminalErrorMessage(errorText: string, partialText = ''): string {
  const normalizedPartial = partialText.trimEnd();
  const hint = FOUR_XX_ERROR_RE.test(errorText)
    ? '_Please check your configuration and retry._'
    : '_Agent is retrying automatically, please wait..._';
  const errorBlock = `**Error**: ${errorText}\n\n${hint}`;
  return normalizedPartial ? `${normalizedPartial}\n\n${errorBlock}` : errorBlock;
}

export function buildTerminalErrorEmissionDetails(options: {
  errorText: string;
  streamedText: string;
}): TerminalErrorEmissionDetails {
  const partialText = options.streamedText;

  return {
    partialText,
    messageText: buildTerminalErrorMessage(options.errorText, partialText),
  };
}

export function resolveAbortDisposition(flags: AbortDispositionFlags): AbortDisposition {
  if (flags.abortedByTimeout) {
    return 'timeout';
  }
  if (flags.abortedByLoopGuard) {
    return 'loop_guard';
  }
  if (flags.abortedByStreamError) {
    return 'stream_error';
  }
  return 'user';
}

export function shouldPreserveExistingTrace(disposition: AbortDisposition): boolean {
  return disposition === 'loop_guard' || disposition === 'stream_error';
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

  return {
    effectiveContent: rawContent,
    nextStreamedText,
    shouldEmitMessage: rawContent.length > 0 && (message?.role === 'assistant' || !message),
  };
}
