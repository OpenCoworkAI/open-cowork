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

  it('allows descendants with dot segments that stay inside the root', () => {
    expect(isPathWithinRoot('/tmp/project/src/../index.ts', '/tmp/project')).toBe(true);
  });

  it('allows descendants inside the root', () => {
    expect(isPathWithinRoot('/tmp/project/src/index.ts', '/tmp/project')).toBe(true);
  });

  it('rejects paths that traverse outside the root with dot segments', () => {
    expect(isPathWithinRoot('/tmp/project/../secret.txt', '/tmp/project')).toBe(false);
  });

  it('rejects sibling paths that merely share a prefix', () => {
    expect(isPathWithinRoot('/tmp/project-evil/file.txt', '/tmp/project')).toBe(false);
  });

  it('rejects empty target inputs', () => {
    expect(isPathWithinRoot('', '/tmp/project')).toBe(false);
  });

  it('rejects relative target inputs', () => {
    expect(isPathWithinRoot('src/index.ts', '/tmp/project')).toBe(false);
  });

  it('rejects relative root inputs', () => {
    expect(isPathWithinRoot('/tmp/project/src/index.ts', 'tmp/project')).toBe(false);
  });

  it('supports case-insensitive Windows containment checks', () => {
    expect(isPathWithinRoot('C:/Workspace/Reports/out.txt', 'c:/workspace', true)).toBe(true);
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
});
