import { describe, it, expect } from 'vitest';
import { applySessionUpdate } from '../src/renderer/utils/session-update';
import type { Session } from '../src/renderer/types';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    title: 'Test Session',
    status: 'idle',
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

describe('applySessionUpdate', () => {
  it('updates existing session in array', () => {
    const sessions = [makeSession({ id: 's1', title: 'Old Title' })];
    const result = applySessionUpdate(sessions, 's1', { title: 'New Title' });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('New Title');
    expect(result[0].id).toBe('s1');
  });

  it('preserves other session fields when updating', () => {
    const sessions = [makeSession({ id: 's1', title: 'Title', status: 'running' })];
    const result = applySessionUpdate(sessions, 's1', { title: 'Updated' });
    expect(result[0].status).toBe('running');
  });

  it('preserves other sessions in array', () => {
    const sessions = [
      makeSession({ id: 's1', title: 'Session 1' }),
      makeSession({ id: 's2', title: 'Session 2' }),
    ];
    const result = applySessionUpdate(sessions, 's1', { title: 'Updated' });
    expect(result).toHaveLength(2);
    expect(result[1].title).toBe('Session 2');
  });

  it('inserts new session when not found and update is insertable', () => {
    const sessions = [makeSession({ id: 's1' })];
    const result = applySessionUpdate(sessions, 's2', {
      title: 'New Session',
      status: 'idle',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      createdAt: 1000,
      updatedAt: 2000,
    });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('s2'); // Inserted at beginning
  });

  it('does not insert when update is not insertable', () => {
    const sessions = [makeSession({ id: 's1' })];
    const result = applySessionUpdate(sessions, 's2', { title: 'Only title' });
    expect(result).toHaveLength(1);
  });

  it('returns same array when session not found and update not insertable', () => {
    const sessions = [makeSession({ id: 's1' })];
    const result = applySessionUpdate(sessions, 'nonexistent', { status: 'running' });
    expect(result).toBe(sessions);
  });
});
