import { describe, expect, it } from 'vitest';
import { listTasks, listSuites, resolveSuiteTaskIds, resolveTask } from '../src/main/cua/tinybench-tasks';
import type { BenchCliOptions } from '../src/main/cua/types';

const DEFAULT_OPTIONS: BenchCliOptions = {
  model: 'gpt-5.4',
  repeats: 1,
  dryRun: false,
};

describe('tinybench-tasks', () => {
  describe('listTasks', () => {
    it('returns at least one task', () => {
      const tasks = listTasks();
      expect(tasks.length).toBeGreaterThan(0);
    });

    it('includes calc-add-2-3', () => {
      expect(listTasks()).toContain('calc-add-2-3');
    });

    it('returns sorted task ids', () => {
      const tasks = listTasks();
      const sorted = [...tasks].sort();
      expect(tasks).toEqual(sorted);
    });
  });

  describe('listSuites', () => {
    it('returns at least one suite', () => {
      expect(listSuites().length).toBeGreaterThan(0);
    });

    it('includes smoke suite', () => {
      expect(listSuites()).toContain('smoke');
    });
  });

  describe('resolveSuiteTaskIds', () => {
    it('resolves smoke suite to task ids', () => {
      const ids = resolveSuiteTaskIds('smoke');
      expect(ids.length).toBeGreaterThan(0);
      expect(ids).toContain('calc-add-2-3');
    });

    it('throws on unknown suite', () => {
      expect(() => resolveSuiteTaskIds('nonexistent')).toThrow('Unknown suite');
    });

    it('returns a copy (not the original array)', () => {
      const ids1 = resolveSuiteTaskIds('smoke');
      const ids2 = resolveSuiteTaskIds('smoke');
      expect(ids1).toEqual(ids2);
      expect(ids1).not.toBe(ids2);
    });
  });

  describe('resolveTask', () => {
    it('resolves a known task with default model', () => {
      const spec = resolveTask(DEFAULT_OPTIONS, 'calc-add-2-3');
      expect(spec.id).toBe('calc-add-2-3');
      expect(spec.model).toBe('gpt-5.4');
      expect(spec.prompt).toBeTruthy();
      expect(spec.outputDir).toContain('calc-add-2-3');
    });

    it('uses custom model from options', () => {
      const spec = resolveTask({ ...DEFAULT_OPTIONS, model: 'claude-sonnet-4-5' }, 'calc-add-2-3');
      expect(spec.model).toBe('claude-sonnet-4-5');
    });

    it('throws on unknown task', () => {
      expect(() => resolveTask(DEFAULT_OPTIONS, 'nonexistent')).toThrow('Unknown task');
    });

    it('sets maxTurns and timeoutMs', () => {
      const spec = resolveTask(DEFAULT_OPTIONS, 'calc-add-2-3');
      expect(spec.maxTurns).toBeGreaterThan(0);
      expect(spec.timeoutMs).toBeGreaterThan(0);
    });

    it('includes setup and teardown commands for calculator task', () => {
      const spec = resolveTask(DEFAULT_OPTIONS, 'calc-add-2-3');
      expect(spec.setupCommand).toContain('Calculator');
      expect(spec.teardownCommand).toContain('Calculator');
    });

    it('uses custom outDir when provided', () => {
      const spec = resolveTask({ ...DEFAULT_OPTIONS, outDir: '/tmp/custom-bench' }, 'calc-add-2-3');
      expect(spec.outputDir).toContain('/tmp/custom-bench');
    });
  });
});
