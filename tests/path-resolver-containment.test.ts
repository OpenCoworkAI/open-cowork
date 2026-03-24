import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MountedPath } from '../src/renderer/types';
import { PathResolver } from '../src/main/sandbox/path-resolver';

describe('PathResolver containment', () => {
  it('rejects virtual paths that only share a prefix with the mount root', () => {
    const resolver = new PathResolver();
    resolver.registerSession('session-1', [
      { virtual: '/mnt/workspace', real: '/tmp/project' },
    ] as MountedPath[]);

    expect(resolver.resolve('session-1', '/mnt/workspace-evil/secret.txt')).toBeNull();
  });

  it('rejects real paths that only share a prefix with the mount root', () => {
    const resolver = new PathResolver();
    resolver.registerSession('session-1', [
      { virtual: '/mnt/workspace', real: '/tmp/project' },
    ] as MountedPath[]);

    expect(resolver.virtualize('session-1', '/tmp/project-evil/secret.txt')).toBeNull();
  });

  it('allows filenames that contain double dots but are not traversal segments', () => {
    const resolver = new PathResolver();
    resolver.registerSession('session-1', [
      { virtual: '/mnt/workspace', real: '/tmp/project' },
    ] as MountedPath[]);

    expect(resolver.resolve('session-1', '/mnt/workspace/notes..final.md')).toBe(
      path.join('/tmp/project', 'notes..final.md')
    );
  });
});
