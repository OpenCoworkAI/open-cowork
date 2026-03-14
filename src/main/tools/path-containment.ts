export function normalizePathForContainment(pathValue: string, caseInsensitive = false): string {
  const normalized = pathValue
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '');

  if (!normalized) {
    return '';
  }

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
