/**
 * TinyBench task definitions.
 *
 * Each task is a self-contained GUI automation scenario with setup/teardown
 * commands and a verification strategy.
 */
import path from 'node:path';
import type { BenchCliOptions, TaskSpec, VerificationMode } from './types';

const DEFAULT_MODEL = 'gpt-5.4';
const DEFAULT_MAX_TURNS = 15;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

interface TaskTemplate {
  id: string;
  prompt: string;
  setupCommand?: string;
  teardownCommand?: string;
  maxTurns?: number;
  timeoutMs?: number;
  verificationMode: VerificationMode;
  expected?: string;
  evaluationGoal?: string;
}

const TASKS: Record<string, TaskTemplate> = {
  'calc-add-2-3': {
    id: 'calc-add-2-3',
    prompt:
      'Open the Calculator app, compute 2 + 3, and tell me the result when you see it on screen.',
    setupCommand: 'open -a Calculator',
    teardownCommand: 'osascript -e \'tell application "Calculator" to quit\'',
    verificationMode: 'text_assert',
    expected: '5',
    evaluationGoal: 'Calculator displays 5.',
  },
  'calc-chain-12-34': {
    id: 'calc-chain-12-34',
    prompt:
      'Use Calculator to compute 12 + 34, then tell me the result when the UI shows it.',
    setupCommand: 'open -a Calculator',
    teardownCommand: 'osascript -e \'tell application "Calculator" to quit\'',
    verificationMode: 'text_assert',
    expected: '46',
    evaluationGoal: 'Calculator displays 46.',
  },
  'textedit-hello': {
    id: 'textedit-hello',
    prompt:
      'Open TextEdit, create a new blank document, type "hello from tinybench", then say "done".',
    setupCommand: 'open -a TextEdit',
    teardownCommand: 'osascript -e \'tell application "TextEdit" to quit saving no\'',
    verificationMode: 'llm_judge',
    evaluationGoal:
      'A TextEdit document should contain the text "hello from tinybench".',
  },
};

const SUITES: Record<string, string[]> = {
  smoke: ['calc-add-2-3'],
  basic: ['calc-add-2-3', 'calc-chain-12-34'],
  full: ['calc-add-2-3', 'calc-chain-12-34', 'textedit-hello'],
};

export function listTasks(): string[] {
  return Object.keys(TASKS).sort();
}

export function listSuites(): string[] {
  return Object.keys(SUITES).sort();
}

export function resolveSuiteTaskIds(suiteId: string): string[] {
  const suite = SUITES[suiteId];
  if (!suite) {
    throw new Error(
      `Unknown suite "${suiteId}". Available: ${listSuites().join(', ')}`
    );
  }
  return [...suite];
}

export function resolveTask(options: BenchCliOptions, taskId: string): TaskSpec {
  const template = TASKS[taskId];
  if (!template) {
    throw new Error(
      `Unknown task "${taskId}". Available: ${listTasks().join(', ')}`
    );
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rootOutDir = options.outDir
    ? path.resolve(options.outDir)
    : path.join(process.cwd(), '.tmp', 'tinybench');

  return {
    ...template,
    model: options.model || DEFAULT_MODEL,
    maxTurns: template.maxTurns ?? DEFAULT_MAX_TURNS,
    timeoutMs: template.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    outputDir: path.join(rootOutDir, taskId, timestamp),
  };
}
