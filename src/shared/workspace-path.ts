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

/**
 * Join base + relative path without Node.js `path` module (browser-safe).
 * Handles `.` and `..` segment normalization.
 */
function joinRelativePath(basePath: string, relativePath: string): string {
  const isWin = isWindowsDrivePath(basePath) || isUncPath(basePath);
  const sep = isWin ? '\\' : '/';

  const base = basePath.replace(/[/\\]+$/, '');
  const rel = relativePath.replace(/^[/\\]+/, '');
  const joined = `${base}${sep}${rel}`;

  // Normalize separators then resolve `.` / `..` segments
  const normalized = joined.replace(/[/\\]+/g, sep);
  const parts = normalized.split(sep);
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..' && resolved.length > 1) {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  return resolved.join(sep);
}
