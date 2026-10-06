import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask } from '../src/main/schedule/scheduled-task-manager';

const { open, realpath } = vi.hoisted(() => ({ open: vi.fn(), realpath: vi.fn() }));
vi.mock('node:fs/promises', () => ({ open, realpath }));
import { checkLocalCondition } from '../src/main/schedule/local-condition-checker';

const task = {
  cwd: '/tmp',
  watchConfig: { checkType: 'file', compareMode: 'content', checkConfig: { path: 'watch.txt' } },
} as ScheduledTask;
beforeEach(() => {
  realpath.mockImplementation(async (value: string) => value);
});
afterEach(() => vi.clearAllMocks());

describe('bounded file condition reads', () => {
  it('limits bytes even when a file grows after handle.stat', async () => {
    const close = vi.fn();
    const read = vi.fn(async (_buffer: Buffer, _offset: number, length: number) => ({
      bytesRead: length,
    }));
    open.mockResolvedValue({ stat: async () => ({ isFile: () => true, size: 1 }), read, close });
    await expect(checkLocalCondition(task)).rejects.toThrow('10 MiB');
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][2]).toBe(10 * 1024 * 1024 + 1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledOnce();
  });

  it('checks the opened object is regular before reading', async () => {
    const read = vi.fn();
    const close = vi.fn();
    open.mockResolvedValue({ stat: async () => ({ isFile: () => false }), read, close });
    await expect(checkLocalCondition(task)).rejects.toThrow('regular file');
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
