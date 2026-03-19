import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { withRetry } from '../src/main/utils/retry';

describe('withRetry', () => {
  it('returns the result on first success', async () => {
    const op = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(op, { maxRetries: 3 });
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');

    const result = await withRetry(op, { maxRetries: 3, delayMs: 1 });
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting all retries', async () => {
    const op = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      withRetry(op, { maxRetries: 2, delayMs: 1 })
    ).rejects.toThrow('always fails');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('respects shouldRetry predicate', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('fatal'));

    await expect(
      withRetry(op, {
        maxRetries: 3,
        delayMs: 1,
        shouldRetry: (err) => /timeout/i.test(err.message),
      })
    ).rejects.toThrow('fatal');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('calls onRetry callback with attempt number and error', async () => {
    const onRetry = vi.fn();
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    await withRetry(op, { maxRetries: 2, delayMs: 1, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it('applies exponential backoff', async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: Function, delay?: number) => {
      if (delay && delay > 0) delays.push(delay);
      // Execute immediately for test speed
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');

    await withRetry(op, { maxRetries: 3, delayMs: 100, backoffMultiplier: 2 });

    expect(delays).toEqual([100, 200]);
    vi.mocked(globalThis.setTimeout).mockRestore();
  });
});
