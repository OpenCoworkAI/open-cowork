/**
 * TinyBench — lightweight GUI automation benchmark types.
 */

export type VerificationMode = 'text_assert' | 'llm_judge' | 'manual_review' | 'filesystem_check';

export interface TaskSpec {
  id: string;
  prompt: string;
  model: string;
  setupCommand?: string;
  teardownCommand?: string;
  maxTurns: number;
  timeoutMs: number;
  verificationMode: VerificationMode;
  expected?: string;
  expectedPath?: string;
  evaluationGoal?: string;
  allowedApps?: string[];
  outputDir: string;
}

export interface RunResult {
  taskId: string;
  passed: boolean;
  steps: number;
  durationMs: number;
  tokens: { input: number; output: number; total: number };
  finalText: string;
  toolCalls: ToolCallRecord[];
  error?: string;
  artifactDir: string;
}

export interface ToolCallRecord {
  index: number;
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
  isError: boolean;
}

export interface EvalResult {
  taskId: string;
  passed: boolean;
  mode: VerificationMode;
  detail: string;
  confidence?: number;
}

export interface TaskReport {
  taskId: string;
  run: RunResult;
  evaluation: EvalResult;
}

export interface SuiteReport {
  suiteId: string;
  model: string;
  timestamp: string;
  tasks: TaskReport[];
  summary: {
    total: number;
    passed: number;
    passRate: number;
    avgSteps: number;
    avgDurationMs: number;
    totalTokens: number;
  };
  outputPath: string;
}

export interface BenchCliOptions {
  taskId?: string;
  suite?: string;
  model: string;
  repeats: number;
  outDir?: string;
  dryRun: boolean;
  apiKey?: string;
  baseUrl?: string;
}
