#!/usr/bin/env node
/**
 * TinyBench CLI — run GUI automation benchmarks.
 *
 * Usage:
 *   node scripts/run-tinybench.mjs --task calc-add-2-3
 *   node scripts/run-tinybench.mjs --suite smoke --model gpt-5.4
 *   node scripts/run-tinybench.mjs --suite basic --repeats 3
 *   node scripts/run-tinybench.mjs --task calc-add-2-3 --dry-run
 */

// This script is an ESM entry point that imports the compiled TS modules.
// It expects dist-electron/main/ to be built first (npm run build).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Parse CLI args
function parseArgs(argv) {
  const args = argv.slice(2);
  const get = (name) => {
    const idx = args.indexOf(name);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };
  const has = (name) => args.includes(name);

  return {
    taskId: get('--task'),
    suite: get('--suite'),
    model: get('--model') || 'gpt-5.4',
    repeats: Number(get('--repeats') || '1'),
    outDir: get('--out-dir'),
    dryRun: has('--dry-run'),
    apiKey: get('--api-key') || process.env.GUI_CUA_API_KEY || process.env.OPENAI_API_KEY,
    baseUrl: get('--base-url') || process.env.GUI_CUA_BASE_URL || process.env.OPENAI_BASE_URL,
  };
}

async function main() {
  const options = parseArgs(process.argv);

  if (!options.taskId && !options.suite) {
    console.error('Usage: run-tinybench.mjs --task <id> | --suite <id> [--model <model>] [--repeats N]');
    console.error('');
    // Dynamic import to list available tasks/suites
    const { listTasks, listSuites } = await import(
      path.join(projectRoot, 'dist-electron', 'main', 'cua', 'tinybench-tasks.js')
    );
    console.error('Available tasks:', listTasks().join(', '));
    console.error('Available suites:', listSuites().join(', '));
    process.exit(1);
  }

  const { resolveTask, resolveSuiteTaskIds } = await import(
    path.join(projectRoot, 'dist-electron', 'main', 'cua', 'tinybench-tasks.js')
  );
  const { runTask } = await import(
    path.join(projectRoot, 'dist-electron', 'main', 'cua', 'tinybench-runner.js')
  );
  const { evaluate } = await import(
    path.join(projectRoot, 'dist-electron', 'main', 'cua', 'tinybench-evaluator.js')
  );
  const { buildTaskReport, buildSuiteReport, persistReport, printSummary } = await import(
    path.join(projectRoot, 'dist-electron', 'main', 'cua', 'tinybench-report.js')
  );

  // Resolve task IDs
  const taskIds = options.suite
    ? resolveSuiteTaskIds(options.suite)
    : [options.taskId];

  const suiteId = options.suite || options.taskId;
  const allReports = [];

  for (const taskId of taskIds) {
    for (let rep = 0; rep < options.repeats; rep++) {
      const label = options.repeats > 1 ? `${taskId} (run ${rep + 1}/${options.repeats})` : taskId;
      console.log(`\n>>> Running: ${label}`);

      const spec = resolveTask(options, taskId);

      if (options.dryRun) {
        console.log(`[dry-run] Task spec:`, JSON.stringify(spec, null, 2));
        continue;
      }

      const run = await runTask(spec, {
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
      });

      console.log(`[TinyBench] Run complete: ${run.steps} steps, ${Math.round(run.durationMs / 1000)}s`);
      if (run.error) console.log(`[TinyBench] Error: ${run.error}`);

      const evalResult = await evaluate(spec, run, {
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
      });

      const report = buildTaskReport(spec, run, evalResult);
      allReports.push(report);

      const status = evalResult.passed ? 'PASS' : 'FAIL';
      console.log(`[TinyBench] ${status}: ${evalResult.detail}`);
    }
  }

  if (allReports.length > 0) {
    const outDir = options.outDir
      ? path.resolve(options.outDir)
      : path.join(projectRoot, '.tmp', 'tinybench', suiteId, new Date().toISOString().replace(/[:.]/g, '-'));

    const suiteReport = buildSuiteReport(suiteId, options.model, allReports, outDir);
    const reportPath = await persistReport(suiteReport);
    printSummary(suiteReport);
    console.log(`Report saved: ${reportPath}`);
  }
}

main().catch((err) => {
  console.error('TinyBench fatal error:', err);
  process.exit(1);
});
