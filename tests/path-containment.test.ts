import { describe, expect, it } from 'vitest';
import { isPathWithinRoot, normalizePathForContainment } from '../src/main/tools/path-containment';

describe('normalizePathForContainment', () => {
  it('normalizes mixed separators and trims trailing separators', () => {
    expect(normalizePathForContainment('C:\\workspace\\reports\\')).toBe('C:/workspace/reports');
  });
});

describe('isPathWithinRoot', () => {
  it('allows exact root matches', () => {
    expect(isPathWithinRoot('/tmp/project', '/tmp/project')).toBe(true);
  });

  it('allows descendants inside the root', () => {
    expect(isPathWithinRoot('/tmp/project/src/index.ts', '/tmp/project')).toBe(true);
  });

  it('rejects sibling paths that merely share a prefix', () => {
    expect(isPathWithinRoot('/tmp/project-evil/file.txt', '/tmp/project')).toBe(false);
  });

  it('supports case-insensitive Windows containment checks', () => {
    expect(isPathWithinRoot('C:/Workspace/Reports/out.txt', 'c:/workspace', true)).toBe(true);
  });

  it('rejects UNC siblings that share the same prefix', () => {
    expect(isPathWithinRoot('//server/share-evil/out.txt', '//server/share', true)).toBe(false);
  });
});
