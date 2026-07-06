// SubagentTracker — renders all active subagent progress cards for the current session.
// Placed inline in the chat stream alongside messages.
import { memo } from 'react';
import { useSubagentStates } from '../hooks/useSubagentProgress';
import { SubagentProgress } from './SubagentProgress';

interface SubagentTrackerProps {
  sessionId: string | null;
}

export const SubagentTracker = memo(function SubagentTracker({ sessionId }: SubagentTrackerProps) {
  const subagents = useSubagentStates(sessionId);

  if (subagents.length === 0) return null;

  return (
    <div className="space-y-2">
      {subagents.map((state) => (
        <SubagentProgress key={state.subagentId} state={state} />
      ))}
    </div>
  );
});
