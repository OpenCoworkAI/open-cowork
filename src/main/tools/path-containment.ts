export function normalizePathForContainment(pathValue: string, caseInsensitive = false): string {
  let normalized = pathValue
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '');

  if (!normalized) {
    return '';
  }

  // Resolve . and .. components to prevent path traversal
  const parts = normalized.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..' && resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  normalized = resolved.join('/') || (normalized.startsWith('/') ? '/' : '.');

  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

export function isPathWithinRoot(
  targetPath: string,
  rootPath: string,
  caseInsensitive = false
): boolean {
  const normalizedTarget = normalizePathForContainment(targetPath, caseInsensitive);
  const normalizedRoot = normalizePathForContainment(rootPath, caseInsensitive);

  if (!normalizedTarget || !normalizedRoot) {
    return false;
  }

  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}
