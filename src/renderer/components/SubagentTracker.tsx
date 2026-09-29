// SubagentCards — renders subagent progress cards inline in the chat stream.
// SubagentTracker's position-free live-only panel is replaced by positional
// placement: partitionSubagents() slots each run into the message gap that
// follows the last message that started before the subagent spawned, so cards
// appear in the model's analysis order instead of pinned to the stream bottom.
import { memo } from 'react';
import type { SubagentState } from '../hooks/useSubagentProgress';
import { SubagentProgress } from './SubagentProgress';
import type { Message } from '../types';

interface SubagentCardsProps {
  states: SubagentState[];
}

export const SubagentCards = memo(function SubagentCards({ states }: SubagentCardsProps) {
  if (states.length === 0) return null;

  return (
    <div className="space-y-2">
      {states.map((state) => (
        <SubagentProgress key={state.subagentId} state={state} />
      ))}
    </div>
  );
});

export interface SubagentPlacement {
  /** Subagents that spawned before the first message (or there are no messages). */
  leading: SubagentState[];
  /** Subagents placed after each message (parallel to `messages`). */
  gaps: SubagentState[][];
}

/**
 * Slot each subagent into the gap after the latest message whose timestamp is
 * <= its spawn time. Cards thereby follow the model's analysis order instead
 * of being pinned to the end of the stream.
 */
export function partitionSubagents(
  messages: Message[],
  subagents: SubagentState[]
): SubagentPlacement {
  const leading: SubagentState[] = [];
  const gaps: SubagentState[][] = messages.map(() => []);

  if (messages.length === 0) {
    return { leading: subagents, gaps };
  }

  for (const s of subagents) {
    let placed = false;
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const next = messages[i + 1];
      const afterThis = s.startedAt >= message.timestamp;
      const beforeNext = !next || s.startedAt < next.timestamp;
      if (afterThis && beforeNext) {
        gaps[i].push(s);
        placed = true;
        break;
      }
    }
    if (!placed) {
      // With messages present this is only reachable when the subagent spawned
      // before the first message (late spawns always match some gap).
      leading.push(s);
    }
  }

  return { leading, gaps };
}
