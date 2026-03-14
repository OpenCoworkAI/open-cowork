/**
 * Unit tests for TinyBench Runner safety-zone logic.
 *
 * These tests mock the osascript call used by checkActiveAppAllowed()
 * to verify whitelist enforcement without executing any real commands.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:child_process — no real exec calls are made in these tests
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

// Capture the mocked exec so we can control its return value
import { exec as rawExec } from 'node:child_process';

// The module under test uses promisify(exec), so we need the mock to
// behave like a callback-style function that promisify can wrap.
const mockedExec = vi.mocked(rawExec);

function setFrontmostApp(appName: string) {
  mockedExec.mockImplementation((_cmd: any, _opts: any, cb?: any) => {
    const callback = cb || _opts;
    if (typeof callback === 'function') {
      callback(null, { stdout: `${appName}\n`, stderr: '' });
    }
    return {} as any;
  });
}

// Import after mocks
import { checkActiveAppAllowed, focusAllowedApp, detectStuck, type RecentCall } from '../src/main/cua/tinybench-runner';

describe('checkActiveAppAllowed', () => {
  beforeEach(() => {
    mockedExec.mockReset();
  });

  it('allows when active app is in the whitelist', async () => {
    setFrontmostApp('Calculator');
    const result = await checkActiveAppAllowed(['Calculator', 'Finder']);
    expect(result.allowed).toBe(true);
    expect(result.activeApp).toBe('Calculator');
  });

  it('blocks when active app is NOT in the whitelist', async () => {
    setFrontmostApp('Terminal');
    const result = await checkActiveAppAllowed(['Calculator']);
    expect(result.allowed).toBe(false);
    expect(result.activeApp).toBe('Terminal');
  });

  it('matching is case-insensitive', async () => {
    setFrontmostApp('CALCULATOR');
    const result = await checkActiveAppAllowed(['calculator']);
    expect(result.allowed).toBe(true);
  });

  it('supports substring matching (e.g. app bundle names)', async () => {
    setFrontmostApp('Google Chrome Helper');
    const result = await checkActiveAppAllowed(['Chrome']);
    expect(result.allowed).toBe(true);
  });

  it('trims whitespace from osascript output', async () => {
    setFrontmostApp('  Finder  ');
    const result = await checkActiveAppAllowed(['Finder']);
    expect(result.allowed).toBe(true);
    expect(result.activeApp).toBe('Finder');
  });

  it('returns allowed=false for empty whitelist', async () => {
    setFrontmostApp('Calculator');
    const result = await checkActiveAppAllowed([]);
    expect(result.allowed).toBe(false);
  });
});

describe('focusAllowedApp', () => {
  beforeEach(() => {
    mockedExec.mockReset();
  });

  it('calls osascript to activate the first allowed app', async () => {
    mockedExec.mockImplementation((_cmd: any, _opts: any, cb?: any) => {
      const callback = cb || _opts;
      if (typeof callback === 'function') {
        callback(null, { stdout: '', stderr: '' });
      }
      return {} as any;
    });

    await focusAllowedApp(['Calculator', 'Finder']);

    expect(mockedExec).toHaveBeenCalledTimes(1);
    const call = mockedExec.mock.calls[0];
    expect(call[0]).toContain('Calculator');
    expect(call[0]).toContain('activate');
  });

  it('does nothing when allowedApps is undefined', async () => {
    await focusAllowedApp(undefined);
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('does nothing when allowedApps is empty', async () => {
    await focusAllowedApp([]);
    expect(mockedExec).not.toHaveBeenCalled();
  });
});

describe('detectStuck', () => {
  function makeCall(tool: string, x?: number, y?: number): RecentCall {
    return { tool, x, y, timestamp: Date.now() };
  }

  it('returns ok when buffer is too small', () => {
    const calls = [makeCall('click', 100, 200), makeCall('click', 100, 200)];
    expect(detectStuck(calls)).toBe('ok');
  });

  it('returns warn after 3 identical calls', () => {
    const calls = [
      makeCall('click', 100, 200),
      makeCall('click', 105, 195),
      makeCall('click', 100, 200),
    ];
    expect(detectStuck(calls)).toBe('warn');
  });

  it('returns error after 5 identical calls', () => {
    const calls = [
      makeCall('click', 100, 200),
      makeCall('click', 110, 210),
      makeCall('click', 105, 195),
      makeCall('click', 100, 200),
      makeCall('click', 108, 205),
    ];
    expect(detectStuck(calls)).toBe('error');
  });

  it('returns ok when tools differ', () => {
    const calls = [
      makeCall('click', 100, 200),
      makeCall('key_press'),
      makeCall('click', 100, 200),
    ];
    expect(detectStuck(calls)).toBe('ok');
  });

  it('returns ok when coordinates differ significantly', () => {
    const calls = [
      makeCall('click', 100, 200),
      makeCall('click', 500, 600),
      makeCall('click', 100, 200),
    ];
    expect(detectStuck(calls)).toBe('ok');
  });

  it('handles calls without coordinates (e.g. key_press)', () => {
    const calls = [
      makeCall('key_press'),
      makeCall('key_press'),
      makeCall('key_press'),
    ];
    expect(detectStuck(calls)).toBe('warn');
  });
});
