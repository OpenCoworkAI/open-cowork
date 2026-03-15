import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  evaluateTextAssert,
  evaluateManualReview,
  evaluateFilesystemCheck,
  evaluateLlmJudge,
} from '../src/main/cua/tinybench-evaluator';
import type { RunResult, TaskSpec, ToolCallRecord } from '../src/main/cua/types';
import type OpenAI from 'openai';

function makeSpec(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 'test-task',
    prompt: 'test prompt',
    model: 'gpt-5.4',
    maxTurns: 10,
    timeoutMs: 60_000,
    verificationMode: 'text_assert',
    expected: '5',
    outputDir: '/tmp/test',
    ...overrides,
  };
}

function makeRun(overrides: Partial<RunResult> = {}): RunResult {
  return {
    taskId: 'test-task',
    passed: false,
    steps: 3,
    durationMs: 5000,
    tokens: { input: 100, output: 50, total: 150 },
    finalText: 'The result is 5.',
    toolCalls: [],
    artifactDir: '/tmp/test',
    ...overrides,
  };
}

function makeToolCall(name: string, args: Record<string, unknown> = {}): ToolCallRecord {
  return {
    index: 0,
    toolName: name,
    args,
    result: '',
    durationMs: 100,
    isError: false,
  };
}

/** Create a fake OpenAI client with a mocked responses.create */
function makeMockOpenAI(createFn: ReturnType<typeof vi.fn>) {
  return { responses: { create: createFn } } as unknown as OpenAI;
}

function mockJudgeResponse(text: string) {
  return {
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text }],
      },
    ],
  };
}

describe('tinybench-evaluator', () => {
  describe('evaluateTextAssert', () => {
    it('passes when final text contains expected', () => {
      const result = evaluateTextAssert(makeSpec(), makeRun());
      expect(result.passed).toBe(true);
      expect(result.mode).toBe('text_assert');
    });

    it('fails when final text does not contain expected', () => {
      const result = evaluateTextAssert(
        makeSpec({ expected: '42' }),
        makeRun({ finalText: 'The result is 5.' })
      );
      expect(result.passed).toBe(false);
    });

    it('is case-insensitive', () => {
      const result = evaluateTextAssert(
        makeSpec({ expected: 'HELLO' }),
        makeRun({ finalText: 'hello world' })
      );
      expect(result.passed).toBe(true);
    });

    it('fails when run has an error', () => {
      const result = evaluateTextAssert(
        makeSpec(),
        makeRun({ error: 'timeout' })
      );
      expect(result.passed).toBe(false);
      expect(result.detail).toContain('error');
    });

    it('fails when no expected value defined', () => {
      const result = evaluateTextAssert(
        makeSpec({ expected: undefined }),
        makeRun()
      );
      expect(result.passed).toBe(false);
      expect(result.detail).toContain('No expected value');
    });

    it('filters base64 data URLs from markdown images — prevents false positives', () => {
      const fakeBase64 = 'QUFB'.repeat(50); // 200 chars of base64
      const pollutedText = `![screenshot](data:image/png;base64,${fakeBase64})`;
      const result = evaluateTextAssert(
        makeSpec({ expected: 'QUF' }),
        makeRun({ finalText: pollutedText })
      );
      expect(result.passed).toBe(false);
    });

    it('still matches real text when base64 is also present', () => {
      const fakeBase64 = 'X'.repeat(200);
      const textWithScreenshot = `The answer is 5. ![screenshot](data:image/png;base64,${fakeBase64})`;
      const result = evaluateTextAssert(
        makeSpec({ expected: '5' }),
        makeRun({ finalText: textWithScreenshot })
      );
      expect(result.passed).toBe(true);
    });

    it('filters raw data URLs without markdown wrapper', () => {
      const fakeBase64 = 'Z'.repeat(200);
      const pollutedText = `data:image/png;base64,${fakeBase64}`;
      const result = evaluateTextAssert(
        makeSpec({ expected: 'ZZZZ' }),
        makeRun({ finalText: pollutedText })
      );
      expect(result.passed).toBe(false);
    });
  });

  describe('evaluateManualReview', () => {
    it('always returns not passed with manual_review mode', () => {
      const result = evaluateManualReview(makeSpec(), makeRun());
      expect(result.passed).toBe(false);
      expect(result.mode).toBe('manual_review');
      expect(result.detail).toContain('Manual review');
    });
  });

  describe('evaluateFilesystemCheck', () => {
    it('passes when path exists', () => {
      const result = evaluateFilesystemCheck(
        makeSpec({ verificationMode: 'filesystem_check', expectedPath: '/tmp' }),
        makeRun()
      );
      expect(result.passed).toBe(true);
      expect(result.mode).toBe('filesystem_check');
      expect(result.detail).toContain('exists');
    });

    it('fails when path does not exist', () => {
      const result = evaluateFilesystemCheck(
        makeSpec({
          verificationMode: 'filesystem_check',
          expectedPath: '/tmp/tinybench-nonexistent-path-' + Date.now(),
        }),
        makeRun()
      );
      expect(result.passed).toBe(false);
      expect(result.detail).toContain('does not exist');
    });

    it('fails when no expectedPath defined', () => {
      const result = evaluateFilesystemCheck(
        makeSpec({ verificationMode: 'filesystem_check', expectedPath: undefined }),
        makeRun()
      );
      expect(result.passed).toBe(false);
      expect(result.detail).toContain('No expectedPath');
    });

    it('fails when run has an error', () => {
      const result = evaluateFilesystemCheck(
        makeSpec({ verificationMode: 'filesystem_check', expectedPath: '/tmp' }),
        makeRun({ error: 'timeout' })
      );
      expect(result.passed).toBe(false);
      expect(result.detail).toContain('error');
    });
  });

  describe('evaluateLlmJudge', () => {
    let mockCreate: ReturnType<typeof vi.fn>;
    let mockClient: OpenAI;

    beforeEach(() => {
      mockCreate = vi.fn();
      mockClient = makeMockOpenAI(mockCreate);
    });

    it('returns FAIL immediately when run has an error', async () => {
      const result = await evaluateLlmJudge(
        makeSpec({ verificationMode: 'llm_judge' }),
        makeRun({ error: 'timeout' }),
        { _openaiClient: mockClient }
      );
      expect(result.passed).toBe(false);
      expect(result.mode).toBe('llm_judge');
      expect(result.confidence).toBe(1.0);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('returns PASS when judge says PASS', async () => {
      mockCreate.mockResolvedValue(
        mockJudgeResponse('PASS\n0.95\nThe calculator shows 5 which matches the expected result.')
      );

      const result = await evaluateLlmJudge(
        makeSpec({ verificationMode: 'llm_judge', evaluationGoal: 'Calculator displays 5.' }),
        makeRun({
          toolCalls: [
            makeToolCall('key_press', { key: '2' }),
            makeToolCall('key_press', { key: '+' }),
            makeToolCall('key_press', { key: '3' }),
            makeToolCall('key_press', { key: '=' }),
          ],
          lastScreenshotBase64: 'fakeBase64Data',
        }),
        { _openaiClient: mockClient }
      );

      expect(result.passed).toBe(true);
      expect(result.confidence).toBe(0.95);
      expect(result.detail).toContain('calculator');
    });

    it('returns FAIL when judge says FAIL', async () => {
      mockCreate.mockResolvedValue(
        mockJudgeResponse('FAIL\n0.9\nThe agent did not perform any calculator operations.')
      );

      const result = await evaluateLlmJudge(
        makeSpec({ verificationMode: 'llm_judge' }),
        makeRun({ toolCalls: [] }),
        { _openaiClient: mockClient }
      );

      expect(result.passed).toBe(false);
      expect(result.confidence).toBe(0.9);
    });

    it('includes tool call summary in the judge prompt', async () => {
      mockCreate.mockResolvedValue(mockJudgeResponse('PASS\n0.8\nOK'));

      await evaluateLlmJudge(
        makeSpec({ verificationMode: 'llm_judge' }),
        makeRun({
          toolCalls: [
            makeToolCall('click', { x: 100, y: 200 }),
            makeToolCall('key_press', { key: '5' }),
          ],
        }),
        { _openaiClient: mockClient }
      );

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const callArgs = mockCreate.mock.calls[0][0];
      const userMsg = callArgs.input.find((m: any) => m.role === 'user');
      const textContent = userMsg.content.find((c: any) => c.type === 'input_text');
      expect(textContent.text).toContain('click');
      expect(textContent.text).toContain('key_press');
      expect(textContent.text).toContain('2 total');
    });

    it('sends screenshot as input_image when available', async () => {
      mockCreate.mockResolvedValue(mockJudgeResponse('PASS\n0.9\nLooks good.'));

      await evaluateLlmJudge(
        makeSpec({ verificationMode: 'llm_judge' }),
        makeRun({ lastScreenshotBase64: 'abc123base64data' }),
        { _openaiClient: mockClient }
      );

      const callArgs = mockCreate.mock.calls[0][0];
      const userMsg = callArgs.input.find((m: any) => m.role === 'user');
      const imageContent = userMsg.content.find((c: any) => c.type === 'input_image');
      expect(imageContent).toBeDefined();
      expect(imageContent.image_url).toBe('data:image/png;base64,abc123base64data');
    });

    it('omits screenshot when lastScreenshotBase64 is undefined', async () => {
      mockCreate.mockResolvedValue(mockJudgeResponse('FAIL\n0.7\nNo screenshot.'));

      await evaluateLlmJudge(
        makeSpec({ verificationMode: 'llm_judge' }),
        makeRun({ lastScreenshotBase64: undefined }),
        { _openaiClient: mockClient }
      );

      const callArgs = mockCreate.mock.calls[0][0];
      const userMsg = callArgs.input.find((m: any) => m.role === 'user');
      const imageContent = userMsg.content.find((c: any) => c.type === 'input_image');
      expect(imageContent).toBeUndefined();
    });

    it('includes anti-hallucination rules in system prompt', async () => {
      mockCreate.mockResolvedValue(mockJudgeResponse('FAIL\n0.9\nNo mutating actions.'));

      await evaluateLlmJudge(
        makeSpec({ verificationMode: 'llm_judge' }),
        makeRun(),
        { _openaiClient: mockClient }
      );

      const callArgs = mockCreate.mock.calls[0][0];
      const devMsg = callArgs.input.find((m: any) => m.role === 'developer');
      expect(devMsg.content).toContain('anti-hallucination');
      expect(devMsg.content).toContain('0 mutating actions');
    });

    it('reports mutating vs total tool call counts', async () => {
      mockCreate.mockResolvedValue(mockJudgeResponse('PASS\n0.85\nOK'));

      await evaluateLlmJudge(
        makeSpec({ verificationMode: 'llm_judge' }),
        makeRun({
          toolCalls: [
            makeToolCall('screenshot_for_display'),
            makeToolCall('click', { x: 10, y: 20 }),
            makeToolCall('screenshot_for_display'),
            makeToolCall('key_press', { key: '5' }),
          ],
        }),
        { _openaiClient: mockClient }
      );

      const callArgs = mockCreate.mock.calls[0][0];
      const userMsg = callArgs.input.find((m: any) => m.role === 'user');
      const textContent = userMsg.content.find((c: any) => c.type === 'input_text');
      expect(textContent.text).toContain('4 total');
      expect(textContent.text).toContain('2 mutating');
    });

    it('handles OpenAI API failure gracefully', async () => {
      mockCreate.mockRejectedValue(new Error('API rate limit'));

      const result = await evaluateLlmJudge(
        makeSpec({ verificationMode: 'llm_judge' }),
        makeRun(),
        { _openaiClient: mockClient }
      );

      expect(result.passed).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.detail).toContain('LLM judge failed');
      expect(result.detail).toContain('API rate limit');
    });

    it('defaults confidence to 0.8 when judge does not provide a number', async () => {
      mockCreate.mockResolvedValue(
        mockJudgeResponse('PASS\nnot-a-number\nThe task completed.')
      );

      const result = await evaluateLlmJudge(
        makeSpec({ verificationMode: 'llm_judge' }),
        makeRun(),
        { _openaiClient: mockClient }
      );

      expect(result.passed).toBe(true);
      expect(result.confidence).toBe(0.8);
    });

    it('strips base64 from finalText before sending to judge', async () => {
      mockCreate.mockResolvedValue(mockJudgeResponse('FAIL\n0.9\nNo real output.'));

      const fakeBase64 = 'A'.repeat(500);
      await evaluateLlmJudge(
        makeSpec({ verificationMode: 'llm_judge' }),
        makeRun({
          finalText: `Result: 5. ![screenshot](data:image/png;base64,${fakeBase64})`,
        }),
        { _openaiClient: mockClient }
      );

      const callArgs = mockCreate.mock.calls[0][0];
      const userMsg = callArgs.input.find((m: any) => m.role === 'user');
      const textContent = userMsg.content.find((c: any) => c.type === 'input_text');
      expect(textContent.text).not.toContain(fakeBase64);
      expect(textContent.text).toContain('Result: 5');
    });
  });
});
