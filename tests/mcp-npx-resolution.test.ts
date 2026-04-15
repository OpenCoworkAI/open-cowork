import { describe, expect, it } from 'vitest';

import { findPreferredWindowsNpxPath } from '../src/main/mcp/mcp-manager';

describe('findPreferredWindowsNpxPath', () => {
  it('prefers a system npx.cmd later in PATH over the bundled npx.cmd', () => {
    const bundled = 'C:\\open-cowork\\resources\\node\\npx.cmd';
    const pathEnv = [
      'C:\\open-cowork\\resources\\node',
      'C:\\Program Files\\nodejs',
      'C:\\Windows\\System32',
    ].join(';');

    const resolved = findPreferredWindowsNpxPath(pathEnv, bundled, (candidate) => {
      return candidate === bundled || candidate === 'C:\\Program Files\\nodejs\\npx.cmd';
    });

    expect(resolved).toBe('C:\\Program Files\\nodejs\\npx.cmd');
  });

  it('falls back to the bundled npx.cmd when no system npx.cmd is present', () => {
    const bundled = 'C:\\open-cowork\\resources\\node\\npx.cmd';
    const pathEnv = ['C:\\open-cowork\\resources\\node', 'C:\\Windows\\System32'].join(';');

    const resolved = findPreferredWindowsNpxPath(pathEnv, bundled, (candidate) => {
      return candidate === bundled;
    });

    expect(resolved).toBe(bundled);
  });

  it('ignores quoted PATH entries when resolving system npx.cmd', () => {
    const bundled = 'C:\\open-cowork\\resources\\node\\npx.cmd';
    const pathEnv = ['"C:\\open-cowork\\resources\\node"', '"C:\\Program Files\\nodejs"'].join(';');

    const resolved = findPreferredWindowsNpxPath(pathEnv, bundled, (candidate) => {
      return candidate === bundled || candidate === 'C:\\Program Files\\nodejs\\npx.cmd';
    });

    expect(resolved).toBe('C:\\Program Files\\nodejs\\npx.cmd');
  });

  it('ignores untrusted PATH entries and keeps searching for a trusted system npx.cmd', () => {
    const bundled = 'C:\\open-cowork\\resources\\node\\npx.cmd';
    const pathEnv = ['C:\\Users\\tester\\AppData\\Roaming\\npm', 'C:\\Program Files\\nodejs'].join(
      ';'
    );

    const resolved = findPreferredWindowsNpxPath(
      pathEnv,
      bundled,
      (candidate) => {
        return (
          candidate === bundled ||
          candidate === 'C:\\Users\\tester\\AppData\\Roaming\\npm\\npx.cmd' ||
          candidate === 'C:\\Program Files\\nodejs\\npx.cmd'
        );
      },
      ['C:\\Program Files\\nodejs']
    );

    expect(resolved).toBe('C:\\Program Files\\nodejs\\npx.cmd');
  });

  it('treats trusted PATH entries with a trailing slash as trusted', () => {
    const bundled = 'C:\\open-cowork\\resources\\node\\npx.cmd';
    const pathEnv = 'C:\\Program Files\\nodejs\\';

    const resolved = findPreferredWindowsNpxPath(
      pathEnv,
      bundled,
      (candidate) => {
        return candidate === bundled || candidate === 'C:\\Program Files\\nodejs\\npx.cmd';
      },
      ['C:\\Program Files\\nodejs']
    );

    expect(resolved).toBe('C:\\Program Files\\nodejs\\npx.cmd');
  });
});
