import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/sandbox/sandbox-sync', () => ({
  SandboxSync: {
    getSession: (_sessionId: string) => ({
      sessionId: 'session-1',
      windowsPath: 'C:\\Project',
      sandboxPath: '/sandbox/session-1',
      distro: 'Ubuntu',
      initialized: true,
    }),
  },
}));

import { PathGuard } from '../src/main/sandbox/path-guard';

describe('PathGuard command path conversion', () => {
  it('preserves original case in converted Windows workspace-relative paths', () => {
    const command = 'type C:\\Project\\Docs\\ReadMe.md';
    const converted = PathGuard.convertPathInCommand(command, 'session-1', 'C:\\Project');

    expect(converted).toContain('/sandbox/session-1/Docs/ReadMe.md');
    expect(converted).not.toContain('/sandbox/session-1/docs/readme.md');
  });

  it('converts quoted Windows workspace-relative paths that contain spaces', () => {
    const command = 'type "C:\\Project\\Docs Folder\\Read Me.md"';
    const converted = PathGuard.convertPathInCommand(command, 'session-1', 'C:\\Project');

    expect(converted).toContain('"/sandbox/session-1/Docs Folder/Read Me.md"');
    expect(converted).not.toContain('"C:\\Project\\Docs Folder\\Read Me.md"');
  });
});
