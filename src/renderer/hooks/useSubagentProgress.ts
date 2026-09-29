import { useCallback, useEffect, useState } from 'react';
import type { SubagentRun } from '../types';

// Maximum wall-clock time a subagent may legitimately stay 'running' before we
// render it as failed (timeout fallback). Matches the backend's hard cap of
// MAX_TIMEOUT_MS (300s) plus a buffer, so the card never spins forever even if
// a terminal event is lost.
export const MAX_SUBAGENT_RUNNING_MS = 330_000;

export type SubagentEvent =
  | 'started'
  | 'tool_start'
  | 'tool_end'
  | 'text_delta'
  | 'completed'
  | 'failed';

export interface SubagentToolActivity {
  toolName: string;
  startedAt: number;
  durationMs?: number;
  isError?: boolean;
}

export interface SubagentState {
  subagentId: string;
  parentSessionId: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  tools: SubagentToolActivity[];
  activeToolName: string | null;
  accumulatedText: string;
  error?: string;
  durationMs?: number;
  startedAt: number;
  completedAt?: number;
}

/**
 * Create a SubagentState from a persisted run (replay path). Used when loading
 * a session's history: realtime events still win over these via subagentId.
 */
function stateFromRun(run: SubagentRun): SubagentState {
  const tools: SubagentToolActivity[] = run.tools.map((t) => ({
    toolName: t.toolName,
    startedAt: t.startedAt ?? run.startedAt,
    ...(t.durationMs != null ? { durationMs: t.durationMs } : {}),
    ...(t.isError != null ? { isError: t.isError } : {}),
  }));
  return {
    subagentId: run.subagentId,
    parentSessionId: run.sessionId,
    task: run.task,
    status: run.status,
    tools,
    activeToolName: null,
    accumulatedText: run.accumulatedText,
    ...(run.error ? { error: run.error } : {}),
    ...(run.durationMs != null ? { durationMs: run.durationMs } : {}),
    startedAt: run.startedAt,
    ...(run.completedAt != null ? { completedAt: run.completedAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// Module-level singleton state for subagent tracking
// ---------------------------------------------------------------------------

const subagentStates = new Map<string, SubagentState>();
const listeners = new Set<() => void>();

// Long sessions can accumulate hundreds of finished runs, each retaining the
// full accumulated text and tool timeline. Cap finished retention; running
// states are never pruned, and the session currently on screen is also kept
// so its finished cards do not vanish mid-view.
const MAX_RETAINED_FINISHED_RUNS = 200;
let activeRenderSessionId: string | null = null;
function pruneFinishedStates() {
  if (subagentStates.size <= MAX_RETAINED_FINISHED_RUNS) return;
  for (const [id, state] of subagentStates) {
    if (state.status !== 'running' && state.parentSessionId !== activeRenderSessionId) {
      subagentStates.delete(id);
      if (subagentStates.size <= MAX_RETAINED_FINISHED_RUNS) break;
    }
  }
}
let rafId: number | null = null;

function notifyListeners() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    for (const listener of listeners) {
      listener();
    }
  });
}

/**
 * Process a subagent.progress event from the IPC layer.
 * Call this from the useIPC hook when a subagent.progress event arrives.
 */
export function handleSubagentProgressEvent(payload: {
  parentSessionId: string;
  subagentId: string;
  event: SubagentEvent;
  task?: string;
  toolName?: string;
  isError?: boolean;
  text?: string;
  error?: string;
  durationMs?: number;
}) {
  const { parentSessionId, subagentId, event } = payload;

  switch (event) {
    case 'started': {
      const existing = subagentStates.get(subagentId);
      if (existing && existing.status !== 'running') {
        break;
      }
      subagentStates.set(subagentId, {
        subagentId,
        parentSessionId,
        task: payload.task || '',
        status: 'running',
        tools: [],
        activeToolName: null,
        accumulatedText: '',
        startedAt: Date.now(),
      });
      break;
    }

    case 'tool_start': {
      const state = subagentStates.get(subagentId);
      if (!state) return;
      state.activeToolName = payload.toolName || null;
      state.tools.push({
        toolName: payload.toolName || 'unknown',
        startedAt: Date.now(),
      });
      break;
    }

    case 'tool_end': {
      const state = subagentStates.get(subagentId);
      if (!state) return;
      state.activeToolName = null;
      // Match by toolName (handle parallel tool execution)
      const matchingTool = [...state.tools]
        .reverse()
        .find((t) => t.toolName === (payload.toolName || 'unknown') && t.durationMs == null);
      if (matchingTool) {
        matchingTool.durationMs = Date.now() - matchingTool.startedAt;
        matchingTool.isError = payload.isError;
      }
      break;
    }

    case 'text_delta': {
      const state = subagentStates.get(subagentId);
      if (!state) return;
      // Backend sends full text (not delta), so replace rather than append
      state.accumulatedText = payload.text || '';
      break;
    }

    case 'completed': {
      const state = subagentStates.get(subagentId);
      if (!state) return;
      state.status = 'completed';
      state.durationMs = payload.durationMs;
      state.completedAt = Date.now();
      state.activeToolName = null;
      if (payload.text) state.accumulatedText = payload.text;
      break;
    }

    case 'failed': {
      const state = subagentStates.get(subagentId);
      if (!state) return;
      state.status = 'failed';
      state.error = payload.error;
      state.durationMs = payload.durationMs;
      state.completedAt = Date.now();
      state.activeToolName = null;
      if (payload.text) state.accumulatedText = payload.text;
      break;
    }
  }

  if (event === 'completed' || event === 'failed') {
    pruneFinishedStates();
  }

  notifyListeners();
}

/**
 * Merge persisted subagent runs (loaded from the DB when a session is opened)
 * into the in-memory state. Realtime events take precedence: runs whose id is
 * already tracked live are left untouched. Completed/failed history is kept
 * indefinitely so cards remain inspectable across session switches.
 */
export function mergeSubagentRunsFromHistory(sessionId: string, runs: SubagentRun[]) {
  if (!Array.isArray(runs) || runs.length === 0) return;
  let changed = false;
  for (const run of runs) {
    if (run.sessionId !== sessionId) continue;
    if (subagentStates.has(run.subagentId)) continue;
    subagentStates.set(run.subagentId, stateFromRun(run));
    changed = true;
  }
  if (changed) notifyListeners();
}

/**
 * Clear all subagent state for a session (call on session delete/reset).
 */
export function clearSubagentStatesForSession(sessionId: string) {
  for (const id of subagentStates.keys()) {
    if (subagentStates.get(id)?.parentSessionId === sessionId) {
      subagentStates.delete(id);
    }
  }
  notifyListeners();
}

/**
 * React hook that subscribes to subagent state changes for a given session.
 * Returns an array of live + replayed SubagentState objects, ordered by spawn
 * time. A runaway 'running' state older than the backend hard timeout is
 * surfaced as failed/timeout so cards never spin forever.
 */
export function useSubagentStates(sessionId: string | null): SubagentState[] {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // Track the session the UI is actively rendering so pruning only retires
    // finished runs belonging to other (unrendered) sessions.
    activeRenderSessionId = sessionId;
    return () => {
      if (activeRenderSessionId === sessionId) activeRenderSessionId = null;
    };
  }, [sessionId]);

  const handleChange = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  // Clone state objects so memo() on child components detects changes
  const states: SubagentState[] = [];
  for (const state of subagentStates.values()) {
    if (state.parentSessionId !== sessionId) continue;
    const cloned: SubagentState = { ...state, tools: [...state.tools] };
    if (cloned.status === 'running' && cloned.startedAt + MAX_SUBAGENT_RUNNING_MS < Date.now()) {
      cloned.status = 'failed';
      cloned.error = 'timeout';
      // Stable value derived from startedAt so the clone does not produce a new
      // completedAt (and a new object identity) on every re-render.
      cloned.completedAt = cloned.startedAt + MAX_SUBAGENT_RUNNING_MS;
    }
    states.push(cloned);
  }
  const hasRunningStates = states.some((s) => s.status === 'running');

  useEffect(() => {
    listeners.add(handleChange);
    // Periodic re-render so stale running states eventually resolve to
    // failed/timeout even with no further IPC events arriving. Idle sessions
    // with no live subagent skip the interval entirely.
    if (!hasRunningStates) {
      return () => {
        listeners.delete(handleChange);
      };
    }
    const intervalId = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => {
      clearInterval(intervalId);
      listeners.delete(handleChange);
    };
  }, [handleChange, hasRunningStates]);

  // Suppress unused variable lint — tick is read to trigger re-renders
  void tick;

  return states;
}

/**
 * Load a session's persisted subagent runs (populated by the main process from
 * the `subagent_runs` table) into the shared in-memory state. Call once per
 * active session; realtime events take precedence over the replay data.
 */
export function useLoadSubagentHistory(sessionId: string | null) {
  useEffect(() => {
    if (!sessionId) return;
    if (typeof window === 'undefined' || window.electronAPI === undefined) return;
    let cancelled = false;
    window.electronAPI.session
      .getSubagentRuns(sessionId)
      .then((runs) => {
        if (!cancelled) mergeSubagentRunsFromHistory(sessionId, runs);
      })
      .catch((err) => {
        console.error('[useSubagentProgress] Failed to load subagent history:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);
}
