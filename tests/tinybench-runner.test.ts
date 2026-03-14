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
import { checkActiveAppAllowed } from '../src/main/cua/tinybench-runner';

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
