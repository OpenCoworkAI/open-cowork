import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { platform } from 'os';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: lookup }),
}));
vi.mock('os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('os')>()),
  platform: vi.fn(),
}));
beforeEach(() => {
  vi.resetModules();
  vi.mocked(platform).mockReturnValue('win32');
});
afterEach(() => vi.useRealTimers());

it('parses and caches a successful registry lookup', async () => {
  lookup.mockResolvedValue({ stdout: '    OEMCP    REG_SZ    936\r\n' });
  const { getWindowsConsoleCodePage } = await import('../../main/utils/windows-output-encoding');
  expect(await getWindowsConsoleCodePage()).toBe(936);
  expect(await getWindowsConsoleCodePage()).toBe(936);
  expect(lookup).toHaveBeenCalledTimes(1);
});

it('falls back to chcp when the registry lookup fails', async () => {
  lookup
    .mockRejectedValueOnce(new Error('registry unavailable'))
    .mockResolvedValueOnce({ stdout: 'Active code page: 1252\r\n' });
  const { getWindowsConsoleCodePage } = await import('../../main/utils/windows-output-encoding');
  expect(await getWindowsConsoleCodePage()).toBe(1252);
  expect(lookup.mock.calls.map(([command]) => command)).toEqual(['reg', 'cmd.exe']);
});

it('retries a transient failure instead of permanently caching null', async () => {
  lookup
    .mockRejectedValueOnce(new Error('registry unavailable'))
    .mockRejectedValueOnce(new Error('console unavailable'))
    .mockResolvedValueOnce({ stdout: 'OEMCP REG_SZ 932' });
  const { getWindowsConsoleCodePage } = await import('../../main/utils/windows-output-encoding');
  expect(await getWindowsConsoleCodePage()).toBeNull();
  expect(await getWindowsConsoleCodePage()).toBe(932);
  expect(lookup).toHaveBeenCalledTimes(3);
});

it('bounds detection by the caller deadline without starting a fallback after expiry', async () => {
  vi.useFakeTimers();
  lookup.mockImplementationOnce(async () => {
    vi.setSystemTime(Date.now() + 50);
    throw new Error('lookup timed out');
  });
  const { getWindowsConsoleCodePage } = await import('../../main/utils/windows-output-encoding');
  expect(await getWindowsConsoleCodePage({ timeoutMs: 50 })).toBeNull();
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(lookup.mock.calls[0][2]).toMatchObject({ timeout: 50, windowsHide: true });
});

it('passes cancellation to the lookup and does not run a fallback after abort', async () => {
  const controller = new AbortController();
  lookup.mockImplementationOnce(async () => {
    controller.abort();
    throw new Error('aborted');
  });
  const { getWindowsConsoleCodePage } = await import('../../main/utils/windows-output-encoding');
  expect(await getWindowsConsoleCodePage({ signal: controller.signal })).toBeNull();
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(lookup.mock.calls[0][2]).toMatchObject({ signal: controller.signal });
});

it('does not start Windows lookups on other platforms', async () => {
  vi.mocked(platform).mockReturnValue('darwin');
  const { getWindowsConsoleCodePage } = await import('../../main/utils/windows-output-encoding');
  expect(await getWindowsConsoleCodePage()).toBeNull();
  expect(lookup).not.toHaveBeenCalled();
});
