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

  it('keeps Windows absolute paths that use forward slashes', () => {
    const result = resolveArtifactPath('C:/Users/demo/report.txt', 'C:/Users/demo/project');
    expect(result).toBe('C:/Users/demo/report.txt');
  });

  it('keeps UNC paths absolute', () => {
    const result = resolveArtifactPath('\\\\server\\share\\report.txt', 'C:/Users/demo/project');
    expect(result).toBe('\\\\server\\share\\report.txt');
  });

  it('resolves relative paths against cwd', () => {
    const result = resolveArtifactPath('report.txt', '/Users/demo/project');
    expect(result).toBe('/Users/demo/project/report.txt');
  });

  it('resolves relative paths against Windows cwd without treating the drive path as relative', () => {
    const result = resolveArtifactPath('reports/summary.txt', 'C:\\workspace');
    expect(result).toBe('C:\\workspace\\reports\\summary.txt');
  });
});
