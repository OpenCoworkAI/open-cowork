import { describe, it, expect } from 'vitest';
import { applySessionUpdate } from '../src/renderer/utils/session-update';

describe('applySessionUpdate', () => {
  it('updates title in session list', () => {
    const sessions = [{ id: 's1', title: 'Old', status: 'idle' } as any];
    const updated = applySessionUpdate(sessions, 's1', { title: 'New' });
    expect(updated[0].title).toBe('New');
  });

  it('inserts session when missing and updates include full session fields', () => {
    const sessions: any[] = [];
    const updates = {
      title: 'Remote Session',
      status: 'idle',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      cwd: '/tmp',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
    };
    const updated = applySessionUpdate(sessions, 's-new', updates);
    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe('s-new');
    expect(updated[0].title).toBe('Remote Session');
  });

  it('does not insert session when updates are incomplete', () => {
    const updated = applySessionUpdate([], 's-missing', { title: 'Only Title' });
    expect(updated).toHaveLength(0);
  });
});
