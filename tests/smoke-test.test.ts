/**
 * TinyBench Smoke Test — run calc-add-2-3 end-to-end.
 *
 * Usage:
 *   GUI_CUA_API_KEY=... GUI_CUA_BASE_URL=... npx vitest run tests/smoke-test.test.ts --timeout 600000
 */
import { describe, it, expect } from 'vitest';
import { runTask } from '../src/main/cua/tinybench-runner';
import { resolveTask } from '../src/main/cua/tinybench-tasks';
import { evaluateTextAssert } from '../src/main/cua/tinybench-evaluator';
import type { BenchCliOptions } from '../src/main/cua/types';

const apiKey = process.env.GUI_CUA_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '';
const baseUrl = process.env.GUI_CUA_BASE_URL || process.env.OPENAI_BASE_URL || 'https://msra-im-relay.servicebus.windows.net/coproxy/v1';
const model = process.env.GUI_CUA_MODEL || 'gpt-5.4';

console.log('[smoke-test init] apiKey length:', apiKey.length, 'baseUrl:', baseUrl, 'model:', model);

describe('TinyBench Smoke Test', () => {
  it('calc-add-2-3 via sampling → MSRA Relay', async () => {
    if (!apiKey) {
      console.log('Skipping: GUI_CUA_API_KEY not set');
      return;
    }

    const options: BenchCliOptions = {
      model,
      repeats: 1,
      dryRun: false,
      apiKey,
      baseUrl,
    };

    console.log(`Model: ${model}`);
    console.log(`Base URL: ${baseUrl || '(default)'}`);

    const spec = resolveTask(options, 'calc-add-2-3');
    console.log(`Task: ${spec.id}, expected: ${spec.expected}`);

    const run = await runTask(spec, { apiKey, baseUrl });

    console.log(`Steps: ${run.steps}, Duration: ${Math.round(run.durationMs / 1000)}s`);
    console.log(`Final text: ${run.finalText.slice(0, 200)}`);
    if (run.error) console.log(`Error: ${run.error}`);

    const evalResult = evaluateTextAssert(spec, run);
    console.log(`Result: ${evalResult.passed ? 'PASS' : 'FAIL'} — ${evalResult.detail}`);

    expect(evalResult.passed).toBe(true);
  }, 600_000); // 10 minute timeout
});
