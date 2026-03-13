/**
 * TinyBench Evaluator — determines pass/fail for completed runs.
 *
 * Supports three modes:
 * - text_assert: check if model's final text contains expected substring
 * - llm_judge: call GPT-5.4 as judge to evaluate the result
 * - manual_review: always returns "needs review"
 */
import type { EvalResult, RunResult, TaskSpec } from './types';

export function evaluateTextAssert(
  spec: TaskSpec,
  run: RunResult
): EvalResult {
  if (run.error) {
    return {
      taskId: spec.id,
      passed: false,
      mode: 'text_assert',
      detail: `Run failed with error: ${run.error}`,
    };
  }

  if (!spec.expected) {
    return {
      taskId: spec.id,
      passed: false,
      mode: 'text_assert',
      detail: 'No expected value defined for text_assert.',
    };
  }

  const finalLower = run.finalText.toLowerCase();
  const expectedLower = spec.expected.toLowerCase();
  const passed = finalLower.includes(expectedLower);

  return {
    taskId: spec.id,
    passed,
    mode: 'text_assert',
    detail: passed
      ? `Final text contains "${spec.expected}".`
      : `Final text "${run.finalText.slice(0, 200)}" does not contain "${spec.expected}".`,
    confidence: passed ? 1.0 : 0.0,
  };
}

export function evaluateManualReview(
  spec: TaskSpec,
  _run: RunResult
): EvalResult {
  return {
    taskId: spec.id,
    passed: false,
    mode: 'manual_review',
    detail: 'Manual review required. Check screenshots in artifact directory.',
  };
}

/**
 * LLM Judge evaluation — calls GPT-5.4 to assess whether the task was completed.
 * Uses pi-ai completeSimple for a one-shot judge call.
 */
export async function evaluateLlmJudge(
  spec: TaskSpec,
  run: RunResult,
  options?: { apiKey?: string; baseUrl?: string }
): Promise<EvalResult> {
  if (run.error) {
    return {
      taskId: spec.id,
      passed: false,
      mode: 'llm_judge',
      detail: `Run failed with error: ${run.error}`,
      confidence: 1.0,
    };
  }

  try {
    const { completeSimple, getModel } = await import('@mariozechner/pi-ai');
    const { getSharedAuthStorage } = await import('../claude/shared-auth');

    const apiKey =
      options?.apiKey ||
      process.env.GUI_CUA_API_KEY ||
      process.env.OPENAI_API_KEY ||
      '';

    if (apiKey) {
      const auth = getSharedAuthStorage();
      auth.setRuntimeApiKey('openai', apiKey);
    }

    let model = getModel('openai', 'gpt-5.4');
    if (!model) {
      // Fallback: build synthetic model
      const { buildSyntheticPiModel, inferPiApi } = await import(
        '../claude/pi-model-resolution'
      );
      const api = inferPiApi('openai');
      model = buildSyntheticPiModel(
        'gpt-5.4',
        'openai',
        'openai',
        options?.baseUrl || '',
        api
      );
    }

    const judgePrompt = `You are an evaluation judge for a GUI automation benchmark.

Task prompt: "${spec.prompt}"
Evaluation goal: "${spec.evaluationGoal || spec.expected || 'Task completed successfully'}"

The agent's final response was:
"${run.finalText}"

The agent made ${run.steps} tool calls in ${Math.round(run.durationMs / 1000)}s.
${run.error ? `Error occurred: ${run.error}` : 'No errors occurred.'}

Based on the evaluation goal, did the agent successfully complete the task?
Reply with exactly one of: PASS or FAIL
Then on a new line, give a brief explanation (1-2 sentences).`;

    const response = await completeSimple(
      model! as Parameters<typeof completeSimple>[0],
      {
        systemPrompt:
          'You are a strict evaluation judge. Reply PASS or FAIL followed by a brief explanation.',
        messages: [{ role: 'user', content: judgePrompt, timestamp: Date.now() }],
      },
      { apiKey: apiKey || undefined }
    );

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('')
      .trim();

    const passed = text.toUpperCase().startsWith('PASS');
    return {
      taskId: spec.id,
      passed,
      mode: 'llm_judge',
      detail: text,
      confidence: passed ? 0.8 : 0.8,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      taskId: spec.id,
      passed: false,
      mode: 'llm_judge',
      detail: `LLM judge failed: ${msg}. Falling back to manual review.`,
      confidence: 0,
    };
  }
}

export async function evaluate(
  spec: TaskSpec,
  run: RunResult,
  options?: { apiKey?: string; baseUrl?: string }
): Promise<EvalResult> {
  switch (spec.verificationMode) {
    case 'text_assert':
      return evaluateTextAssert(spec, run);
    case 'llm_judge':
      return evaluateLlmJudge(spec, run, options);
    case 'manual_review':
      return evaluateManualReview(spec, run);
  }
}
