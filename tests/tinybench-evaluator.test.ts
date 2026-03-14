import { describe, expect, it } from 'vitest';
import {
  evaluateTextAssert,
  evaluateManualReview,
  evaluateFilesystemCheck,
} from '../src/main/cua/tinybench-evaluator';
import type { RunResult, TaskSpec } from '../src/main/cua/types';

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
});
