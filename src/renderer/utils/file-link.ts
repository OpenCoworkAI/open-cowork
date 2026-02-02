export type FileTextPart =
  | { type: 'text'; value: string }
  | { type: 'file'; value: string };

const fileLinkButtonClassName =
  'text-accent hover:text-accent-hover underline underline-offset-2 text-left break-all inline-block';

export function getFileLinkButtonClassName(): string {
  return fileLinkButtonClassName;
}

const boundaryPattern = /[\s\]\[\(\)\{\}<>"'“”‘’。.,，、:;!?：；]/;
const asciiFilenamePattern = /[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]{1,8}/gi;
const cjkFilenamePattern = new RegExp(
  `(?:^|${boundaryPattern.source})([\\p{Script=Han}0-9_-]+\\.[A-Za-z0-9]{1,8})`,
  'gu',
);
const pathPattern = /(?:[A-Za-z]:\\|\/)[^\n]+?\.[a-z0-9]{1,8}/gi;

function isBoundaryChar(ch?: string): boolean {
  if (!ch) return true;
  return boundaryPattern.test(ch);
}

function tokenHasUrlPrefix(text: string, index: number): boolean {
  const tokenStart = text.lastIndexOf(' ', index) + 1;
  const token = text.slice(tokenStart, index);
  return /https?:\/\//i.test(token);
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[\]\[\(\)\{\}<>"'“”‘’。.,，、:;!?：；]+$/g, '');
}

function extensionHasLetter(value: string): boolean {
  const lastDot = value.lastIndexOf('.');
  if (lastDot === -1 || lastDot === value.length - 1) {
    return false;
  }
  const ext = value.slice(lastDot + 1);
  return /[a-z]/i.test(ext);
}

export function splitTextByFileMentions(text: string): FileTextPart[] {
  if (!text) {
    return [{ type: 'text', value: '' }];
  }

  const parts: FileTextPart[] = [];
  let cursor = 0;
  const matches: Array<{ index: number; value: string; source: 'path' | 'ascii' | 'cjk' }> = [];

  for (const match of text.matchAll(pathPattern)) {
    if (match.index === undefined) continue;
    matches.push({ index: match.index, value: match[0], source: 'path' });
  }

  for (const match of text.matchAll(asciiFilenamePattern)) {
    if (match.index === undefined) continue;
    matches.push({ index: match.index, value: match[0], source: 'ascii' });
  }

  for (const match of text.matchAll(cjkFilenamePattern)) {
    if (match.index === undefined || !match[1]) continue;
    const valueStart = match.index + match[0].length - match[1].length;
    matches.push({ index: valueStart, value: match[1], source: 'cjk' });
  }

  matches.sort((a, b) => a.index - b.index);

  for (const match of matches) {
    let value = match.value;
    const index = match.index;

    value = trimTrailingPunctuation(value);
    const prev = text[index - 1];
    const next = text[index + value.length];

    if (!isBoundaryChar(prev) || !isBoundaryChar(next)) {
      continue;
    }

    if (tokenHasUrlPrefix(text, index)) {
      continue;
    }

    if (!extensionHasLetter(value)) {
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
