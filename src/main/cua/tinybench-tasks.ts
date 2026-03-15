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

// Common setup: quit→reopen→clear→hide other windows→focus
const CALC_SETUP = [
  'osascript -e \'tell application "Calculator" to quit\' 2>/dev/null',
  'sleep 0.5',
  'open -a Calculator',
  'sleep 1',
  // Clear display: Escape key clears Calculator (Cmd+C is Copy, not Clear!)
  'osascript -e \'tell application "Calculator" to activate\'',
  'osascript -e \'tell application "System Events" to key code 53\'',  // Escape = key code 53
  'sleep 0.2',
  // Hide other windows so Calculator is fully visible and focused
  'osascript -e \'tell application "System Events" to set visible of every process whose name is not "Calculator" and name is not "Finder" and name is not "Dock" to false\' 2>/dev/null',
  'sleep 0.3',
  'osascript -e \'tell application "Calculator" to activate\'',
].join('; ');

interface TaskTemplate {
  id: string;
  prompt: string;
  setupCommand?: string;
  teardownCommand?: string;
  maxTurns?: number;
  timeoutMs?: number;
  verificationMode: VerificationMode;
  expected?: string;
  expectedPath?: string;
  evaluationGoal?: string;
  allowedApps?: string[];
}

const TASKS: Record<string, TaskTemplate> = {
  'calc-add-2-3': {
    id: 'calc-add-2-3',
    prompt:
      'The Calculator app is already open and in focus. Compute 2 + 3 by pressing the digit and operator keys, then tell me the result shown on screen.',
    setupCommand: CALC_SETUP,
    teardownCommand: 'osascript -e \'tell application "Calculator" to quit\'',
    verificationMode: 'llm_judge',
    expected: '5',
    evaluationGoal: 'Calculator displays 5 as the result of 2+3.',
    allowedApps: ['Calculator'],
  },
  'calc-chain-12-34': {
    id: 'calc-chain-12-34',
    prompt:
      'The Calculator app is already open and in focus. Compute 12 + 34 by pressing the digit and operator keys, then tell me the result shown on screen.',
    setupCommand: CALC_SETUP,
    teardownCommand: 'osascript -e \'tell application "Calculator" to quit\'',
    verificationMode: 'llm_judge',
    expected: '46',
    evaluationGoal: 'Calculator displays 46 as the result of 12+34.',
    allowedApps: ['Calculator'],
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
    allowedApps: ['TextEdit'],
  },
  'finder-new-folder': {
    id: 'finder-new-folder',
    prompt:
      'Open Finder at /tmp, create a new folder named "tinybench-test-folder" using the Finder GUI (File > New Folder or Shift+Cmd+N), then say "done".',
    setupCommand: 'rm -rf /tmp/tinybench-test-folder && open -a Finder /tmp',
    teardownCommand: 'rm -rf /tmp/tinybench-test-folder',
    verificationMode: 'filesystem_check',
    expectedPath: '/tmp/tinybench-test-folder',
    evaluationGoal: 'A folder /tmp/tinybench-test-folder should exist.',
    allowedApps: ['Finder'],
  },

  // ---------- Medium difficulty ----------

  'calc-multi-step': {
    id: 'calc-multi-step',
    prompt:
      'The Calculator app is already open and in focus. Compute (7 * 8) + 15. First calculate 7 * 8, then add 15. Tell me the final result.',
    setupCommand: CALC_SETUP,
    teardownCommand: 'osascript -e \'tell application "Calculator" to quit\'',
    verificationMode: 'llm_judge',
    expected: '71',
    evaluationGoal: 'Calculator displays 71 as the result of (7*8)+15.',
    allowedApps: ['Calculator'],
  },

  'textedit-format': {
    id: 'textedit-format',
    prompt:
      'Open TextEdit, type "TinyBench Test Report" on the first line, press Enter, then type "All tests passed." on the second line. Say "done" when finished.',
    setupCommand:
      'osascript -e \'tell application "TextEdit" to quit saving no\' 2>/dev/null; sleep 0.5; open -a TextEdit',
    teardownCommand: 'osascript -e \'tell application "TextEdit" to quit saving no\'',
    verificationMode: 'llm_judge',
    evaluationGoal:
      'TextEdit shows two lines: first line "TinyBench Test Report", second line "All tests passed."',
    allowedApps: ['TextEdit'],
  },

  'textedit-save-tmp': {
    id: 'textedit-save-tmp',
    prompt:
      'Open TextEdit, type "benchmark output", then save the file to /tmp/tinybench-output.txt using Cmd+S. Navigate to /tmp in the save dialog and name the file "tinybench-output.txt". Make sure to save as plain text (.txt). Say "done" when saved.',
    setupCommand:
      'rm -f /tmp/tinybench-output.txt; osascript -e \'tell application "TextEdit" to quit saving no\' 2>/dev/null; sleep 0.5; open -a TextEdit',
    teardownCommand:
      'rm -f /tmp/tinybench-output.txt; osascript -e \'tell application "TextEdit" to quit saving no\'',
    verificationMode: 'filesystem_check',
    expectedPath: '/tmp/tinybench-output.txt',
    evaluationGoal: 'A file /tmp/tinybench-output.txt exists with content "benchmark output".',
    allowedApps: ['TextEdit'],
    timeoutMs: 3 * 60_000,
  },

  'finder-rename-folder': {
    id: 'finder-rename-folder',
    prompt:
      'In Finder, go to /tmp. Create a new folder (Shift+Cmd+N), name it "tinybench-original", then rename it to "tinybench-renamed" by selecting it and pressing Enter to edit the name. Say "done" when finished.',
    setupCommand:
      'rm -rf /tmp/tinybench-original /tmp/tinybench-renamed && open -a Finder /tmp',
    teardownCommand: 'rm -rf /tmp/tinybench-original /tmp/tinybench-renamed',
    verificationMode: 'filesystem_check',
    expectedPath: '/tmp/tinybench-renamed',
    evaluationGoal: 'A folder /tmp/tinybench-renamed should exist.',
    allowedApps: ['Finder'],
    timeoutMs: 3 * 60_000,
  },

  // ---------- Hard difficulty ----------

  'notes-create': {
    id: 'notes-create',
    prompt:
      'Open the Notes app, create a new note (Cmd+N), type "TinyBench Automated Test" as the title (first line), press Enter, then type "This note was created by a GUI automation agent." on the second line. Say "done" when finished.',
    setupCommand: 'open -a Notes',
    teardownCommand:
      'osascript -e \'tell application "Notes" to quit\'',
    verificationMode: 'llm_judge',
    evaluationGoal:
      'Notes app shows a note with title "TinyBench Automated Test" and body text "This note was created by a GUI automation agent."',
    allowedApps: ['Notes'],
    timeoutMs: 3 * 60_000,
  },

  'calc-scientific': {
    id: 'calc-scientific',
    prompt:
      'The Calculator app is already open and in focus. Switch to Scientific mode (View > Scientific or Cmd+2), then compute the square root of 144. Tell me the result.',
    setupCommand: CALC_SETUP,
    teardownCommand: 'osascript -e \'tell application "Calculator" to quit\'',
    verificationMode: 'llm_judge',
    expected: '12',
    evaluationGoal: 'Calculator in Scientific mode displays 12 as the square root of 144.',
    allowedApps: ['Calculator'],
    timeoutMs: 3 * 60_000,
  },
};

const SUITES: Record<string, string[]> = {
  smoke: ['calc-add-2-3'],
  basic: ['calc-add-2-3', 'calc-chain-12-34'],
  medium: ['calc-add-2-3', 'calc-chain-12-34', 'calc-multi-step', 'textedit-hello', 'textedit-format'],
  full: [
    'calc-add-2-3', 'calc-chain-12-34', 'calc-multi-step',
    'textedit-hello', 'textedit-format', 'textedit-save-tmp',
    'finder-new-folder', 'finder-rename-folder',
    'notes-create', 'calc-scientific',
  ],
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
