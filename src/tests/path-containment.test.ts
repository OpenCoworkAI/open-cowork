import { describe, it, expect } from 'vitest';
import { normalizePathForContainment, isPathWithinRoot } from '../main/tools/path-containment';

describe('normalizePathForContainment', () => {
  it('normalizes backslashes to forward slashes', () => {
    expect(normalizePathForContainment('C:\\Users\\foo')).toBe('C:/Users/foo');
  });

  it('strips trailing slashes', () => {
    expect(normalizePathForContainment('/home/user/')).toBe('/home/user');
  });

  it('preserves root slash when input is just "/"', () => {
    expect(normalizePathForContainment('/')).toBe('/');
  });

  it('preserves root slash when input is multiple slashes', () => {
    expect(normalizePathForContainment('//')).toBe('/');
  });

  it('preserves root slash for backslash', () => {
    expect(normalizePathForContainment('\\')).toBe('/');
  });

  it('returns empty for empty string', () => {
    expect(normalizePathForContainment('')).toBe('');
  });

  it('applies case insensitive normalization', () => {
    expect(normalizePathForContainment('/Home/User', true)).toBe('/home/user');
  });
});

describe('isPathWithinRoot', () => {
  it('returns true for exact root match', () => {
    expect(isPathWithinRoot('/workspace', '/workspace')).toBe(true);
  });

  it('returns true for child path', () => {
    expect(isPathWithinRoot('/workspace/src/file.ts', '/workspace')).toBe(true);
  });

  it('returns false for sibling path with shared prefix', () => {
    expect(isPathWithinRoot('/workspace-other/file.ts', '/workspace')).toBe(false);
  });

  it('returns false for parent path', () => {
    expect(isPathWithinRoot('/work', '/workspace')).toBe(false);
  });

  it('returns false for empty target', () => {
    expect(isPathWithinRoot('', '/workspace')).toBe(false);
  });

  it('returns false for empty root', () => {
    expect(isPathWithinRoot('/workspace', '')).toBe(false);
  });

  it('handles root as /', () => {
    expect(isPathWithinRoot('/anything', '/')).toBe(true);
  });

  it('handles root as / with exact match', () => {
    expect(isPathWithinRoot('/', '/')).toBe(true);
  });

  it('case insensitive mode works for Windows paths', () => {
    expect(isPathWithinRoot('C:\\Users\\FOO\\file.txt', 'c:\\users\\foo', true)).toBe(true);
  });

  it('allows descendants with dot segments that stay inside the root', () => {
    expect(isPathWithinRoot('/tmp/project/src/../index.ts', '/tmp/project')).toBe(true);
  });

  it('rejects paths that traverse outside the root with dot segments', () => {
    expect(isPathWithinRoot('/tmp/project/../secret.txt', '/tmp/project')).toBe(false);
  });

  it('rejects relative target inputs', () => {
    expect(isPathWithinRoot('src/index.ts', '/tmp/project')).toBe(false);
  });

  it('rejects relative root inputs', () => {
    expect(isPathWithinRoot('/tmp/project/src/index.ts', 'tmp/project')).toBe(false);
  });

  it('supports rooted backslash paths produced by Windows normalization', () => {
    expect(isPathWithinRoot('\\tmp\\project\\notes..final.md', '\\tmp\\project')).toBe(true);
  });

  it('rejects Windows paths that traverse outside the root', () => {
    expect(
      isPathWithinRoot('C:/Workspace/Reports/../../Secrets/out.txt', 'c:/workspace/reports', true)
    ).toBe(false);
  });

  it('rejects UNC siblings that share the same prefix', () => {
    expect(isPathWithinRoot('//server/share-evil/out.txt', '//server/share', true)).toBe(false);
  });

  it('rejects UNC paths that traverse outside the root', () => {
    expect(
      isPathWithinRoot('//server/share/workspace/../secret.txt', '//server/share/workspace', true)
    ).toBe(false);
  });

  it('rejects target paths containing null bytes', () => {
    expect(isPathWithinRoot('/workspace/file\x00.txt', '/workspace')).toBe(false);
  });

  it('rejects root paths containing null bytes', () => {
    expect(isPathWithinRoot('/workspace/file.txt', '/workspace\x00')).toBe(false);
  });
});
