import { describe, expect, it } from 'vitest';
import { ToolExecutor } from '../src/main/tools/tool-executor';
import { SandboxToolExecutor } from '../src/main/tools/sandbox-tool-executor';

const mockPathResolver = {
  getMounts: () => [{ real: '/tmp/project', virtual: '/workspace' }],
  resolve: () => null,
};

describe('tool executors treat UNC paths as absolute', () => {
  it('does not resolve UNC paths relative to the mounted workspace in ToolExecutor', () => {
    const executor = new ToolExecutor(mockPathResolver as any);
    expect(() =>
      (executor as any).resolveWorkspacePath('session-1', '\\\\server\\share\\report.txt')
    ).toThrow('Path is outside the mounted workspace');
  });

  it('does not resolve UNC paths relative to the mounted workspace in SandboxToolExecutor', () => {
    const executor = new SandboxToolExecutor(mockPathResolver as any, {} as any);
    expect(() =>
      (executor as any).resolveWorkspacePath('session-1', '\\\\server\\share\\report.txt')
    ).toThrow('Path is outside the mounted workspace');
  });
});
