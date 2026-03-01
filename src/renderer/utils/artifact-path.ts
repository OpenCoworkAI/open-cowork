export function resolveArtifactPath(pathValue: string, cwd?: string | null): string {
  if (!pathValue) {
    return pathValue;
  }

  if (/^(?:[A-Za-z]:\\|\\\\|\/)/.test(pathValue)) {
    if (pathValue.startsWith('/workspace/')) {
      const base = (cwd || '').replace(/[\\/]+$/, '');
      return base ? `${base}${pathValue.slice('/workspace'.length)}` : pathValue;
    }
    return pathValue;
  }

  const base = (cwd || '').replace(/[\\/]+$/, '');
  if (!base) {
    return pathValue;
  }
  return `${base}/${pathValue}`;
}
