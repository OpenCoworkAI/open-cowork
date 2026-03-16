import { describe, it, expect } from 'vitest';
import { resolvePathAgainstWorkspace } from '../shared/workspace-path';

describe('resolvePathAgainstWorkspace', () => {
  it('returns empty/falsy pathValue as-is', () => {
    expect(resolvePathAgainstWorkspace('')).toBe('');
  });

  it('returns absolute POSIX path as-is', () => {
    expect(resolvePathAgainstWorkspace('/usr/local/bin', '/home/user')).toBe('/usr/local/bin');
  });

  it('returns Windows drive path as-is', () => {
    expect(resolvePathAgainstWorkspace('C:\\Users\\foo', 'D:\\work')).toBe('C:\\Users\\foo');
  });

  it('resolves relative path against POSIX workspace', () => {
    expect(resolvePathAgainstWorkspace('src/main.ts', '/Users/haoqing/project')).toBe(
      '/Users/haoqing/project/src/main.ts'
    );
  });

  it('resolves relative path against Windows workspace', () => {
    expect(resolvePathAgainstWorkspace('src\\main.ts', 'C:\\Users\\foo\\project')).toBe(
      'C:\\Users\\foo\\project\\src\\main.ts'
    );
  });

  it('normalizes .. segments in relative path', () => {
    expect(resolvePathAgainstWorkspace('../other/file.ts', '/Users/haoqing/project/src')).toBe(
      '/Users/haoqing/project/other/file.ts'
    );
  });

  it('normalizes . segments', () => {
    expect(resolvePathAgainstWorkspace('./file.ts', '/Users/haoqing/project')).toBe(
      '/Users/haoqing/project/file.ts'
    );
  });

  it('remaps /workspace/ prefix to workspace path', () => {
    expect(resolvePathAgainstWorkspace('/workspace/src/index.ts', '/Users/haoqing/project')).toBe(
      '/Users/haoqing/project/src/index.ts'
    );
  });

  it('remaps Windows workspace prefix to workspace path', () => {
    expect(resolvePathAgainstWorkspace('C:\\workspace\\src\\index.ts', 'D:\\myproject')).toBe(
      'D:\\myproject\\src\\index.ts'
    );
  });

  it('returns relative path as-is when no workspace provided', () => {
    expect(resolvePathAgainstWorkspace('src/main.ts')).toBe('src/main.ts');
    expect(resolvePathAgainstWorkspace('src/main.ts', null)).toBe('src/main.ts');
  });

  it('returns /workspace/ path as-is when no workspace provided', () => {
    expect(resolvePathAgainstWorkspace('/workspace/src/main.ts')).toBe('/workspace/src/main.ts');
  });
});
