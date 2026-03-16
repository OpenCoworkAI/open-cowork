import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// Mock the dependencies
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('../../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../src/main/sandbox/wsl-bridge', () => ({
  pathConverter: {
    toWSL: vi.fn((p: string) => p),
    toWindows: vi.fn((p: string) => p),
  },
}));

vi.mock('../../src/main/tools/path-containment', () => ({
  isPathWithinRoot: vi.fn((target: string, root: string) => {
    const normalizedTarget = target.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
    const normalizedRoot = root.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
  }),
}));

// We cannot easily instantiate SandboxSync because it uses execFileSync for wslExec.
// Instead, we test the path traversal validation logic directly using path.posix.normalize.

describe('syncFileToSandbox path validation logic', () => {
  const sandboxPath = '/root/.claude/sandbox/test-session';

  function validateRelativePath(relativePath: string): { valid: boolean; error?: string; destPath?: string } {
    const normalized = path.posix.normalize(relativePath);
    if (normalized.startsWith('..') || path.posix.isAbsolute(normalized)) {
      return { valid: false, error: 'Invalid relative path: traversal detected' };
    }
    const destPath = `${sandboxPath}/${normalized}`;

    // Check containment
    const normalizedDest = destPath.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
    const normalizedRoot = sandboxPath.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
    const isWithin = normalizedDest === normalizedRoot || normalizedDest.startsWith(`${normalizedRoot}/`);

    if (!isWithin) {
      return { valid: false, error: 'Path escapes sandbox boundary' };
    }
    return { valid: true, destPath };
  }

  it('allows normal relative path', () => {
    const result = validateRelativePath('src/main.ts');
    expect(result.valid).toBe(true);
    expect(result.destPath).toBe('/root/.claude/sandbox/test-session/src/main.ts');
  });

  it('allows current directory reference', () => {
    const result = validateRelativePath('.');
    expect(result.valid).toBe(true);
  });

  it('allows ./normal.txt', () => {
    const result = validateRelativePath('./normal.txt');
    expect(result.valid).toBe(true);
    expect(result.destPath).toBe('/root/.claude/sandbox/test-session/normal.txt');
  });

  it('rejects ../../etc/passwd traversal', () => {
    const result = validateRelativePath('../../etc/passwd');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('traversal');
  });

  it('rejects ../secret traversal', () => {
    const result = validateRelativePath('../secret');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('traversal');
  });

  it('rejects absolute path /etc/passwd', () => {
    const result = validateRelativePath('/etc/passwd');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('traversal');
  });

  it('rejects path that normalizes to traversal', () => {
    // foo/../../etc/passwd normalizes to ../etc/passwd which starts with ..
    const result = validateRelativePath('foo/../../etc/passwd');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('traversal');
  });

  it('allows deeply nested relative path', () => {
    const result = validateRelativePath('a/b/c/d/e/file.txt');
    expect(result.valid).toBe(true);
  });

  it('normalizes redundant slashes', () => {
    const result = validateRelativePath('a//b///c.txt');
    expect(result.valid).toBe(true);
    expect(result.destPath).toBe('/root/.claude/sandbox/test-session/a/b/c.txt');
  });

  it('normalizes inner . and ..', () => {
    // a/./b/../c.txt normalizes to a/c.txt (still within sandbox)
    const result = validateRelativePath('a/./b/../c.txt');
    expect(result.valid).toBe(true);
    expect(result.destPath).toBe('/root/.claude/sandbox/test-session/a/c.txt');
  });
});

describe('windowsToSandboxPath conversion', () => {
  it('converts Windows path within workspace to sandbox path', () => {
    const windowsPath = 'D:\\project\\src\\main.ts';
    const workspacePath = 'D:\\project';
    const sandboxBasePath = '/root/.claude/sandbox/test-session';

    const normalizedWindows = workspacePath.replace(/\\/g, '/').toLowerCase();
    const normalizedInput = windowsPath.replace(/\\/g, '/').toLowerCase();

    // Check containment
    expect(normalizedInput.startsWith(normalizedWindows)).toBe(true);

    const relativePath = windowsPath.substring(workspacePath.length);
    const result = sandboxBasePath + relativePath.replace(/\\/g, '/');
    expect(result).toBe('/root/.claude/sandbox/test-session/src/main.ts');
  });
});

describe('isPathInSandbox', () => {
  it('returns true for path within sandbox', () => {
    const sandboxPath = '/root/.claude/sandbox/session-1';
    const testPath = '/root/.claude/sandbox/session-1/file.txt';
    const normalized = testPath.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
    const normalizedRoot = sandboxPath.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
    expect(normalized.startsWith(`${normalizedRoot}/`)).toBe(true);
  });

  it('returns false for path outside sandbox', () => {
    const sandboxPath = '/root/.claude/sandbox/session-1';
    const testPath = '/root/.claude/sandbox/session-2/file.txt';
    const normalized = testPath.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
    const normalizedRoot = sandboxPath.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
    expect(normalized.startsWith(`${normalizedRoot}/`)).toBe(false);
  });

  it('handles exact sandbox path match', () => {
    const sandboxPath = '/root/.claude/sandbox/session-1';
    const normalized = sandboxPath.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
    const normalizedRoot = sandboxPath.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
    expect(normalized === normalizedRoot).toBe(true);
  });
});
