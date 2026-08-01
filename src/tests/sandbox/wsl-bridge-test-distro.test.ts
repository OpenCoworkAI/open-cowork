import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'util';

// child_process.execFile is used via `promisify(execFile)` in wsl-bridge.ts. Node's
// real execFile defines `[util.promisify.custom]` to resolve `{ stdout, stderr }`
// directly rather than going through the plain (err, stdout, stderr) callback
// convention, so the cleanest way to mock it is to provide that same custom hook -
// promisify() then just returns our mock function as-is.
//
// vi.mock factories are hoisted above all other module code, so the mock function
// itself has to be created via vi.hoisted() rather than a plain top-level const -
// otherwise referencing it inside the factory throws a "before initialization" error.
const { execFileCustomMock } = vi.hoisted(() => ({ execFileCustomMock: vi.fn() }));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const execFileMock = vi.fn() as unknown as typeof actual.execFile & Record<PropertyKey, unknown>;
  execFileMock[promisify.custom as unknown as PropertyKey] = execFileCustomMock;
  return { ...actual, execFile: execFileMock };
});

import { WSLBridge } from '../../main/sandbox/wsl-bridge';

describe('WSLBridge.testDistro cold-start retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    execFileCustomMock.mockReset();
  });

  it('returns true immediately when the first probe succeeds', async () => {
    execFileCustomMock.mockResolvedValueOnce({ stdout: 'OK\n', stderr: '' });

    await expect(WSLBridge.testDistro('Ubuntu')).resolves.toBe(true);
    expect(execFileCustomMock).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('retries once after the cold-start delay when the first probe fails, then succeeds', async () => {
    execFileCustomMock
      .mockRejectedValueOnce(new Error('wsl service error'))
      .mockResolvedValueOnce({ stdout: 'OK\n', stderr: '' });

    const resultPromise = WSLBridge.testDistro('Ubuntu');

    // Let the first (failing) attempt's promise chain settle, then advance past
    // the 4s cold-start retry delay so the second attempt fires.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4000);

    await expect(resultPromise).resolves.toBe(true);
    expect(execFileCustomMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('returns false if both the initial probe and the retry fail', async () => {
    execFileCustomMock
      .mockRejectedValueOnce(new Error('wsl service error'))
      .mockRejectedValueOnce(new Error('still failing'));

    const resultPromise = WSLBridge.testDistro('Ubuntu');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4000);

    await expect(resultPromise).resolves.toBe(false);
    expect(execFileCustomMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('returns false for an invalid distro name without ever calling execFile', async () => {
    const resultPromise = WSLBridge.testDistro('bad; name');
    // Invalid-name failures still go through the same retry-once path (the
    // validation error is caught inside attemptOnce), so advance past the delay.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4000);

    await expect(resultPromise).resolves.toBe(false);
    expect(execFileCustomMock).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
