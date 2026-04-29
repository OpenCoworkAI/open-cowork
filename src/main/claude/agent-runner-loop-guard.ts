/**
 * Loop guard — detects runaway tool-call loops inside a single agent turn.
 *
 * Two-layer strategy:
 *
 *   Layer 1  Hash-based group detection
 *     - Hash the entire tool-call list of each assistant message (MD5 over stable keys).
 *     - Track hashes in a sliding window (default 20 entries).
 *     - 3 repeats  → warn  (inject a "please stop" steering message)
 *     - 5 repeats  → halt  (inject a hard "stop now, produce text" steering message)
 *     - 8 repeats  → abort (upstream gave up listening — kill the turn)
 *
 *   Layer 2  Per-tool frequency detection (no parameter comparison)
 *     - Tracks cumulative invocations of each tool type within the turn.
 *     - Catches cross-parameter loops such as repeatedly reading *different* files.
 *     - 30 invocations → warn
 *     - 50 invocations → halt
 *     - 80 invocations → abort
 *
 * Stable tool key generation (for hashing):
 *   - read_file            → `${tool}:${path}#bucket=${floor(startLine / 200)}`
 *                            (adjacent line ranges collapse into the same key)
 *   - write_file / str_replace / edit_file / create_file / search_replace
 *                          → `${tool}:${md5(fullArgs)}`
 *                            (any content change = distinct operation)
 *   - everything else      → `${tool}:${md5(extracted key fields)}`
 *                            where key fields = path/file_path/url/query/command/regex/pattern
 *
 * This module is **pure** — no electron, no logger, no network — so it is
 * trivially unit-testable. The host (agent-runner.ts) is responsible for
 * translating decisions into side effects (sendUserMessage steer, abort, etc.).
 */

import { createHash } from 'node:crypto';

/** Configuration knobs. All fields are required once normalised. */
export interface LoopGuardConfig {
  /** How many most-recent assistant-message hashes to retain. */
  messageHashWindow: number;
  /** Same hash appearing this many times → soft warning. */
  duplicateHashWarnThreshold: number;
  /** Same hash appearing this many times → hard halt steering. */
  duplicateHashHaltThreshold: number;
  /** Same hash appearing this many times → unilateral abort. */
  duplicateHashAbortThreshold: number;
  /** Same tool invoked this many times in the turn → soft warning. */
  toolFrequencyWarnThreshold: number;
  /** Same tool invoked this many times in the turn → hard halt steering. */
  toolFrequencyHaltThreshold: number;
  /** Same tool invoked this many times in the turn → unilateral abort. */
  toolFrequencyAbortThreshold: number;
  /** Line-number bucket width used to collapse adjacent read_file ranges. */
  readFileLineBucketSize: number;
}

export const DEFAULT_LOOP_GUARD_CONFIG: LoopGuardConfig = {
  messageHashWindow: 20,
  duplicateHashWarnThreshold: 3,
  duplicateHashHaltThreshold: 5,
  duplicateHashAbortThreshold: 8,
  toolFrequencyWarnThreshold: 30,
  toolFrequencyHaltThreshold: 50,
  toolFrequencyAbortThreshold: 80,
  readFileLineBucketSize: 200,
};

export interface ToolCallDescriptor {
  name: string;
  input: Record<string, unknown> | undefined;
}

export type LoopGuardAction =
  | 'none'
  | 'hash_warn'
  | 'hash_halt'
  | 'hash_abort'
  | 'freq_warn'
  | 'freq_halt'
  | 'freq_abort';

export interface LoopGuardDecision {
  action: LoopGuardAction;
  reason: string;
  count?: number;
  toolName?: string;
  hash?: string;
  window?: number;
}

const NOOP_DECISION: LoopGuardDecision = { action: 'none', reason: 'ok' };

// ─── Pure helpers ───────────────────────────────────────────────────────────

/** Deterministic JSON — sorted keys, recursive. */
function normaliseForHash(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normaliseForHash);
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src).sort()) out[k] = normaliseForHash(src[k]);
  return out;
}

function md5(value: unknown): string {
  return createHash('md5')
    .update(JSON.stringify(normaliseForHash(value)))
    .digest('hex');
}

const READ_FILE_PATTERN = /\bread[-_]?file\b/i;
const WRITE_LIKE_PATTERN =
  /\b(write[-_]?file|str[-_]?replace|edit[-_]?file|create[-_]?file|search[-_]?replace|apply[-_]?patch|append[-_]?file)\b/i;

const KEY_FIELDS = [
  'path',
  'file_path',
  'filePath',
  'file',
  'url',
  'query',
  'q',
  'command',
  'cmd',
  'regex',
  'pattern',
  'keyword',
  'keywords',
] as const;

/** Build a stable key that represents "the same logical call". */
export function stableToolKey(
  toolName: string,
  input: Record<string, unknown> | undefined,
  config: Pick<LoopGuardConfig, 'readFileLineBucketSize'> = {
    readFileLineBucketSize: DEFAULT_LOOP_GUARD_CONFIG.readFileLineBucketSize,
  }
): string {
  const name = toolName || 'unknown';
  if (!input || typeof input !== 'object') return `${name}:∅`;

  // read_file — bucket by line range so "read lines 1-100" and "read lines 50-150"
  // of the same file count as the same logical operation.
  if (READ_FILE_PATTERN.test(name) || name === 'read') {
    const path = pickString(input, ['file_path', 'filePath', 'path', 'file']) ?? '';
    const rawStart = pickNumber(input, ['start_line', 'startLine', 'offset', 'line']);
    const start = rawStart ?? 0;
    const bucket = Math.floor(start / Math.max(1, config.readFileLineBucketSize));
    return `${name}:${path}#bucket=${bucket}`;
  }

  // Destructive writes — any content change is a distinct op.
  if (WRITE_LIKE_PATTERN.test(name)) {
    return `${name}:${md5(input)}`;
  }

  // Generic tools — hash the subset of key fields when available, otherwise full input.
  const extracted: Record<string, unknown> = {};
  for (const k of KEY_FIELDS) {
    if (k in input) extracted[k] = (input as Record<string, unknown>)[k];
  }
  const target = Object.keys(extracted).length > 0 ? extracted : input;
  return `${name}:${md5(target)}`;
}

function pickString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function pickNumber(input: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  }
  return undefined;
}

/** Hash the ordered list of stable keys for one assistant message. */
export function messageCallsHash(
  toolCalls: ToolCallDescriptor[],
  config: Pick<LoopGuardConfig, 'readFileLineBucketSize'> = {
    readFileLineBucketSize: DEFAULT_LOOP_GUARD_CONFIG.readFileLineBucketSize,
  }
): string {
  if (!toolCalls || toolCalls.length === 0) return '';
  const keys = toolCalls.map((tc) => stableToolKey(tc.name, tc.input, config));
  return md5(keys);
}

// ─── LoopGuard class ────────────────────────────────────────────────────────

export class LoopGuard {
  private readonly config: LoopGuardConfig;
  private readonly hashWindow: string[] = [];
  private readonly hashCounts = new Map<string, number>();
  private readonly hashWarnIssued = new Set<string>();
  private readonly hashHaltIssued = new Set<string>();
  private readonly hashAbortIssued = new Set<string>();
  private readonly toolFrequency = new Map<string, number>();
  private readonly toolWarnIssued = new Set<string>();
  private readonly toolHaltIssued = new Set<string>();
  private readonly toolAbortIssued = new Set<string>();

  constructor(config: Partial<LoopGuardConfig> = {}) {
    this.config = { ...DEFAULT_LOOP_GUARD_CONFIG, ...config };
  }

  /**
   * Record a complete assistant message's tool-call list and decide whether
   * to intervene. Call once per `message_end` that contains tool_use blocks.
   */
  recordAssistantMessage(toolCalls: ToolCallDescriptor[]): LoopGuardDecision {
    if (!toolCalls || toolCalls.length === 0) return NOOP_DECISION;

    const hash = messageCallsHash(toolCalls, this.config);
    this.pushHash(hash);
    const count = this.hashCounts.get(hash) ?? 0;

    if (count >= this.config.duplicateHashAbortThreshold && !this.hashAbortIssued.has(hash)) {
      this.hashAbortIssued.add(hash);
      return this.mkDecision('hash_abort', `identical tool-call group repeated ${count} times`, {
        count,
        hash,
        window: this.config.messageHashWindow,
      });
    }
    if (count >= this.config.duplicateHashHaltThreshold && !this.hashHaltIssued.has(hash)) {
      this.hashHaltIssued.add(hash);
      return this.mkDecision('hash_halt', `identical tool-call group repeated ${count} times`, {
        count,
        hash,
        window: this.config.messageHashWindow,
      });
    }
    if (count >= this.config.duplicateHashWarnThreshold && !this.hashWarnIssued.has(hash)) {
      this.hashWarnIssued.add(hash);
      return this.mkDecision('hash_warn', `identical tool-call group repeated ${count} times`, {
        count,
        hash,
        window: this.config.messageHashWindow,
      });
    }
    return NOOP_DECISION;
  }

  /**
   * Record a single tool invocation start and decide whether the per-tool
   * frequency limit is tripped. Call once per `tool_execution_start`.
   */
  recordToolInvocation(toolName: string): LoopGuardDecision {
    const name = toolName || 'unknown';
    const count = (this.toolFrequency.get(name) ?? 0) + 1;
    this.toolFrequency.set(name, count);

    if (count >= this.config.toolFrequencyAbortThreshold && !this.toolAbortIssued.has(name)) {
      this.toolAbortIssued.add(name);
      return this.mkDecision('freq_abort', `tool "${name}" invoked ${count} times in this turn`, {
        count,
        toolName: name,
      });
    }
    if (count >= this.config.toolFrequencyHaltThreshold && !this.toolHaltIssued.has(name)) {
      this.toolHaltIssued.add(name);
      return this.mkDecision('freq_halt', `tool "${name}" invoked ${count} times in this turn`, {
        count,
        toolName: name,
      });
    }
    if (count >= this.config.toolFrequencyWarnThreshold && !this.toolWarnIssued.has(name)) {
      this.toolWarnIssued.add(name);
      return this.mkDecision('freq_warn', `tool "${name}" invoked ${count} times in this turn`, {
        count,
        toolName: name,
      });
    }
    return NOOP_DECISION;
  }

  /** Expose raw counters for diagnostics / testing. */
  snapshot(): {
    hashCounts: Record<string, number>;
    toolFrequency: Record<string, number>;
    window: string[];
  } {
    return {
      hashCounts: Object.fromEntries(this.hashCounts),
      toolFrequency: Object.fromEntries(this.toolFrequency),
      window: [...this.hashWindow],
    };
  }

  private pushHash(hash: string): void {
    this.hashWindow.push(hash);
    this.hashCounts.set(hash, (this.hashCounts.get(hash) ?? 0) + 1);
    while (this.hashWindow.length > this.config.messageHashWindow) {
      const removed = this.hashWindow.shift();
      if (removed == null) break;
      const prev = this.hashCounts.get(removed) ?? 0;
      if (prev <= 1) {
        this.hashCounts.delete(removed);
        // once it fully leaves the window, allow fresh warn/halt cycles for it again
        this.hashWarnIssued.delete(removed);
        this.hashHaltIssued.delete(removed);
      } else {
        this.hashCounts.set(removed, prev - 1);
      }
    }
  }

  private mkDecision(
    action: LoopGuardAction,
    reason: string,
    details: Partial<Pick<LoopGuardDecision, 'count' | 'toolName' | 'hash' | 'window'>>
  ): LoopGuardDecision {
    return { action, reason, ...details };
  }
}

// ─── Human-facing message builders ──────────────────────────────────────────

export const LOOP_GUARD_GUIDANCE =
  '\n\n**Suggestions:**\n' +
  '- Enable "Thinking" mode in settings and retry, especially for models like gemini-3.1-pro that tend to fall into empty loops when thinking is disabled\n' +
  '- Switch to a model with built-in reasoning capabilities (e.g., claude-sonnet-4-6)\n' +
  '- Break complex tasks into smaller subtasks and send them separately';

/** Steering message injected to the model when warn threshold is crossed. */
export function buildWarnSteerMessage(decision: LoopGuardDecision): string {
  if (decision.action === 'hash_warn') {
    return (
      `[Loop Guard · Warning] You have executed the same group of tool calls ${decision.count} times in a row.\n` +
      'Please stop the repetitive calls. Based on the information you have already collected, try to provide an interim text conclusion, or change your strategy (use different tools / adjust parameters / break into subtasks).'
    );
  }
  if (decision.action === 'freq_warn') {
    return (
      `[Loop Guard · Warning] The tool "${decision.toolName}" has been invoked ${decision.count} times in this turn.\n` +
      'Please assess whether the information you have is sufficient to answer. If so, output a text conclusion directly; if not, use a different tool or more precise parameters.'
    );
  }
  return '[Loop Guard · Warning]';
}

/** Steering message injected when halt threshold is crossed (stronger). */
export function buildHaltSteerMessage(decision: LoopGuardDecision): string {
  if (decision.action === 'hash_halt') {
    return (
      `[Loop Guard · STOP] Identical tool-call group has now repeated ${decision.count} times — this is a loop.\n` +
      '**STOP all tool calls immediately. You must output the final conclusion in plain text based on the information you have already collected. Do not make any further tool calls.**'
    );
  }
  if (decision.action === 'freq_halt') {
    return (
      `[Loop Guard · STOP] The tool "${decision.toolName}" has been invoked ${decision.count} times — this is a loop.\n` +
      '**STOP all tool calls immediately. You must output the final conclusion in plain text based on the information you have already collected. Do not make any further tool calls.**'
    );
  }
  return '[Loop Guard · STOP]';
}

/** Final message sent to the user when we unilaterally abort. */
export function buildAbortUserMessage(decision: LoopGuardDecision): string {
  if (decision.action === 'hash_abort') {
    return (
      `**Loop Guard: The model continued to repeat the same group of tool calls ${decision.count} times even after receiving stop instructions. Session forcibly terminated.**` +
      LOOP_GUARD_GUIDANCE
    );
  }
  if (decision.action === 'freq_abort') {
    return (
      `**Loop Guard: Tool "${decision.toolName}" has been invoked ${decision.count} times in this turn, far exceeding reasonable limits. Session forcibly terminated.**` +
      LOOP_GUARD_GUIDANCE
    );
  }
  return (
    '**Loop Guard: Tool-call loop detected. Session forcibly terminated.**' + LOOP_GUARD_GUIDANCE
  );
}
