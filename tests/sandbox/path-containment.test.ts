import { describe, it, expect } from 'vitest';
import {
  normalizePathForContainment,
  isPathWithinRoot,
} from '../../src/main/tools/path-containment';

describe('normalizePathForContainment', () => {
  it('normalizes forward slashes', () => {
    expect(normalizePathForContainment('/a/b/c')).toBe('/a/b/c');
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(normalizePathForContainment('C:\\Users\\test')).toBe('C:/Users/test');
  });

  it('collapses multiple slashes', () => {
    expect(normalizePathForContainment('/a//b///c')).toBe('/a/b/c');
  });

  it('strips trailing slashes', () => {
    expect(normalizePathForContainment('/a/b/c/')).toBe('/a/b/c');
    expect(normalizePathForContainment('/a/b/c///')).toBe('/a/b/c');
  });

  it('returns empty string for empty input', () => {
    expect(normalizePathForContainment('')).toBe('');
  });

  it('handles case insensitive mode', () => {
    expect(normalizePathForContainment('/A/B/C', true)).toBe('/a/b/c');
  });

  it('preserves case in case-sensitive mode', () => {
    expect(normalizePathForContainment('/A/B/C', false)).toBe('/A/B/C');
  });

  it('handles mixed slashes', () => {
    expect(normalizePathForContainment('C:\\foo/bar\\baz')).toBe('C:/foo/bar/baz');
  });

  it('resolves single dot components', () => {
    expect(normalizePathForContainment('/a/./b/c')).toBe('/a/b/c');
  });

  it('resolves double dot components', () => {
    expect(normalizePathForContainment('/a/b/../c')).toBe('/a/c');
  });

  it('resolves multiple double dot components', () => {
    expect(normalizePathForContainment('/a/b/../../c')).toBe('/c');
  });

  it('resolves mixed dot and double dot', () => {
    expect(normalizePathForContainment('/a/./b/../c/./d')).toBe('/a/c/d');
  });

  it('handles traversal that goes to root', () => {
    expect(normalizePathForContainment('/a/b/../../')).toBe('/');
  });
});

describe('isPathWithinRoot', () => {
  it('returns true for exact match', () => {
    expect(isPathWithinRoot('/sandbox/workspace', '/sandbox/workspace')).toBe(true);
  });

  it('returns true for child path', () => {
    expect(isPathWithinRoot('/sandbox/workspace/file.txt', '/sandbox/workspace')).toBe(true);
  });

  it('returns true for deeply nested child', () => {
    expect(isPathWithinRoot('/sandbox/workspace/a/b/c/d.ts', '/sandbox/workspace')).toBe(true);
  });

  it('returns false for sibling path', () => {
    expect(isPathWithinRoot('/sandbox/other', '/sandbox/workspace')).toBe(false);
  });

  it('returns false for parent path', () => {
    expect(isPathWithinRoot('/sandbox', '/sandbox/workspace')).toBe(false);
  });

  it('returns false for prefix-but-not-child path', () => {
    // /sandbox/workspace2 starts with /sandbox/workspace but is NOT a child
    expect(isPathWithinRoot('/sandbox/workspace2', '/sandbox/workspace')).toBe(false);
  });

  it('returns false for empty target', () => {
    expect(isPathWithinRoot('', '/sandbox/workspace')).toBe(false);
  });

  it('returns false for empty root', () => {
    expect(isPathWithinRoot('/sandbox/workspace', '')).toBe(false);
  });

  it('handles trailing slashes correctly', () => {
    expect(isPathWithinRoot('/sandbox/workspace/', '/sandbox/workspace')).toBe(true);
    expect(isPathWithinRoot('/sandbox/workspace', '/sandbox/workspace/')).toBe(true);
  });

  it('handles case insensitive comparison', () => {
    expect(isPathWithinRoot('C:/Users/Test/file.txt', 'c:/users/test', true)).toBe(true);
    expect(isPathWithinRoot('C:/Users/Test/file.txt', 'c:/users/test', false)).toBe(false);
  });

  it('handles backslash normalization', () => {
    expect(isPathWithinRoot('C:\\sandbox\\workspace\\file.txt', 'C:\\sandbox\\workspace')).toBe(true);
  });

  it('blocks path traversal with dot-dot components', () => {
    expect(isPathWithinRoot('/sandbox/workspace/./../../etc/passwd', '/sandbox/workspace')).toBe(false);
  });

  it('blocks deep traversal', () => {
    expect(isPathWithinRoot('/sandbox/workspace/a/b/../../../etc', '/sandbox/workspace')).toBe(false);
  });

  it('allows dot-dot that stays within root', () => {
    expect(isPathWithinRoot('/sandbox/workspace/a/b/../c', '/sandbox/workspace')).toBe(true);
  });
});
