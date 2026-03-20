/**
 * @module main/cua/cua-benchmark
 *
 * Automated benchmark runner for CUA harness tuning.
 * Runs predefined tasks N times, classifies failures, generates reports.
 *
 * Usage (from Electron main process or CLI):
 *   import { runBenchmark, TIER1_TASKS } from './cua-benchmark';
 *   const report = await runBenchmark(TIER1_TASKS, { runs: 5 });
 *   console.log(report);
 */

import { executeCuaTask, type CuaTaskResult } from './cua-sub-agent';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// ─── Task Definition ────────────────────────────────────────────────────────

export interface BenchmarkTask {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  instruction: string;
  maxSteps: number;
  /** Keywords that should appear in the success summary */
  successKeywords?: string[];
}

// ─── Predefined Tasks ───────────────────────────────────────────────────────

export const TIER1_TASKS: BenchmarkTask[] = [
  {
    id: 'notepad-write',
    name: 'Notepad: write and save',
    tier: 1,
    instruction: 'Open Notepad, type "Hello CUA Test" and save the file to the Desktop as "cua-test.txt".',
    maxSteps: 10,
    successKeywords: ['save', 'notepad', 'complete'],
  },
  {
    id: 'settings-dark-mode',
    name: 'Settings: toggle dark mode',
    tier: 1,
    instruction: 'Open Windows Settings and toggle the display theme to Dark mode.',
    maxSteps: 8,
    successKeywords: ['dark', 'mode', 'complete'],
  },
  {
    id: 'calculator-add',
    name: 'Calculator: simple addition',
    tier: 1,
    instruction: 'Open the Calculator app, calculate 123 + 456, and tell me the result.',
    maxSteps: 8,
    successKeywords: ['579'],
  },
];

export const TIER2_TASKS: BenchmarkTask[] = [
  {
    id: 'excel-sort',
    name: 'Excel: sort data by column',
    tier: 2,
    instruction: 'Open the Excel file on the Desktop called "sales-data.xlsx", sort the data by the "Revenue" column from highest to lowest, and save.',
    maxSteps: 15,
    successKeywords: ['sort', 'save', 'complete'],
  },
  {
    id: 'browser-search',
    name: 'Browser: search and extract',
    tier: 2,
    instruction: 'Open Chrome, search for "current weather in Beijing", and tell me the temperature shown.',
    maxSteps: 12,
    successKeywords: ['temperature', 'weather', '°'],
  },
];

// ─── Failure Classification ─────────────────────────────────────────────────

export type FailureType = 'success' | 'click_miss' | 'loop' | 'timeout' | 'tool_error' | 'model_gave_up' | 'exception' | 'unknown';

export interface BenchmarkRunResult {
  taskId: string;
  runIndex: number;
  result: CuaTaskResult;
  failureType: FailureType;
  durationMs: number;
}

function classifyResult(result: CuaTaskResult): FailureType {
  if (result.success) return 'success';
  if (result.failureType === 'exception') return 'exception';
  if (result.failureType === 'max_steps') return 'timeout';
  if (result.failureType === 'loop') return 'loop';
  if (result.failureType === 'model_gave_up') return 'model_gave_up';

  // Heuristic classification from summary text
  const summary = result.summary.toLowerCase();
  if (summary.includes('unchanged') || summary.includes('missed')) return 'click_miss';
  if (summary.includes('loop') || summary.includes('repeating')) return 'loop';
  if (summary.includes('stuck') || summary.includes('impossible')) return 'model_gave_up';
  if (summary.includes('error') || summary.includes('failed')) return 'tool_error';

  return 'unknown';
}

// ─── Benchmark Runner ───────────────────────────────────────────────────────

export interface BenchmarkOptions {
  runs: number;
  model?: string;
  provider?: string;
  baseUrl?: string;
  /** Label for this benchmark run (e.g., "prompt-v2", "som-enabled") */
  variant?: string;
}

export interface BenchmarkReport {
  variant: string;
  timestamp: string;
  tasks: Array<{
    taskId: string;
    taskName: string;
    tier: number;
    totalRuns: number;
    successes: number;
    successRate: number;
    avgStepsOnSuccess: number;
    avgDurationMs: number;
    failureBreakdown: Record<FailureType, number>;
    runs: BenchmarkRunResult[];
  }>;
  overall: {
    totalRuns: number;
    totalSuccesses: number;
    successRate: number;
  };
}

export async function runBenchmark(
  tasks: BenchmarkTask[],
  options: BenchmarkOptions,
): Promise<BenchmarkReport> {
  const { runs, model, provider, baseUrl, variant = 'default' } = options;
  const report: BenchmarkReport = {
    variant,
    timestamp: new Date().toISOString(),
    tasks: [],
    overall: { totalRuns: 0, totalSuccesses: 0, successRate: 0 },
  };

  console.error(`\n${'='.repeat(60)}`);
  console.error(`CUA Benchmark: ${variant} | ${tasks.length} tasks × ${runs} runs`);
  console.error(`${'='.repeat(60)}\n`);

  for (const task of tasks) {
    console.error(`\n--- Task: ${task.name} (Tier ${task.tier}) ---`);
    const taskRuns: BenchmarkRunResult[] = [];
    let successes = 0;
    let totalSteps = 0;
    let totalDuration = 0;
    const failureCounts: Record<FailureType, number> = {
      success: 0, click_miss: 0, loop: 0, timeout: 0,
      tool_error: 0, model_gave_up: 0, exception: 0, unknown: 0,
    };

    for (let i = 0; i < runs; i++) {
      const startTime = Date.now();
      console.error(`  Run ${i + 1}/${runs}...`);

      const result = await executeCuaTask(task.instruction, {
        model, provider, baseUrl,
        maxTurns: task.maxSteps,
      });

      const durationMs = Date.now() - startTime;
      const failureType = classifyResult(result);
      failureCounts[failureType]++;

      if (failureType === 'success') {
        successes++;
        totalSteps += result.stepsUsed;
      }
      totalDuration += durationMs;

      const runResult: BenchmarkRunResult = {
        taskId: task.id,
        runIndex: i,
        result,
        failureType,
        durationMs,
      };
      taskRuns.push(runResult);

      const status = failureType === 'success' ? '✓' : `✗ (${failureType})`;
      console.error(`  ${status} — ${result.stepsUsed} steps, ${(durationMs / 1000).toFixed(1)}s`);
    }

    report.tasks.push({
      taskId: task.id,
      taskName: task.name,
      tier: task.tier,
      totalRuns: runs,
      successes,
      successRate: successes / runs,
      avgStepsOnSuccess: successes > 0 ? totalSteps / successes : 0,
      avgDurationMs: totalDuration / runs,
      failureBreakdown: failureCounts,
      runs: taskRuns,
    });

    report.overall.totalRuns += runs;
    report.overall.totalSuccesses += successes;

    console.error(`  Result: ${successes}/${runs} (${(successes / runs * 100).toFixed(0)}%)`);
  }

  report.overall.successRate = report.overall.totalSuccesses / report.overall.totalRuns;

  console.error(`\n${'='.repeat(60)}`);
  console.error(`Overall: ${report.overall.totalSuccesses}/${report.overall.totalRuns} (${(report.overall.successRate * 100).toFixed(0)}%)`);
  console.error(`${'='.repeat(60)}\n`);

  return report;
}

// ─── Report Generator ───────────────────────────────────────────────────────

export function generateMarkdownReport(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`# CUA Benchmark Report`);
  lines.push(`**Variant**: ${report.variant}`);
  lines.push(`**Date**: ${report.timestamp}`);
  lines.push(`**Overall**: ${report.overall.totalSuccesses}/${report.overall.totalRuns} (${(report.overall.successRate * 100).toFixed(0)}%)`);
  lines.push('');
  lines.push('## Results by Task');
  lines.push('');
  lines.push('| Task | Tier | Success Rate | Avg Steps | Avg Duration |');
  lines.push('|------|------|-------------|-----------|-------------|');

  for (const task of report.tasks) {
    lines.push(`| ${task.taskName} | ${task.tier} | ${(task.successRate * 100).toFixed(0)}% (${task.successes}/${task.totalRuns}) | ${task.avgStepsOnSuccess.toFixed(1)} | ${(task.avgDurationMs / 1000).toFixed(1)}s |`);
  }

  lines.push('');
  lines.push('## Failure Breakdown');
  lines.push('');
  lines.push('| Task | click_miss | loop | timeout | tool_error | model_gave_up | exception | unknown |');
  lines.push('|------|-----------|------|---------|------------|--------------|-----------|---------|');

  for (const task of report.tasks) {
    const fb = task.failureBreakdown;
    lines.push(`| ${task.taskName} | ${fb.click_miss} | ${fb.loop} | ${fb.timeout} | ${fb.tool_error} | ${fb.model_gave_up} | ${fb.exception} | ${fb.unknown} |`);
  }

  lines.push('');
  lines.push('## Run Details');
  for (const task of report.tasks) {
    lines.push(`\n### ${task.taskName}`);
    for (const run of task.runs) {
      const status = run.failureType === 'success' ? '✓' : `✗ ${run.failureType}`;
      lines.push(`- Run ${run.runIndex + 1}: ${status} | ${run.result.stepsUsed} steps | ${(run.durationMs / 1000).toFixed(1)}s | ${run.result.summary.slice(0, 100)}`);
      if (run.result.trajectoryDir) {
        lines.push(`  Trajectory: \`${run.result.trajectoryDir}\``);
      }
    }
  }

  return lines.join('\n');
}

/** Save benchmark report to disk */
export async function saveBenchmarkReport(report: BenchmarkReport): Promise<string> {
  const baseDir = path.join(
    os.platform() === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'open-cowork')
      : path.join(os.homedir(), 'Library', 'Application Support', 'open-cowork'),
    'cua-benchmarks',
  );
  await fs.mkdir(baseDir, { recursive: true });

  const filename = `benchmark-${report.variant}-${report.timestamp.replace(/[:.]/g, '-')}.md`;
  const filepath = path.join(baseDir, filename);
  await fs.writeFile(filepath, generateMarkdownReport(report));

  console.error(`[CUA Benchmark] Report saved to ${filepath}`);
  return filepath;
}
