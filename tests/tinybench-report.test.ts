import { describe, expect, it } from 'vitest';
import {
  buildTaskReport,
  buildSuiteReport,
} from '../src/main/cua/tinybench-report';
import type { EvalResult, RunResult, TaskSpec } from '../src/main/cua/types';

function makeRun(overrides: Partial<RunResult> = {}): RunResult {
  return {
    taskId: 'calc-add-2-3',
    passed: false,
    steps: 4,
    durationMs: 8000,
    tokens: { input: 200, output: 80, total: 280 },
    finalText: 'Result is 5.',
    toolCalls: [],
    artifactDir: '/tmp/test',
    ...overrides,
  };
}

function makeEval(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    taskId: 'calc-add-2-3',
    passed: true,
    mode: 'text_assert',
    detail: 'Contains expected value.',
    ...overrides,
  };
}

function makeSpec(): TaskSpec {
  return {
    id: 'calc-add-2-3',
    prompt: 'test',
    model: 'gpt-5.4',
    maxTurns: 10,
    timeoutMs: 60000,
    verificationMode: 'text_assert',
    expected: '5',
    outputDir: '/tmp/test',
  };
}

describe('tinybench-report', () => {
  describe('buildTaskReport', () => {
    it('combines run and evaluation', () => {
      const report = buildTaskReport(makeSpec(), makeRun(), makeEval());
      expect(report.taskId).toBe('calc-add-2-3');
      expect(report.run.passed).toBe(true); // overridden by evaluation
      expect(report.evaluation.passed).toBe(true);
    });
  });

  describe('buildSuiteReport', () => {
    it('calculates summary stats', () => {
      const reports = [
        buildTaskReport(makeSpec(), makeRun({ steps: 3, durationMs: 6000 }), makeEval({ passed: true })),
        buildTaskReport(makeSpec(), makeRun({ steps: 5, durationMs: 10000 }), makeEval({ passed: false })),
      ];
      const suite = buildSuiteReport('smoke', 'gpt-5.4', reports, '/tmp/out');

      expect(suite.summary.total).toBe(2);
      expect(suite.summary.passed).toBe(1);
      expect(suite.summary.passRate).toBe(0.5);
      expect(suite.summary.avgSteps).toBe(4);
      expect(suite.summary.avgDurationMs).toBe(8000);
    });

    it('handles empty reports', () => {
      const suite = buildSuiteReport('empty', 'gpt-5.4', [], '/tmp/out');
      expect(suite.summary.total).toBe(0);
      expect(suite.summary.passRate).toBe(0);
    });
  });
});
