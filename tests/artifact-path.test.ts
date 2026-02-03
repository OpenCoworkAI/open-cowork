import { describe, it, expect } from 'vitest';
import { resolveArtifactPath } from '../src/renderer/utils/artifact-path';

describe('resolveArtifactPath', () => {
  it('maps /workspace paths to cwd', () => {
    const result = resolveArtifactPath('/workspace/out/report.txt', '/Users/demo/project');
    expect(result).toBe('/Users/demo/project/out/report.txt');
  });

  it('keeps absolute paths', () => {
    const result = resolveArtifactPath('/Users/demo/report.txt', '/Users/demo/project');
    expect(result).toBe('/Users/demo/report.txt');
  });

  it('resolves relative paths against cwd', () => {
    const result = resolveArtifactPath('report.txt', '/Users/demo/project');
    expect(result).toBe('/Users/demo/project/report.txt');
  });
});
