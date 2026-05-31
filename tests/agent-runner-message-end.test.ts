import { describe, expect, it } from 'vitest';

import {
  buildTerminalErrorEmissionDetails,
  buildTerminalErrorMessage,
  resolveAbortDisposition,
  resolveAssistantStreamErrorText,
  resolveMessageEndPayload,
  shouldPreserveExistingTrace,
  toUserFacingErrorText,
} from '../src/main/claude/agent-runner-message-end';

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
      '模型响应超时：长时间未收到上游返回，请稍后重试或检查当前模型/网关负载。'
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
      '模型返回了一个空的成功结果，当前模型或网关兼容性可能有问题，请重试或切换协议后再试。'
    );
  });
});

describe('toUserFacingErrorText', () => {
  it('maps 400 / bad request to configuration hint', () => {
    const result = toUserFacingErrorText('HTTP 400: bad request - ROLE_UNSPECIFIED');
    expect(result).toContain('请求被上游拒绝（400）');
    expect(result).toContain('原始错误:');
    expect(result).toContain('ROLE_UNSPECIFIED');
  });

  it('maps invalid request to configuration hint', () => {
    const result = toUserFacingErrorText('invalid request: unsupported parameter "store"');
    expect(result).toContain('请求被上游拒绝（400）');
    expect(result).toContain('原始错误:');
  });

  it('maps 401 to authentication hint', () => {
    const result = toUserFacingErrorText('Error 401: Unauthorized');
    expect(result).toContain('认证失败');
    expect(result).toContain('API Key');
    expect(result).toContain('原始错误:');
  });

  it('maps 429 / rate limit to throttle hint', () => {
    const result = toUserFacingErrorText('429 Too Many Requests - rate limit exceeded');
    expect(result).toContain('请求被限流（429）');
    expect(result).toContain('原始错误:');
  });

  it('passes through unknown errors unchanged', () => {
    const raw = 'some obscure upstream error';
    expect(toUserFacingErrorText(raw)).toBe(raw);
  });

  it('still maps first_response_timeout correctly (regression)', () => {
    expect(toUserFacingErrorText('first_response_timeout')).toBe(
      '模型响应超时：长时间未收到上游返回，请稍后重试或检查当前模型/网关负载。'
    );
  });

  it('maps 5xx server errors to upstream service hint', () => {
    const result = toUserFacingErrorText('HTTP 502: Bad Gateway');
    expect(result).toContain('上游服务异常');
    expect(result).toContain('原始错误:');
    expect(result).toContain('502');
  });

  it('maps "server error" to upstream service hint', () => {
    const result = toUserFacingErrorText('internal server error');
    expect(result).toContain('上游服务异常');
  });

  it('maps "overloaded" to upstream service hint', () => {
    const result = toUserFacingErrorText('overloaded_error');
    expect(result).toContain('上游服务异常');
  });

  it('maps "terminated" to network connection hint', () => {
    const result = toUserFacingErrorText('terminated');
    expect(result).toContain('网络连接中断');
    expect(result).toContain('terminated');
  });

  it('maps "connection error" to network connection hint', () => {
    const result = toUserFacingErrorText('connection error: ECONNRESET');
    expect(result).toContain('网络连接中断');
  });

  it('maps "fetch failed" to network connection hint', () => {
    const result = toUserFacingErrorText('fetch failed');
    expect(result).toContain('网络连接中断');
  });

  it('maps "other side closed" to network connection hint', () => {
    const result = toUserFacingErrorText('other side closed');
    expect(result).toContain('网络连接中断');
  });

  it('maps "too many requests" without status code to throttle hint', () => {
    const result = toUserFacingErrorText('too many requests');
    expect(result).toContain('请求被限流（429）');
    expect(result).toContain('原始错误:');
  });

  it('maps "retry delay exceeded" to network connection hint', () => {
    const result = toUserFacingErrorText('retry delay exceeded');
    expect(result).toContain('网络连接中断');
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

    expect(result).toContain('请求被上游拒绝（400）');
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
    expect(result).toContain('请检查配置后重试');
  });

  it('uses the retry hint for non-4xx terminal errors', () => {
    const result = buildTerminalErrorMessage('connection reset');
    expect(result).toContain('Agent 正在自动重试');
  });
});

describe('buildTerminalErrorEmissionDetails', () => {
  it('preserves flushed thinking/text deltas and appends them to partial text', () => {
    const result = buildTerminalErrorEmissionDetails({
      errorText: 'HTTP 400: invalid request',
      streamedText: 'Partial body',
      flushedThinking: 'inner reasoning',
      flushedText: ' plus tail',
    });

    expect(result.thinkingDelta).toBe('inner reasoning');
    expect(result.textDelta).toBe(' plus tail');
    expect(result.partialText).toBe('Partial body plus tail');
    expect(result.messageText).toContain('Partial body plus tail');
    expect(result.messageText).toContain('**Error**: HTTP 400: invalid request');
  });

  it('omits empty flush fragments cleanly', () => {
    const result = buildTerminalErrorEmissionDetails({
      errorText: 'connection reset',
      streamedText: '',
    });

    expect(result.thinkingDelta).toBeUndefined();
    expect(result.textDelta).toBeUndefined();
    expect(result.partialText).toBe('');
    expect(result.messageText).toContain('Agent 正在自动重试');
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
