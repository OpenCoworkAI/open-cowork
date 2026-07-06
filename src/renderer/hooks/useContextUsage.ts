import { useMemo } from 'react';
import { useAppStore } from '../store';
import { useActiveSessionMessages } from '../store/selectors';

export interface ContextUsageInfo {
  tokens: number;
  contextWindow: number;
  percent: number;
  projectedTurnsRemaining: number | null;
}

/**
 * Returns real-time context usage for the active session.
 * Derives usage from the last message's input token count relative to the
 * session's context window. Computes a rough "turns remaining" estimate
 * based on average token growth per turn.
 */
export function useContextUsage(): ContextUsageInfo | null {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const contextWindow = useAppStore(
    (s) => (activeSessionId ? s.sessionStates[activeSessionId]?.contextWindow : undefined) ?? null
  );
  const messages = useActiveSessionMessages();

  return useMemo(() => {
    if (!activeSessionId || !contextWindow) return null;

    // Find last message with token usage to get current context occupation
    let lastInput = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].tokenUsage?.input) {
        lastInput = messages[i].tokenUsage!.input;
        break;
      }
    }
    if (lastInput === 0) return null;

    const percent = Math.min((lastInput / contextWindow) * 100, 100);

    // Estimate turns remaining based on average token growth per turn
    let projectedTurnsRemaining: number | null = null;
    const messagesWithTokens = messages.filter((m) => m.tokenUsage?.input);
    if (messagesWithTokens.length >= 2) {
      const first = messagesWithTokens[0].tokenUsage!.input;
      const last = messagesWithTokens[messagesWithTokens.length - 1].tokenUsage!.input;
      const avgGrowthPerTurn = (last - first) / (messagesWithTokens.length - 1);
      if (avgGrowthPerTurn > 0) {
        const remaining = contextWindow - lastInput;
        projectedTurnsRemaining = Math.max(0, Math.floor(remaining / avgGrowthPerTurn));
      }
    }

    return {
      tokens: lastInput,
      contextWindow,
      percent,
      projectedTurnsRemaining,
    };
  }, [activeSessionId, contextWindow, messages]);
}
