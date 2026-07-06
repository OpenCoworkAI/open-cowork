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

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
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
      const lastTool = state.tools[state.tools.length - 1];
      if (lastTool) {
        lastTool.durationMs = Date.now() - lastTool.startedAt;
        lastTool.isError = payload.isError;
      }
      break;
    }

    case 'text_delta': {
      const state = subagentStates.get(subagentId);
      if (!state) return;
      state.accumulatedText += payload.text || '';
      break;
    }

    case 'completed': {
      const state = subagentStates.get(subagentId);
      if (!state) return;
      state.status = 'completed';
      state.durationMs = payload.durationMs;
      state.completedAt = Date.now();
      state.activeToolName = null;

      // Schedule cleanup after 5 seconds
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

      // Schedule cleanup after 5 seconds
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

  // Build array of subagent states for this session
  const states: SubagentState[] = [];
  for (const state of subagentStates.values()) {
    if (state.parentSessionId === sessionId) {
      states.push(state);
    }
  }

  // Suppress unused variable lint — tick is read to trigger re-renders
  void tick;

  return states;
}
