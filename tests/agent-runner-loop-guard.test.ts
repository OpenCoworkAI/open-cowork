import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOOP_GUARD_CONFIG,
  LoopGuard,
  buildAbortUserMessage,
  buildHaltSteerMessage,
  buildWarnSteerMessage,
  messageCallsHash,
  stableToolKey,
  type ToolCallDescriptor,
} from '../src/main/claude/agent-runner-loop-guard';

describe('stableToolKey', () => {
  it('buckets adjacent read_file line ranges into the same key', () => {
    const a = stableToolKey('read_file', { file_path: '/a/b.ts', start_line: 1 });
    const b = stableToolKey('read_file', { file_path: '/a/b.ts', start_line: 100 });
    const c = stableToolKey('read_file', { file_path: '/a/b.ts', start_line: 199 });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('separates read_file buckets when crossing the 200-line boundary', () => {
    const a = stableToolKey('read_file', { file_path: '/a/b.ts', start_line: 10 });
    const b = stableToolKey('read_file', { file_path: '/a/b.ts', start_line: 500 });
    expect(a).not.toBe(b);
  });

  it('distinguishes different files for read_file', () => {
    const a = stableToolKey('read_file', { file_path: '/a/b.ts', start_line: 0 });
    const b = stableToolKey('read_file', { file_path: '/a/c.ts', start_line: 0 });
    expect(a).not.toBe(b);
  });

  it('treats write_file content changes as distinct operations', () => {
    const a = stableToolKey('write_file', { file_path: '/a.ts', content: 'hello' });
    const b = stableToolKey('write_file', { file_path: '/a.ts', content: 'world' });
    expect(a).not.toBe(b);
  });

  it('str_replace with different replacement payloads yields different keys', () => {
    const a = stableToolKey('str_replace', { path: '/f', old_str: 'a', new_str: 'b' });
    const b = stableToolKey('str_replace', { path: '/f', old_str: 'a', new_str: 'c' });
    expect(a).not.toBe(b);
  });

  it('generic tool extracts only key fields (ignores noise)', () => {
    const a = stableToolKey('web_search', { query: 'foo', session_id: 'x', ts: 1 });
    const b = stableToolKey('web_search', { query: 'foo', session_id: 'y', ts: 2 });
    expect(a).toBe(b);
  });

  it('generic tool with different query yields different keys', () => {
    const a = stableToolKey('web_search', { query: 'foo' });
    const b = stableToolKey('web_search', { query: 'bar' });
    expect(a).not.toBe(b);
  });

  it('is stable against key ordering in input objects', () => {
    const a = stableToolKey('bash', { command: 'ls', cwd: '/a' });
    const b = stableToolKey('bash', { cwd: '/a', command: 'ls' });
    expect(a).toBe(b);
  });

  it('returns a deterministic placeholder for missing input', () => {
    expect(stableToolKey('any', undefined)).toBe('any:∅');
  });
});

describe('messageCallsHash', () => {
  it('returns the same hash for identical tool-call groups regardless of object key ordering', () => {
    const groupA: ToolCallDescriptor[] = [
      { name: 'bash', input: { command: 'ls' } },
      { name: 'read_file', input: { file_path: '/x', start_line: 0 } },
    ];
    const groupB: ToolCallDescriptor[] = [
      { name: 'bash', input: { command: 'ls' } },
      { name: 'read_file', input: { start_line: 0, file_path: '/x' } },
    ];
    expect(messageCallsHash(groupA)).toBe(messageCallsHash(groupB));
  });

  it('order matters (sequence of calls is part of identity)', () => {
    const group1: ToolCallDescriptor[] = [
      { name: 'a', input: { x: 1 } },
      { name: 'b', input: { y: 2 } },
    ];
    const group2: ToolCallDescriptor[] = [
      { name: 'b', input: { y: 2 } },
      { name: 'a', input: { x: 1 } },
    ];
    expect(messageCallsHash(group1)).not.toBe(messageCallsHash(group2));
  });

  it('empty tool-call list hashes to empty string', () => {
    expect(messageCallsHash([])).toBe('');
  });
});

describe('LoopGuard layer 1 — hash-based group detection', () => {
  const buildCall = (name: string, input: Record<string, unknown>): ToolCallDescriptor => ({
    name,
    input,
  });

  it('emits hash_warn on the 3rd identical group and halt on the 5th and abort on the 8th', () => {
    const guard = new LoopGuard();
    const group = [buildCall('bash', { command: 'echo hi' })];

    const decisions = Array.from({ length: 10 }, () => guard.recordAssistantMessage(group));

    expect(decisions[0].action).toBe('none');
    expect(decisions[1].action).toBe('none');
    expect(decisions[2].action).toBe('hash_warn');
    expect(decisions[2].count).toBe(3);
    expect(decisions[3].action).toBe('none');
    expect(decisions[4].action).toBe('hash_halt');
    expect(decisions[4].count).toBe(5);
    expect(decisions[5].action).toBe('none');
    expect(decisions[6].action).toBe('none');
    expect(decisions[7].action).toBe('hash_abort');
    expect(decisions[7].count).toBe(8);
    expect(decisions[8].action).toBe('none');
    expect(decisions[9].action).toBe('none');
  });

  it('different groups do not contribute to each other', () => {
    const guard = new LoopGuard();
    const groupA = [buildCall('read_file', { file_path: '/a', start_line: 0 })];
    const groupB = [buildCall('read_file', { file_path: '/b', start_line: 0 })];

    const seq = [groupA, groupB, groupA, groupB, groupA, groupB, groupA, groupB];
    const actions = seq.map((g) => guard.recordAssistantMessage(g).action);
    expect(actions[4]).toBe('hash_warn');
    expect(actions[5]).toBe('hash_warn');
    expect(actions[6]).toBe('none');
    expect(actions[7]).toBe('none');
  });

  it('empty tool-call messages (pure text responses) are ignored by the guard', () => {
    const guard = new LoopGuard();
    expect(guard.recordAssistantMessage([]).action).toBe('none');
    expect(guard.recordAssistantMessage([]).action).toBe('none');
    expect(guard.recordAssistantMessage([]).action).toBe('none');
  });

  it('respects sliding window — old entries drop out and allow re-triggering', () => {
    const guard = new LoopGuard({ messageHashWindow: 3 });
    const A = [buildCall('a', { x: 1 })];
    const B = [buildCall('b', { x: 1 })];

    expect(guard.recordAssistantMessage(A).action).toBe('none');
    expect(guard.recordAssistantMessage(A).action).toBe('none');
    expect(guard.recordAssistantMessage(A).action).toBe('hash_warn');

    guard.recordAssistantMessage(B);
    guard.recordAssistantMessage(B);
    guard.recordAssistantMessage(B);

    expect(guard.recordAssistantMessage(A).action).toBe('none');
    expect(guard.recordAssistantMessage(A).action).toBe('none');
    expect(guard.recordAssistantMessage(A).action).toBe('hash_warn');
  });

  it('collapses adjacent read_file ranges so they count as the same group', () => {
    const guard = new LoopGuard();
    const actions = [0, 50, 100, 150, 199]
      .map((start) => [buildCall('read_file', { file_path: '/big.ts', start_line: start })])
      .map((g) => guard.recordAssistantMessage(g).action);

    expect(actions[0]).toBe('none');
    expect(actions[1]).toBe('none');
    expect(actions[2]).toBe('hash_warn');
    expect(actions[3]).toBe('none');
    expect(actions[4]).toBe('hash_halt');
  });
});

describe('LoopGuard layer 2 — per-tool frequency detection', () => {
  it('per-tool counters are independent across tool names', () => {
    const guard = new LoopGuard();
    for (let i = 0; i < 29; i++) guard.recordToolInvocation('read_file');
    for (let i = 0; i < 29; i++) guard.recordToolInvocation('bash');
    expect(guard.recordToolInvocation('read_file').action).toBe('freq_warn');
    expect(guard.recordToolInvocation('bash').action).toBe('freq_warn');
  });

  it('custom thresholds via constructor are honoured', () => {
    const guard = new LoopGuard({
      toolFrequencyWarnThreshold: 2,
      toolFrequencyHaltThreshold: 3,
      toolFrequencyAbortThreshold: 4,
    });
    expect(guard.recordToolInvocation('x').action).toBe('none');
    expect(guard.recordToolInvocation('x').action).toBe('freq_warn');
    expect(guard.recordToolInvocation('x').action).toBe('freq_halt');
    expect(guard.recordToolInvocation('x').action).toBe('freq_abort');
  });
});

describe('Message builders', () => {
  it('warn / halt / abort messages all contain the count or tool name', () => {
    const warnHash = buildWarnSteerMessage({ action: 'hash_warn', reason: 'x', count: 3 });
    expect(warnHash).toContain('3');
    expect(warnHash).toContain('Loop Guard');

    const haltFreq = buildHaltSteerMessage({
      action: 'freq_halt',
      reason: 'x',
      toolName: 'bash',
      count: 50,
    });
    expect(haltFreq).toContain('bash');
    expect(haltFreq).toContain('50');
    expect(haltFreq).toContain('STOP');

    const abortHash = buildAbortUserMessage({ action: 'hash_abort', reason: 'x', count: 8 });
    expect(abortHash).toContain('8');
    expect(abortHash).toContain('Loop Guard');
    expect(abortHash).toContain('Thinking');
  });
});

describe('DEFAULT_LOOP_GUARD_CONFIG', () => {
  it('matches the documented thresholds', () => {
    expect(DEFAULT_LOOP_GUARD_CONFIG.messageHashWindow).toBe(20);
    expect(DEFAULT_LOOP_GUARD_CONFIG.duplicateHashWarnThreshold).toBe(3);
    expect(DEFAULT_LOOP_GUARD_CONFIG.duplicateHashHaltThreshold).toBe(5);
    expect(DEFAULT_LOOP_GUARD_CONFIG.duplicateHashAbortThreshold).toBe(8);
    expect(DEFAULT_LOOP_GUARD_CONFIG.toolFrequencyWarnThreshold).toBe(30);
    expect(DEFAULT_LOOP_GUARD_CONFIG.toolFrequencyHaltThreshold).toBe(50);
    expect(DEFAULT_LOOP_GUARD_CONFIG.toolFrequencyAbortThreshold).toBe(80);
    expect(DEFAULT_LOOP_GUARD_CONFIG.readFileLineBucketSize).toBe(200);
  });
});
