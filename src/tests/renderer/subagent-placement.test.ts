import { describe, it, expect } from 'vitest';
import { partitionSubagents } from '../../renderer/components/SubagentTracker';
import type { SubagentState } from '../../renderer/hooks/useSubagentProgress';
import type { Message } from '../../renderer/types';

function makeMessage(id: string, timestamp: number, role: 'user' | 'assistant' = 'user'): Message {
  return { id, sessionId: 's1', role, content: [{ type: 'text', text: 'x' }], timestamp };
}

function makeSubagent(id: string, startedAt: number): SubagentState {
  return {
    subagentId: id,
    parentSessionId: 's1',
    task: 'task',
    status: 'completed',
    tools: [],
    activeToolName: null,
    accumulatedText: '',
    startedAt,
    completedAt: startedAt + 1,
  };
}

describe('partitionSubagents', () => {
  it('places a subagent after the last message that started before it', () => {
    const messages = [makeMessage('m1', 100), makeMessage('m2', 200), makeMessage('m3', 300)];
    const subagents = [
      makeSubagent('a1', 150),
      makeSubagent('a2', 250),
      makeSubagent('a3', 50),
      makeSubagent('a4', 350),
    ];

    const placed = partitionSubagents(messages, subagents);

    expect(placed.leading.map((s) => s.subagentId)).toEqual(['a3']);
    expect(placed.gaps[0].map((s) => s.subagentId)).toEqual(['a1']);
    expect(placed.gaps[1].map((s) => s.subagentId)).toEqual(['a2']);
    // After the last message is also a gap (the stream tail).
    expect(placed.gaps[2].map((s) => s.subagentId)).toEqual(['a4']);
  });

  it('keeps exact-boundary subagent (startedAt === message timestamp) in that message gap', () => {
    const messages = [makeMessage('m1', 100), makeMessage('m2', 200)];
    const placed = partitionSubagents(messages, [makeSubagent('a1', 100)]);
    expect(placed.gaps[0].map((s) => s.subagentId)).toEqual(['a1']);
  });

  it('puts everything in leading when there are no messages', () => {
    const placed = partitionSubagents([], [makeSubagent('a1', 100)]);
    expect(placed.leading.map((s) => s.subagentId)).toEqual(['a1']);
    expect(placed.gaps).toEqual([]);
  });

  it('returns parallel gaps (one empty array per message)', () => {
    const messages = [makeMessage('m1', 100), makeMessage('m2', 200)];
    const placed = partitionSubagents(messages, []);
    expect(placed.gaps).toHaveLength(2);
    expect(placed.gaps.every((g) => g.length === 0)).toBe(true);
  });
});
