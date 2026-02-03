import { describe, it, expect } from 'vitest';
import { applySessionUpdate } from '../src/renderer/utils/session-update';

describe('applySessionUpdate', () => {
  it('updates title in session list', () => {
    const sessions = [{ id: 's1', title: 'Old', status: 'idle' } as any];
    const updated = applySessionUpdate(sessions, 's1', { title: 'New' });
    expect(updated[0].title).toBe('New');
  });
});
