import { resolveArtifactPath } from './artifact-path';
import {
  decodePathSafely,
  isUncPath,
  isWindowsDrivePath,
  localPathFromFileUrl,
} from '../../shared/local-file-path';

const markdownInlineLinkPattern = /(?<!!)\[([^\]]+)\]\(\s*([\s\S]*?)\s*\)/g;
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

  if (isWindowsDrivePath(normalizedPathValue)) {
    const normalized = normalizedPathValue.replace(/\\/g, '/');
    return `file:///${encodeFilePath(normalized)}`;
  }

  if (isUncPath(normalizedPathValue)) {
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

export function extractLocalFilePathFromHref(href?: string): string | null {
  if (!href) {
    return null;
  }

  const trimmed = normalizePathCandidate(href);
  if (!trimmed || httpLikeUrlPattern.test(trimmed)) {
    return null;
  }

  if (trimmed.startsWith('file://')) {
    return localPathFromFileUrl(trimmed);
  }

  if (unixAbsolutePathPattern.test(trimmed) || isWindowsDrivePath(trimmed) || isUncPath(trimmed)) {
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
