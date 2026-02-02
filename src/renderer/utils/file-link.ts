export type FileTextPart =
  | { type: 'text'; value: string }
  | { type: 'file'; value: string };

const fileLinkButtonClassName =
  'text-accent hover:text-accent-hover underline underline-offset-2 text-left break-all inline-block';

export function getFileLinkButtonClassName(): string {
  return fileLinkButtonClassName;
}

const filenamePattern = /[^\s/\\]+\.[a-z0-9]{1,8}/gi;
const pathPattern = /(?:[A-Za-z]:\\|\/)[^\n]+?\.[a-z0-9]{1,8}/gi;

function isBoundaryChar(ch?: string): boolean {
  if (!ch) return true;
  return /[\s\]\[\(\)\{\}<>"'“”‘’。.,，、:;!?：；]/.test(ch);
}

function tokenHasUrlPrefix(text: string, index: number): boolean {
  const tokenStart = text.lastIndexOf(' ', index) + 1;
  const token = text.slice(tokenStart, index);
  return /https?:\/\//i.test(token);
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[\]\[\(\)\{\}<>"'“”‘’。.,，、:;!?：；]+$/g, '');
}

export function splitTextByFileMentions(text: string): FileTextPart[] {
  if (!text) {
    return [{ type: 'text', value: '' }];
  }

  const parts: FileTextPart[] = [];
  let cursor = 0;
  const combined = new RegExp(`${pathPattern.source}|${filenamePattern.source}`, 'gi');

  for (const match of text.matchAll(combined)) {
    let value = match[0];
    const index = match.index ?? 0;

    value = trimTrailingPunctuation(value);
    const prev = text[index - 1];
    const next = text[index + value.length];

    if (!isBoundaryChar(prev) || !isBoundaryChar(next)) {
      continue;
    }

    if (tokenHasUrlPrefix(text, index)) {
      continue;
    }

    if (index > cursor) {
      parts.push({ type: 'text', value: text.slice(cursor, index) });
    }

    parts.push({ type: 'file', value });
    cursor = index + value.length;
  }

  if (cursor < text.length) {
    parts.push({ type: 'text', value: text.slice(cursor) });
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', value: text });
  }

  return parts;
}
