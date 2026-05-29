// NOTE: This module is bundled into the in-VM Lima agent and therefore cannot
// import from `src/shared/`. The Windows drive and UNC regex helpers are
// inlined here on purpose to keep the agent bundle self-contained.
const windowsDrivePathPattern = /^[A-Za-z]:[\\/]/;
const uncPathPattern = /^\\\\[^\\]/;

function isWindowsDrivePath(value: string): boolean {
  return windowsDrivePathPattern.test(value);
}

function isUncPath(value: string): boolean {
  return uncPathPattern.test(value);
}

type CanonicalPathKind = 'posix' | 'windows' | 'unc';

interface CanonicalPath {
  kind: CanonicalPathKind;
  root: string;
  segments: string[];
}

export function normalizePathForContainment(pathValue: string, caseInsensitive = false): string {
  const normalized = pathValue.replace(/[\\/]+/g, '/').replace(/\/+$/, '');

  if (!normalized) {
    return pathValue.includes('/') || pathValue.includes('\\') ? '/' : '';
  }

  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

function normalizeSegment(segment: string, caseInsensitive: boolean): string {
  return caseInsensitive ? segment.toLowerCase() : segment;
}

function resolveSegments(pathValue: string, caseInsensitive: boolean): string[] {
  const segments = pathValue.split(/[\\/]+/).filter(Boolean);
  const resolved: string[] = [];

  for (const segment of segments) {
    if (segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (resolved.length > 0) {
        resolved.pop();
      }
      continue;
    }

    resolved.push(normalizeSegment(segment, caseInsensitive));
  }

  return resolved;
}

function canonicalizePath(pathValue: string, caseInsensitive: boolean): CanonicalPath | null {
  if (!pathValue) {
    return null;
  }

  // Defense in depth: reject paths containing null bytes which can be used to
  // truncate strings in downstream OS APIs.
  if (pathValue.includes('\x00')) {
    return null;
  }

  if (isWindowsDrivePath(pathValue)) {
    const drive = normalizeSegment(pathValue.slice(0, 2), caseInsensitive);
    return {
      kind: 'windows',
      root: drive,
      segments: resolveSegments(pathValue.slice(2), caseInsensitive),
    };
  }

  if (isUncPath(pathValue) || /^\/\/[^/]+\/+[^/]+/.test(pathValue)) {
    const normalized = pathValue.replace(/\\/g, '/');
    const uncMatch = normalized.match(/^\/\/([^/]+)\/+([^/]+)(.*)$/);
    if (!uncMatch) {
      return null;
    }

    const [, host, share, rest = ''] = uncMatch;
    return {
      kind: 'unc',
      root: `//${normalizeSegment(host, caseInsensitive)}/${normalizeSegment(share, caseInsensitive)}`,
      segments: resolveSegments(rest, caseInsensitive),
    };
  }

  if (pathValue.startsWith('/') || pathValue.startsWith('\\')) {
    return {
      kind: 'posix',
      root: '/',
      segments: resolveSegments(pathValue, caseInsensitive),
    };
  }

  return null;
}

export function isPathWithinRoot(
  targetPath: string,
  rootPath: string,
  caseInsensitive = false
): boolean {
  const normalizedTarget = canonicalizePath(targetPath, caseInsensitive);
  const normalizedRoot = canonicalizePath(rootPath, caseInsensitive);

  if (!normalizedTarget || !normalizedRoot) {
    return false;
  }

  if (
    normalizedTarget.kind !== normalizedRoot.kind ||
    normalizedTarget.root !== normalizedRoot.root
  ) {
    return false;
  }

  if (normalizedRoot.segments.length > normalizedTarget.segments.length) {
    return false;
  }

  return normalizedRoot.segments.every(
    (segment, index) => normalizedTarget.segments[index] === segment
  );
}
