import path from 'node:path';

export function normalizePathForContainment(pathValue: string, caseInsensitive = false): string {
  const normalized = pathValue
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '');

  if (!normalized) {
    return pathValue.includes('/') || pathValue.includes('\\') ? '/' : '';
  }

  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

export function isPathWithinRoot(
  targetPath: string,
  rootPath: string,
  caseInsensitive = false
): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(rootPath);

  const normalizedTarget = normalizePathForContainment(resolvedTarget, caseInsensitive);
  const normalizedRoot = normalizePathForContainment(resolvedRoot, caseInsensitive);

  if (!normalizedTarget || !normalizedRoot) {
    return false;
  }

  const relativePath = path.relative(normalizedRoot, normalizedTarget);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}
