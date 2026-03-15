import path from 'node:path';
import { isUncPath, isWindowsDrivePath } from './local-file-path';

export function resolvePathAgainstWorkspace(
  pathValue: string,
  workspacePath?: string | null
): string {
  if (!pathValue) {
    return pathValue;
  }

  if (isWindowsDrivePath(pathValue) || isUncPath(pathValue) || pathValue.startsWith('/')) {
    if (pathValue.startsWith('/workspace/')) {
      return workspacePath
        ? joinRelativePath(workspacePath, pathValue.slice('/workspace/'.length))
        : pathValue;
    }
    if (/^[A-Za-z]:[/\\]workspace[/\\]/i.test(pathValue)) {
      const relativePart = pathValue.replace(/^[A-Za-z]:[/\\]workspace[/\\]/i, '');
      return workspacePath ? joinRelativePath(workspacePath, relativePart) : pathValue;
    }
    return pathValue;
  }

  if (!workspacePath) {
    return pathValue;
  }

  return joinRelativePath(workspacePath, pathValue);
}

function joinRelativePath(basePath: string, relativePath: string): string {
  if (isWindowsDrivePath(basePath) || isUncPath(basePath)) {
    return path.win32.resolve(basePath, relativePath);
  }

  return path.posix.resolve(basePath.replace(/\\/g, '/'), relativePath.replace(/\\/g, '/'));
}
