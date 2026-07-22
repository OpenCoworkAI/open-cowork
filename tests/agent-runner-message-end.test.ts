import { describe, expect, it } from 'vitest';

import {
  buildTerminalErrorEmissionDetails,
  buildTerminalErrorMessage,
  resolveAbortDisposition,
  resolveAssistantStreamErrorText,
  resolveMessageEndPayload,
  shouldPreserveExistingTrace,
  toUserFacingErrorText,
} from '../src/main/agent/agent-runner-message-end';

describe('resolveMessageEndPayload', () => {
  it('falls back to accumulated streamed text when message_end content is empty', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'stop',
      },
      streamedText: 'streamed fallback',
    });

    expect(result.nextStreamedText).toBe('');
    expect(result.errorText).toBeUndefined();
    expect(result.shouldEmitMessage).toBe(true);
    expect(result.effectiveContent).toEqual([{ type: 'text', text: 'streamed fallback' }]);
  });

  it('surfaces user-facing error text when message_end stops with error', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'first_response_timeout',
      },
      streamedText: 'partial text',
    });

    expect(result.nextStreamedText).toBe('');
    expect(result.shouldEmitMessage).toBe(false);
    expect(result.effectiveContent).toEqual([]);
    expect(result.errorText).toBe(
      '⟦i18n:chatError.timeout⟧'
    );
  });

  it('surfaces empty_success_result when message_end has no content and no streamed fallback', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'stop',
      },
      streamedText: '',
    });

    expect(result.nextStreamedText).toBe('');
    expect(result.shouldEmitMessage).toBe(false);
    expect(result.effectiveContent).toEqual([]);
    expect(result.errorText).toBe(
      '⟦i18n:chatError.emptyResult⟧'
    );
  });

  it('preserves literal <think> in text as-is (never parsed)', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Use <think>reasoning</think> to think' }],
        stopReason: 'stop',
      },
      streamedText: '',
    });

    expect(result.effectiveContent).toEqual([
      { type: 'text', text: 'Use <think>reasoning</think> to think' },
    ]);
  });

  it('preserves literal <think> in thinking block content (reasoning field mentions <think>)', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'The user asks about <think> and </think> tags and what they mean.',
          },
          { type: 'text', text: 'The <think> tag wraps reasoning.' },
        ],
        stopReason: 'stop',
      },
      streamedText: '',
    });

    expect(result.effectiveContent).toEqual([
      {
        type: 'thinking',
        thinking: 'The user asks about <think> and </think> tags and what they mean.',
      },
      { type: 'text', text: 'The <think> tag wraps reasoning.' },
    ]);
  });

  it('preserves literal <think> in streamedText when message content is empty (Ollama streaming fallback)', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'stop',
      },
      streamedText: 'The <think> tag is used for reasoning, not <think>actual reasoning</think>.',
    });

    expect(result.effectiveContent).toEqual([
      {
        type: 'text',
        text: 'The <think> tag is used for reasoning, not <think>actual reasoning</think>.',
      },
    ]);
  });
});

describe('toUserFacingErrorText', () => {
  it('maps 400 / bad request to configuration hint', () => {
    const result = toUserFacingErrorText('HTTP 400: bad request - ROLE_UNSPECIFIED');
    expect(result).toContain('⟦i18n:chatError.badRequest⟧');
    expect(result).toContain('```');
    expect(result).toContain('ROLE_UNSPECIFIED');
  });

  it('maps invalid request to configuration hint', () => {
    const result = toUserFacingErrorText('invalid request: unsupported parameter "store"');
    expect(result).toContain('⟦i18n:chatError.badRequest⟧');
    expect(result).toContain('```');
  });

  it('maps 401 to authentication hint', () => {
    const result = toUserFacingErrorText('Error 401: Unauthorized');
    expect(result).toContain('⟦i18n:chatError.auth⟧');
    expect(result).toContain('```');
    expect(result).toContain('```');
  });

  it('maps 429 / rate limit to throttle hint', () => {
    const result = toUserFacingErrorText('429 Too Many Requests - rate limit exceeded');
    expect(result).toContain('⟦i18n:chatError.rateLimit⟧');
    expect(result).toContain('```');
  });

  it('passes through unknown errors unchanged', () => {
    const raw = 'some obscure upstream error';
    expect(toUserFacingErrorText(raw)).toBe(raw);
  });

  it('still maps first_response_timeout correctly (regression)', () => {
    expect(toUserFacingErrorText('first_response_timeout')).toBe(
      '⟦i18n:chatError.timeout⟧'
    );
  });

  it('maps 5xx server errors to upstream service hint', () => {
    const result = toUserFacingErrorText('HTTP 502: Bad Gateway');
    expect(result).toContain('⟦i18n:chatError.upstream⟧');
    expect(result).toContain('```');
    expect(result).toContain('502');
  });

  it('maps "server error" to upstream service hint', () => {
    const result = toUserFacingErrorText('internal server error');
    expect(result).toContain('⟦i18n:chatError.upstream⟧');
  });

  it('maps "overloaded" to upstream service hint', () => {
    const result = toUserFacingErrorText('overloaded_error');
    expect(result).toContain('⟦i18n:chatError.upstream⟧');
  });

  it('maps "terminated" to network connection hint', () => {
    const result = toUserFacingErrorText('terminated');
    expect(result).toContain('⟦i18n:chatError.network⟧');
    expect(result).toContain('terminated');
  });

  it('maps "connection error" to network connection hint', () => {
    const result = toUserFacingErrorText('connection error: ECONNRESET');
    expect(result).toContain('⟦i18n:chatError.network⟧');
  });

  it('maps "fetch failed" to network connection hint', () => {
    const result = toUserFacingErrorText('fetch failed');
    expect(result).toContain('⟦i18n:chatError.network⟧');
  });

  it('maps "other side closed" to network connection hint', () => {
    const result = toUserFacingErrorText('other side closed');
    expect(result).toContain('⟦i18n:chatError.network⟧');
  });

  it('maps "too many requests" without status code to throttle hint', () => {
    const result = toUserFacingErrorText('too many requests');
    expect(result).toContain('⟦i18n:chatError.rateLimit⟧');
    expect(result).toContain('```');
  });

  it('maps "retry delay exceeded" to network connection hint', () => {
    const result = toUserFacingErrorText('retry delay exceeded');
    expect(result).toContain('⟦i18n:chatError.network⟧');
  });
});

describe('resolveAssistantStreamErrorText', () => {
  it('maps provider stream errors through the user-facing formatter', () => {
    const result = resolveAssistantStreamErrorText({
      type: 'error',
      reason: 'error',
      error: {
        role: 'assistant',
        content: [],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gemma4:31b',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'error',
        errorMessage: 'HTTP 400: invalid request - malformed tool call JSON',
        timestamp: 0,
      },
    });

    expect(result).toContain('⟦i18n:chatError.badRequest⟧');
    expect(result).toContain('malformed tool call JSON');
  });

  it('falls back to the event reason when the provider omits errorMessage', () => {
    const result = resolveAssistantStreamErrorText({
      type: 'error',
      reason: 'aborted',
      error: {
        role: 'assistant',
        content: [],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gemma4:31b',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'aborted',
        timestamp: 0,
      },
    });

    expect(result).toBe('aborted');
  });

  it('defensively falls back when the provider omits the error payload entirely', () => {
    const result = resolveAssistantStreamErrorText({
      type: 'error',
      reason: 'error',
      error: undefined as never,
    });

    expect(result).toBe('error');
  });
});

describe('buildTerminalErrorMessage', () => {
  it('preserves partial streamed text before the error footer', () => {
    const result = buildTerminalErrorMessage(
      'HTTP 400: invalid request',
      'Partial analysis already streamed'
    );

    expect(result).toContain('Partial analysis already streamed');
    expect(result).toContain('**Error**: HTTP 400: invalid request');
    expect(result).toContain('⟦i18n:chatError.hintCheckConfig⟧');
  });

  it('uses the retry hint for non-4xx terminal errors', () => {
    const result = buildTerminalErrorMessage('connection reset');
    expect(result).toContain('⟦i18n:chatError.hintAutoRetry⟧');
  });
});

describe('buildTerminalErrorEmissionDetails', () => {
  it('preserves streamed partial text before the error footer', () => {
    const result = buildTerminalErrorEmissionDetails({
      errorText: 'HTTP 400: invalid request',
      streamedText: 'Partial body',
    });

    expect(result.partialText).toBe('Partial body');
    expect(result.messageText).toContain('Partial body');
    expect(result.messageText).toContain('**Error**: HTTP 400: invalid request');
  });

  it('omits empty flush fragments cleanly', () => {
    const result = buildTerminalErrorEmissionDetails({
      errorText: 'connection reset',
      streamedText: '',
    });

    expect(result.partialText).toBe('');
    expect(result.messageText).toContain('⟦i18n:chatError.hintAutoRetry⟧');
  });
});

describe('resolveAbortDisposition', () => {
  it('prioritizes timeout over other abort reasons', () => {
    expect(
      resolveAbortDisposition({
        abortedByTimeout: true,
        abortedByLoopGuard: true,
        abortedByStreamError: true,
      })
    ).toBe('timeout');
  });

  it('returns stream_error when only stream-error preservation should apply', () => {
    expect(
      resolveAbortDisposition({
        abortedByTimeout: false,
        abortedByLoopGuard: false,
        abortedByStreamError: true,
      })
    ).toBe('stream_error');
  });
});

describe('shouldPreserveExistingTrace', () => {
  it('preserves the published error trace for loop guard and stream errors only', () => {
    expect(shouldPreserveExistingTrace('loop_guard')).toBe(true);
    expect(shouldPreserveExistingTrace('stream_error')).toBe(true);
    expect(shouldPreserveExistingTrace('timeout')).toBe(false);
    expect(shouldPreserveExistingTrace('user')).toBe(false);
  });
});
