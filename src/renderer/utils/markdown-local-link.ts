import { resolveArtifactPath } from './artifact-path';

const markdownInlineLinkPattern = /(?<!!)\[([^\]]+)\]\(\s*([\s\S]*?)\s*\)/g;
const windowsDrivePathPattern = /^[A-Za-z]:[\\/]/;
const uncPathPattern = /^\\\\[^\\]/;
const unixAbsolutePathPattern = /^\//;
const webLikeUrlPattern = /^(?:https?:\/\/|mailto:|file:\/\/|#)/i;
const httpLikeUrlPattern = /^(?:https?:\/\/|mailto:|#)/i;
const explicitUrlSchemePattern = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function normalizePathCandidate(value: string): string {
  return value.replace(/\r/g, '').replace(/\n+/g, '').trim();
}

function encodeFilePath(pathValue: string): string {
  return encodeURI(pathValue).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

function toFileUrl(pathValue: string): string | null {
  const normalizedPathValue = normalizePathCandidate(pathValue);
  if (!normalizedPathValue) {
    return null;
  }

  if (webLikeUrlPattern.test(normalizedPathValue)) {
    return null;
  }

  if (unixAbsolutePathPattern.test(normalizedPathValue)) {
    return `file://${encodeFilePath(normalizedPathValue)}`;
  }

  if (windowsDrivePathPattern.test(normalizedPathValue)) {
    const normalized = normalizedPathValue.replace(/\\/g, '/');
    return `file:///${encodeFilePath(normalized)}`;
  }

  if (uncPathPattern.test(normalizedPathValue)) {
    const normalized = normalizedPathValue.replace(/^\\\\+/, '').replace(/\\/g, '/');
    return `file://${encodeFilePath(normalized)}`;
  }

  return null;
}

export function normalizeLocalFileMarkdownLinks(markdown: string): string {
  if (!markdown) {
    return markdown;
  }

  return markdown.replace(markdownInlineLinkPattern, (full, label: string, rawHref: string) => {
    const href = rawHref.trim();
    if (!href) {
      return full;
    }

    const fileUrl = toFileUrl(href);
    if (!fileUrl) {
      return full;
    }

    return `[${label}](${fileUrl})`;
  });
}

function decodePathSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractLocalFilePathFromHref(href?: string): string | null {
  if (!href) {
    return null;
  }

  const trimmed = normalizePathCandidate(href);
  if (!trimmed || httpLikeUrlPattern.test(trimmed)) {
    return null;
  }

  if (trimmed.startsWith('file://')) {
    try {
      const url = new URL(trimmed);
      const pathname = decodePathSafely(url.pathname || '');
      if (!pathname) {
        return null;
      }

      if (/^\/[A-Za-z]:\//.test(pathname)) {
        return pathname.slice(1);
      }

      return pathname;
    } catch {
      const fallback = trimmed.replace(/^file:\/\//i, '');
      return decodePathSafely(fallback) || null;
    }
  }

  if (unixAbsolutePathPattern.test(trimmed) || windowsDrivePathPattern.test(trimmed) || uncPathPattern.test(trimmed)) {
    return decodePathSafely(trimmed);
  }

  return null;
}

export function resolveLocalFilePathFromHref(href: string | undefined, cwd?: string | null): string | null {
  if (!href) {
    return null;
  }

  const trimmed = normalizePathCandidate(href);
  if (!trimmed || httpLikeUrlPattern.test(trimmed)) {
    return null;
  }

  const extractedPath = extractLocalFilePathFromHref(trimmed);
  if (extractedPath) {
    return resolveArtifactPath(extractedPath, cwd);
  }

  if (explicitUrlSchemePattern.test(trimmed)) {
    return null;
  }

  return resolveArtifactPath(decodePathSafely(trimmed), cwd);
}
