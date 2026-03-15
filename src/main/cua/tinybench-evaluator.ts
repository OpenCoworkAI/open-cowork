/**
 * TinyBench Evaluator — determines pass/fail for completed runs.
 *
 * Supports four modes:
 * - text_assert: check if model's final text contains expected substring (base64 filtered)
 * - llm_judge: multimodal GPT-5.4 vision judge with anti-hallucination rules
 * - filesystem_check: verify a file/folder exists at expected path
 * - manual_review: always returns "needs review"
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import OpenAI from 'openai';
import type { EvalResult, RunResult, TaskSpec } from './types';

// Max base64 length for judge screenshot (~1MB decoded)
const MAX_SCREENSHOT_BASE64_LEN = 1_400_000;

/**
 * Strip base64 data URLs from text to prevent false substring matches.
 * Matches patterns like `![...](data:image/...;base64,...)` and raw `data:...;base64,...` strings.
 */
function stripBase64DataUrls(text: string): string {
  // Remove markdown image links with data URLs
  let cleaned = text.replace(/!\[[^\]]*\]\(data:[^)]+\)/g, '[screenshot]');
  // Remove raw data URLs (base64 encoded, minimum 100 chars to avoid false positives)
  cleaned = cleaned.replace(/data:[a-zA-Z]+\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]{100,}/g, '[base64-data]');
  return cleaned;
}

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

  // Filter out base64 data URLs before matching to prevent false positives
  const cleanedText = stripBase64DataUrls(run.finalText);
  const finalLower = cleanedText.toLowerCase();
  const expectedLower = spec.expected.toLowerCase();
  const passed = finalLower.includes(expectedLower);

  return {
    taskId: spec.id,
    passed,
    mode: 'text_assert',
    detail: passed
      ? `Final text contains "${spec.expected}".`
      : `Final text (cleaned) does not contain "${spec.expected}".`,
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

const MUTATING_TOOL_NAMES = new Set([
  'click', 'type_text', 'key_press', 'scroll', 'drag', 'move_mouse',
]);

/**
 * LLM Judge evaluation — multimodal GPT-5.4 vision assessment.
 *
 * Sends:
 * - Tool call audit trail (what the agent actually did)
 * - Agent's final text response (truncated, base64 stripped)
 * - Final screenshot as an image (if available)
 *
 * Anti-hallucination: explicitly tells the judge that 0 mutating actions = FAIL.
 */
export async function evaluateLlmJudge(
  spec: TaskSpec,
  run: RunResult,
  options?: { apiKey?: string; baseUrl?: string; _openaiClient?: OpenAI }
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
    // 1. Build tool call summary for the judge
    const toolSummary = run.toolCalls.map(
      (tc, i) => `${i + 1}. ${tc.toolName}(${JSON.stringify(tc.args)})`
    ).join('\n') || '(no tool calls executed)';

    const mutatingCount = run.toolCalls.filter(
      (tc) => MUTATING_TOOL_NAMES.has(tc.toolName)
    ).length;

    // 2. System prompt with anti-hallucination rules
    const systemPrompt = `You are a strict evaluation judge for a GUI automation benchmark.
You will be given:
- The task the agent was asked to perform
- The expected result
- A summary of all tool calls the agent made
- The agent's final text response
- A screenshot of the final screen state (if available)

Your job is to determine if the agent ACTUALLY completed the task.

IMPORTANT anti-hallucination rules:
- If the agent made 0 mutating actions (click, key_press, type_text, scroll), it did NOT complete the task — the screen may show a leftover result from a previous run
- Verify the screenshot visually matches the expected result
- Cross-check the agent's text claims against the visual evidence
- Do NOT trust the agent's text alone — always verify against the screenshot

Reply format (exactly):
Line 1: PASS or FAIL
Line 2: A confidence score between 0.0 and 1.0
Line 3+: Brief explanation (2-3 sentences)`;

    // 3. Build multimodal input (OpenAI Responses API format)
    const input: Array<Record<string, unknown>> = [];

    // Developer (system) instruction
    input.push({ role: 'developer', content: systemPrompt });

    // User message with text + optional image
    const userContent: Array<Record<string, unknown>> = [];

    const cleanedFinalText = stripBase64DataUrls(run.finalText);
    userContent.push({
      type: 'input_text',
      text: `Task: "${spec.prompt}"
Expected result: "${spec.evaluationGoal || spec.expected || 'Task completed'}"

Tool calls executed (${run.toolCalls.length} total, ${mutatingCount} mutating, ${Math.round(run.durationMs / 1000)}s):
${toolSummary}

Agent's final text response:
"${cleanedFinalText.slice(0, 500)}"

${run.error ? `Error: ${run.error}` : 'No errors.'}

Did the agent successfully complete this task? Check the screenshot below (if available).`,
    });

    // Attach final screenshot as image if available (compress if too large)
    if (run.lastScreenshotBase64) {
      let screenshotB64 = run.lastScreenshotBase64;
      let mimeType = 'image/png';

      // If screenshot is too large, convert PNG→JPEG via macOS sips
      if (screenshotB64.length > MAX_SCREENSHOT_BASE64_LEN) {
        try {
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinybench-judge-'));
          const pngPath = path.join(tmpDir, 'screen.png');
          const jpegPath = path.join(tmpDir, 'screen.jpg');
          fs.writeFileSync(pngPath, Buffer.from(screenshotB64, 'base64'));

          // Resize to max 1024px wide + convert to JPEG
          if (os.platform() === 'darwin') {
            execFileSync('sips', [
              '-Z', '1024',
              '-s', 'format', 'jpeg',
              '-s', 'formatOptions', '60',
              pngPath,
              '--out', jpegPath,
            ], { timeout: 10_000 });
          } else {
            // Windows/Linux fallback: just use PNG as-is (or add platform support later)
            fs.copyFileSync(pngPath, jpegPath);
          }

          screenshotB64 = fs.readFileSync(jpegPath).toString('base64');
          mimeType = 'image/jpeg';

          // Cleanup
          try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* best effort */ }
        } catch (compressErr) {
          // If compression fails, skip the screenshot rather than fail the evaluation
          console.warn('[TinyBench Judge] Screenshot compression failed:', compressErr);
          screenshotB64 = '';
        }
      }

      if (screenshotB64) {
        userContent.push({
          type: 'input_image',
          image_url: `data:${mimeType};base64,${screenshotB64}`,
        });
      }
    }

    input.push({ role: 'user', content: userContent });

    // 4. Call GPT-5.4 via OpenAI SDK (Responses API)
    const openai = options?._openaiClient ?? new OpenAI({
      apiKey: options?.apiKey || process.env.GUI_CUA_API_KEY || process.env.OPENAI_API_KEY || '',
      baseURL: options?.baseUrl || process.env.GUI_CUA_BASE_URL || process.env.OPENAI_BASE_URL,
    });

    const response = await openai.responses.create({
      model: 'gpt-5.4',
      input: input as never,
      max_output_tokens: 256,
    });

    // 5. Parse PASS/FAIL + confidence from response
    const text = response.output
      .filter((b: { type: string }) => b.type === 'message')
      .flatMap((b: { type: string; content?: Array<{ type: string; text?: string }> }) =>
        b.content ?? [],
      )
      .filter((c: { type: string }) => c.type === 'output_text')
      .map((c: { type: string; text?: string }) => c.text ?? '')
      .join('').trim();

    const lines = text.split('\n').map((l) => l.trim());
    const passed = lines[0]?.toUpperCase().startsWith('PASS') ?? false;
    const confidence = parseFloat(lines[1] || '') || (passed ? 0.8 : 0.2);
    const explanation = lines.slice(2).join(' ').trim() || text;

    return { taskId: spec.id, passed, mode: 'llm_judge', detail: explanation, confidence };
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

export function evaluateFilesystemCheck(
  spec: TaskSpec,
  run: RunResult
): EvalResult {
  if (run.error) {
    return {
      taskId: spec.id,
      passed: false,
      mode: 'filesystem_check',
      detail: `Run failed with error: ${run.error}`,
    };
  }

  if (!spec.expectedPath) {
    return {
      taskId: spec.id,
      passed: false,
      mode: 'filesystem_check',
      detail: 'No expectedPath defined for filesystem_check.',
    };
  }

  // Expand ~ and $HOME
  const expandedPath = spec.expectedPath
    .replace(/^~/, os.homedir())
    .replace(/\$HOME/g, os.homedir());

  try {
    const exists = fs.existsSync(expandedPath);
    return {
      taskId: spec.id,
      passed: exists,
      mode: 'filesystem_check',
      detail: exists
        ? `Path "${expandedPath}" exists.`
        : `Path "${expandedPath}" does not exist.`,
      confidence: 1.0,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      taskId: spec.id,
      passed: false,
      mode: 'filesystem_check',
      detail: `Filesystem check error: ${msg}`,
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
    case 'filesystem_check':
      return evaluateFilesystemCheck(spec, run);
    case 'manual_review':
      return evaluateManualReview(spec, run);
    default: {
      const _exhaustive: never = spec.verificationMode;
      throw new Error(`Unknown verification mode: ${_exhaustive}`);
    }
  }
}
