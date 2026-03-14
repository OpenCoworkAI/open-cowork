import { describe, expect, it } from 'vitest';
import { getUnsupportedWorkspacePathReason } from '../src/main/workspace-path-constraints';

describe('getUnsupportedWorkspacePathReason', () => {
  it('blocks UNC workspaces on Windows when sandbox mode is enabled', () => {
    expect(
      getUnsupportedWorkspacePathReason({
        platform: 'win32',
        sandboxEnabled: true,
        workspacePath: '\\\\server\\share\\workspace',
      })
    ).toContain('Windows network share folders are not supported');
  });

  it('allows UNC workspaces when sandbox mode is disabled', () => {
    expect(
      getUnsupportedWorkspacePathReason({
        platform: 'win32',
        sandboxEnabled: false,
        workspacePath: '\\\\server\\share\\workspace',
      })
    ).toBeNull();
  });

  it('allows local drive workspaces on Windows with sandbox enabled', () => {
    expect(
      getUnsupportedWorkspacePathReason({
        platform: 'win32',
        sandboxEnabled: true,
        workspacePath: 'C:\\workspace',
      })
    ).toBeNull();
  });
});
