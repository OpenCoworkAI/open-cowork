/**
 * MCP Tool Metrics — Fase 0 baseline instrumentation.
 *
 * WHY
 * The semantic computer-use layer (agent-desktop) is introduced as a
 * *complement* to the current visual GUI Operate layer. Before switching any
 * default, we need a measurable baseline of today's behaviour:
 *
 *   - how many vision calls a task costs (image-token driver),
 *   - how often a call succeeds on the first try vs. needs a transport retry,
 *   - how often an ACTION tool times out and gets retried (duplicate-action
 *     risk: the child process may have executed the action even though the
 *     response was lost),
 *   - latency distribution per tool (drives the stdio-vs-FFI decision).
 *
 * PRIVACY CONTRACT
 * This module NEVER records arguments, results, text, URLs, clipboard content,
 * screenshots or any other user data. It records only tool names, server
 * names, counters, durations and coarse error kinds.
 *
 * The module has no Electron dependency, so it stays unit-testable.
 */
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

import { resolveOpenCoworkLogsDirectory } from './mcp-log-paths.js';

/** Coarse tool buckets used by the rollout gate metrics. */
export type McpToolCategory = 'vision' | 'action' | 'observation' | 'other';

/** Coarse error classification (never contains user data). */
export type McpErrorKind =
  | 'timeout'
  | 'not_connected'
  | 'connection_closed'
  | 'structured_error'
  | 'unknown';

export type McpAttemptOutcome = 'ok' | 'error';

export interface McpToolAttemptInput {
  /** Identifier of the logical call (stable across transport retries). */
  callId: string;
  /** Original (unsanitized) tool name, e.g. `click` or `desktop_snapshot`. */
  tool: string;
  /** MCP server name the tool belongs to. */
  server: string;
  /** 1-based attempt index within the logical call. */
  attempt: number;
  /** Wall-clock duration of this attempt in milliseconds. */
  durationMs: number;
  outcome: McpAttemptOutcome;
  errorKind?: McpErrorKind;
}

export interface McpToolAggregate {
  tool: string;
  server: string;
  category: McpToolCategory;
  /** Number of logical calls (one per model-visible tool invocation). */
  logicalCalls: number;
  /** Total transport attempts, including retries. */
  transportAttempts: number;
  errors: number;
  timeouts: number;
  /** Action attempts whose delivery is unknown (timeout on an action tool). */
  uncertainActionAttempts: number;
  /** Transport retries issued after an uncertain action attempt. */
  retriesAfterUncertainAction: number;
  totalDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
}

export interface McpCategoryAggregate {
  logicalCalls: number;
  transportAttempts: number;
  errors: number;
  timeouts: number;
  uncertainActionAttempts: number;
  retriesAfterUncertainAction: number;
}

export interface McpMetricsSnapshot {
  startedAt: string;
  updatedAt: string;
  totals: McpCategoryAggregate & {
    logicalCalls: number;
    transportAttempts: number;
    errors: number;
    timeouts: number;
    uncertainActionAttempts: number;
    retriesAfterUncertainAction: number;
    byCategory: Record<McpToolCategory, McpCategoryAggregate>;
  };
  tools: McpToolAggregate[];
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Visual tools of the current GUI Operate server (image/token heavy). */
const VISION_TOOLS = new Set([
  'gui_locate_element',
  'gui_verify_vision',
  'gui_extract_info',
  'screenshot',
  'screenshot_for_display',
]);

/** Physical/irreversible tools of the current GUI Operate server. */
const GUI_ACTION_TOOLS = new Set(['click', 'type_text', 'key_press', 'scroll', 'drag']);

/**
 * agent-desktop leaf commands that mutate the system (mirrors the upstream
 * `Commands` enum in src/cli/mod.rs).
 */
const DESKTOP_ACTION_TOOLS = new Set([
  'desktop_click',
  'desktop_double_click',
  'desktop_triple_click',
  'desktop_right_click',
  'desktop_type',
  'desktop_set_value',
  'desktop_clear',
  'desktop_focus',
  'desktop_select',
  'desktop_toggle',
  'desktop_check',
  'desktop_uncheck',
  'desktop_expand',
  'desktop_collapse',
  'desktop_scroll',
  'desktop_scroll_to',
  'desktop_press',
  'desktop_key_down',
  'desktop_key_up',
  'desktop_hover',
  'desktop_drag',
  'desktop_mouse_move',
  'desktop_mouse_click',
  'desktop_mouse_down',
  'desktop_mouse_up',
  'desktop_mouse_wheel',
  'desktop_launch',
  'desktop_close_app',
  'desktop_focus_window',
  'desktop_resize_window',
  'desktop_move_window',
  'desktop_minimize',
  'desktop_maximize',
  'desktop_restore',
  'desktop_open_system_surface',
  'desktop_dismiss_notification',
  'desktop_dismiss_all_notifications',
  'desktop_notification_action',
  'desktop_clipboard_set',
  'desktop_clipboard_clear',
]);

/** agent-desktop leaf commands that only observe the system. */
const DESKTOP_OBSERVATION_TOOLS = new Set([
  'desktop_snapshot',
  'desktop_find',
  'desktop_screenshot',
  'desktop_get',
  'desktop_is',
  'desktop_list_windows',
  'desktop_list_displays',
  'desktop_list_apps',
  'desktop_list_surfaces',
  'desktop_list_notifications',
  'desktop_clipboard_get',
  'desktop_wait',
  'desktop_status',
  'desktop_permissions',
  'desktop_version',
  'desktop_skills_get',
  'desktop_session_start',
  'desktop_session_status',
  'desktop_session_end',
  'desktop_session_list',
  'desktop_cursor_overlay',
  'desktop_trace',
]);

/**
 * Classify a tool into a coarse bucket used by the rollout gate.
 * Unknown tools fall back to `other` (never guess a side-effecting bucket).
 */
export function classifyMcpTool(toolName: string): McpToolCategory {
  const name = toolName.toLowerCase();
  const shortName = name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) : name;

  if (VISION_TOOLS.has(shortName)) return 'vision';
  if (GUI_ACTION_TOOLS.has(shortName)) return 'action';
  if (DESKTOP_ACTION_TOOLS.has(shortName)) return 'action';
  if (DESKTOP_OBSERVATION_TOOLS.has(shortName)) return 'observation';
  if (shortName === 'wait') return 'observation';
  return 'other';
}

/** Classify an error message into a coarse, data-free error kind. */
export function classifyMcpErrorKind(message: string): McpErrorKind {
  const lower = message.toLowerCase();
  if (lower.includes('timeout')) return 'timeout';
  if (lower.includes('not connected')) return 'not_connected';
  if (lower.includes('connection closed')) return 'connection_closed';
  if (lower.includes('structured')) return 'structured_error';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Aggregation state
// ---------------------------------------------------------------------------

interface ToolState extends McpToolAggregate {
  /** Last attempt number seen for the current logical call of this tool. */
  lastAttempt: number;
  /** Whether the previous attempt ended in an uncertain action timeout. */
  previousAttemptUncertain: boolean;
}

const emptyCategoryAggregate = (): McpCategoryAggregate => ({
  logicalCalls: 0,
  transportAttempts: 0,
  errors: 0,
  timeouts: 0,
  uncertainActionAttempts: 0,
  retriesAfterUncertainAction: 0,
});

const toolStates = new Map<string, ToolState>();
const logicalCallIds = new Set<string>();
let startedAt = new Date().toISOString();
let updatedAt = startedAt;

/** Test-only helper: clears all aggregated state. */
export function resetMcpMetrics(): void {
  toolStates.clear();
  logicalCallIds.clear();
  startedAt = new Date().toISOString();
  updatedAt = startedAt;
}

/**
 * Record one transport attempt of an MCP tool call.
 *
 * Safe to call from hot paths: it only touches in-memory counters.
 */
export function recordMcpToolAttempt(input: McpToolAttemptInput): void {
  const category = classifyMcpTool(input.tool);
  const key = `${input.server}::${input.tool}`;
  const state = toolStates.get(key) ?? createToolState(input.tool, input.server, category);

  // A new logical call is detected when the attempt index restarts at 1.
  const isNewLogicalCall = input.attempt <= 1;
  if (isNewLogicalCall) {
    state.logicalCalls += 1;
    logicalCallIds.add(input.callId);
  }

  state.transportAttempts += 1;
  state.totalDurationMs += Math.max(0, input.durationMs);
  state.minDurationMs =
    state.transportAttempts === 1 ? input.durationMs : Math.min(state.minDurationMs, input.durationMs);
  state.maxDurationMs = Math.max(state.maxDurationMs, input.durationMs);

  const isTimeout = input.errorKind === 'timeout';
  const isUncertainAction = category === 'action' && isTimeout;

  if (input.outcome === 'error') {
    state.errors += 1;
    if (isTimeout) state.timeouts += 1;
    if (isUncertainAction) state.uncertainActionAttempts += 1;
  }

  // A retry issued right after an uncertain action attempt is the dangerous
  // case: the first attempt may already have executed the action.
  if (!isNewLogicalCall && state.previousAttemptUncertain) {
    state.retriesAfterUncertainAction += 1;
  }
  state.previousAttemptUncertain = isUncertainAction;
  state.lastAttempt = input.attempt;

  toolStates.set(key, state);
  updatedAt = new Date().toISOString();
}

function createToolState(tool: string, server: string, category: McpToolCategory): ToolState {
  return {
    tool,
    server,
    category,
    logicalCalls: 0,
    transportAttempts: 0,
    errors: 0,
    timeouts: 0,
    uncertainActionAttempts: 0,
    retriesAfterUncertainAction: 0,
    totalDurationMs: 0,
    minDurationMs: Number.POSITIVE_INFINITY,
    maxDurationMs: 0,
    lastAttempt: 0,
    previousAttemptUncertain: false,
  };
}

/**
 * Build a point-in-time snapshot of the aggregated metrics.
 * The returned object is plain JSON (no user data, no arguments).
 */
export function getMcpMetricsSnapshot(): McpMetricsSnapshot {
  const byCategory: Record<McpToolCategory, McpCategoryAggregate> = {
    vision: emptyCategoryAggregate(),
    action: emptyCategoryAggregate(),
    observation: emptyCategoryAggregate(),
    other: emptyCategoryAggregate(),
  };

  const totals = {
    logicalCalls: 0,
    transportAttempts: 0,
    errors: 0,
    timeouts: 0,
    uncertainActionAttempts: 0,
    retriesAfterUncertainAction: 0,
    byCategory,
  };

  const tools: McpToolAggregate[] = [];

  for (const state of toolStates.values()) {
    const aggregate: McpToolAggregate = {
      tool: state.tool,
      server: state.server,
      category: state.category,
      logicalCalls: state.logicalCalls,
      transportAttempts: state.transportAttempts,
      errors: state.errors,
      timeouts: state.timeouts,
      uncertainActionAttempts: state.uncertainActionAttempts,
      retriesAfterUncertainAction: state.retriesAfterUncertainAction,
      totalDurationMs: state.totalDurationMs,
      minDurationMs: Number.isFinite(state.minDurationMs) ? state.minDurationMs : 0,
      maxDurationMs: state.maxDurationMs,
    };
    tools.push(aggregate);

    const bucket = byCategory[state.category];
    bucket.logicalCalls += aggregate.logicalCalls;
    bucket.transportAttempts += aggregate.transportAttempts;
    bucket.errors += aggregate.errors;
    bucket.timeouts += aggregate.timeouts;
    bucket.uncertainActionAttempts += aggregate.uncertainActionAttempts;
    bucket.retriesAfterUncertainAction += aggregate.retriesAfterUncertainAction;

    totals.logicalCalls += aggregate.logicalCalls;
    totals.transportAttempts += aggregate.transportAttempts;
    totals.errors += aggregate.errors;
    totals.timeouts += aggregate.timeouts;
    totals.uncertainActionAttempts += aggregate.uncertainActionAttempts;
    totals.retriesAfterUncertainAction += aggregate.retriesAfterUncertainAction;
  }

  tools.sort((a, b) => b.transportAttempts - a.transportAttempts || a.tool.localeCompare(b.tool));

  return {
    startedAt,
    updatedAt,
    totals,
    tools,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Write the current snapshot as JSON into `directory`.
 * Returns the written file path, or null when the write failed.
 */
export async function flushMcpMetricsTo(directory: string): Promise<string | null> {
  try {
    await fs.mkdir(directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(directory, `mcp-metrics-${stamp}.json`);
    await fs.writeFile(filePath, JSON.stringify(getMcpMetricsSnapshot(), null, 2), 'utf8');
    return filePath;
  } catch {
    return null;
  }
}

/** Flush the snapshot into the standard Open Cowork logs directory. */
export async function flushMcpMetricsToDefaultDirectory(): Promise<string | null> {
  return flushMcpMetricsTo(resolveOpenCoworkLogsDirectory());
}

// ---------------------------------------------------------------------------
// Auto-flush
// ---------------------------------------------------------------------------

const AUTO_FLUSH_INTERVAL_MS = 5 * 60 * 1000;
let autoFlushTimer: ReturnType<typeof setInterval> | null = null;
let exitHandlerInstalled = false;

/**
 * Start the periodic metrics flush (idempotent).
 *
 * The timer is unref'd so it never keeps the process alive, and a synchronous
 * flush is attempted on process exit so the last window is not lost.
 */
export function ensureMcpMetricsAutoFlush(): void {
  if (autoFlushTimer) return;

  autoFlushTimer = setInterval(() => {
    void flushMcpMetricsToDefaultDirectory();
  }, AUTO_FLUSH_INTERVAL_MS);
  autoFlushTimer.unref?.();

  if (!exitHandlerInstalled) {
    exitHandlerInstalled = true;
    process.on('exit', () => {
      if (toolStates.size === 0) return;
      try {
        const directory = resolveOpenCoworkLogsDirectory();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fsSync.writeFileSync(
          path.join(directory, `mcp-metrics-${stamp}.json`),
          JSON.stringify(getMcpMetricsSnapshot(), null, 2),
          'utf8'
        );
      } catch {
        // Never let metrics persistence break process shutdown
      }
    });
  }
}

/** Test-only helper: stop the auto-flush timer. */
export function stopMcpMetricsAutoFlush(): void {
  if (autoFlushTimer) {
    clearInterval(autoFlushTimer);
    autoFlushTimer = null;
  }
}
