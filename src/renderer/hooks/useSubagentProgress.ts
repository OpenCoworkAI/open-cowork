import { useCallback, useEffect, useState } from 'react';

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

// ---------------------------------------------------------------------------
// Module-level singleton state for subagent tracking
// ---------------------------------------------------------------------------

const subagentStates = new Map<string, SubagentState>();
const listeners = new Set<() => void>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
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

      // Clear existing timer if duplicate event
      const existingTimer = cleanupTimers.get(subagentId);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        subagentStates.delete(subagentId);
        cleanupTimers.delete(subagentId);
        notifyListeners();
      }, 5000);
      cleanupTimers.set(subagentId, timer);
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

      // Clear existing timer if duplicate event
      const existingTimerF = cleanupTimers.get(subagentId);
      if (existingTimerF) clearTimeout(existingTimerF);

      const timer = setTimeout(() => {
        subagentStates.delete(subagentId);
        cleanupTimers.delete(subagentId);
        notifyListeners();
      }, 5000);
      cleanupTimers.set(subagentId, timer);
      break;
    }
  }

  notifyListeners();
}

/**
 * Clear all subagent state for a session (call on session delete/reset).
 */
export function clearSubagentStatesForSession(sessionId: string) {
  for (const [id, state] of subagentStates) {
    if (state.parentSessionId === sessionId) {
      const timer = cleanupTimers.get(id);
      if (timer) clearTimeout(timer);
      cleanupTimers.delete(id);
      subagentStates.delete(id);
    }
  }
  notifyListeners();
}

/**
 * React hook that subscribes to subagent state changes for a given session.
 * Returns an array of SubagentState objects for active/recently-completed subagents.
 * Completed/failed subagents are removed after a 5-second delay.
 */
export function useSubagentStates(sessionId: string | null): SubagentState[] {
  const [tick, setTick] = useState(0);

  const handleChange = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    listeners.add(handleChange);
    return () => {
      listeners.delete(handleChange);
    };
  }, [handleChange]);

  // Clone state objects so memo() on child components detects changes
  const states: SubagentState[] = [];
  for (const state of subagentStates.values()) {
    if (state.parentSessionId === sessionId) {
      states.push({ ...state, tools: [...state.tools] });
    }
  }

  // Suppress unused variable lint — tick is read to trigger re-renders
  void tick;

  return states;
}
