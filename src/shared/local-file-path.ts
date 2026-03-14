const windowsDrivePathPattern = /^[A-Za-z]:[\\/]/;
const uncPathPattern = /^\\\\[^\\]/;

export function decodePathSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isWindowsDrivePath(value: string): boolean {
  return windowsDrivePathPattern.test(value);
}

export function isUncPath(value: string): boolean {
  return uncPathPattern.test(value);
}

export function localPathFromFileUrl(fileUrl: string): string | null {
  if (!fileUrl || !fileUrl.startsWith('file://')) {
    return null;
  }

  try {
    const url = new URL(fileUrl);
    const pathname = decodePathSafely(url.pathname || '');
    const hostname = decodePathSafely(url.hostname || '');

    if (hostname && hostname.toLowerCase() !== 'localhost') {
      const normalizedPathname = pathname.replace(/\//g, '\\');
      return `\\\\${hostname}${normalizedPathname}`;
    }

    if (!pathname) {
      return null;
    }

    if (/^\/[A-Za-z]:\//.test(pathname)) {
      return pathname.slice(1);
    }

    return pathname;
  } catch {
    const fallback = decodePathSafely(fileUrl.replace(/^file:\/\//i, ''));
    if (!fallback) {
      return null;
    }

    if (fallback.toLowerCase().startsWith('localhost/')) {
      return fallback.slice('localhost'.length);
    }

    if (fallback.startsWith('//')) {
      return `\\\\${fallback.slice(2).replace(/\//g, '\\')}`;
    }

    return fallback;
  }
}

export function localPathFromAppUrlPathname(pathname: string): string | null {
  const decodedPathname = decodePathSafely(pathname || '');
  if (!decodedPathname) {
    return null;
  }

  if (/^\/[A-Za-z]:\//.test(decodedPathname)) {
    return decodedPathname.slice(1);
  }

  if (/^\/\/[^/]+\/.+/.test(decodedPathname)) {
    return `\\\\${decodedPathname.slice(2).replace(/\//g, '\\')}`;
  }

  if (/^\/(?:Users|home|opt|tmp|var|Volumes|mnt)\//.test(decodedPathname)) {
    return decodedPathname;
  }

  return null;
}
