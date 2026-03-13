/**
 * TinyBench Report — generates JSON report and terminal summary.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { EvalResult, RunResult, SuiteReport, TaskReport, TaskSpec } from './types';

export function buildTaskReport(
  _spec: TaskSpec,
  run: RunResult,
  evaluation: EvalResult
): TaskReport {
  return {
    taskId: run.taskId,
    run: { ...run, passed: evaluation.passed },
    evaluation,
  };
}

export function buildSuiteReport(
  suiteId: string,
  model: string,
  reports: TaskReport[],
  outputPath: string
): SuiteReport {
  const passed = reports.filter((r) => r.evaluation.passed).length;
  const total = reports.length;
  const avgSteps =
    total > 0
      ? Math.round(reports.reduce((s, r) => s + r.run.steps, 0) / total)
      : 0;
  const avgDurationMs =
    total > 0
      ? Math.round(reports.reduce((s, r) => s + r.run.durationMs, 0) / total)
      : 0;
  const totalTokens = reports.reduce((s, r) => s + r.run.tokens.total, 0);

  return {
    suiteId,
    model,
    timestamp: new Date().toISOString(),
    tasks: reports,
    summary: {
      total,
      passed,
      passRate: total > 0 ? passed / total : 0,
      avgSteps,
      avgDurationMs,
      totalTokens,
    },
    outputPath,
  };
}

export async function persistReport(
  report: SuiteReport
): Promise<string> {
  await fs.mkdir(report.outputPath, { recursive: true });
  const reportPath = path.join(report.outputPath, 'report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  return reportPath;
}

export function printSummary(report: SuiteReport): void {
  const { summary } = report;
  console.log('\n' + '='.repeat(60));
  console.log(`TinyBench Report: ${report.suiteId}`);
  console.log(`Model: ${report.model}`);
  console.log(`Time: ${report.timestamp}`);
  console.log('='.repeat(60));

  for (const task of report.tasks) {
    const status = task.evaluation.passed ? 'PASS' : 'FAIL';
    const icon = task.evaluation.passed ? '+' : 'x';
    console.log(
      `  [${icon}] ${status}  ${task.taskId}  (${task.run.steps} steps, ${Math.round(task.run.durationMs / 1000)}s)`
    );
    if (!task.evaluation.passed) {
      console.log(`       ${task.evaluation.detail.slice(0, 120)}`);
    }
  }

  console.log('-'.repeat(60));
  console.log(
    `  Total: ${summary.total}  Passed: ${summary.passed}  Rate: ${(summary.passRate * 100).toFixed(0)}%`
  );
  console.log(
    `  Avg steps: ${summary.avgSteps}  Avg time: ${Math.round(summary.avgDurationMs / 1000)}s  Tokens: ${summary.totalTokens}`
  );
  console.log('='.repeat(60) + '\n');
}
