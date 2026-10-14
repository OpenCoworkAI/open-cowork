export { DEFAULT_SESSION_TITLE, getDefaultTitleFromPrompt } from '../../shared/session-title';
import { DEFAULT_SESSION_TITLE, getDefaultTitleFromPrompt } from '../../shared/session-title';

export type TitleDecisionInput = {
  userMessageCount: number;
  currentTitle: string;
  prompt: string;
  hasAttempted: boolean;
};

export function shouldGenerateTitle(input: TitleDecisionInput): boolean {
  if (input.hasAttempted) return false;
  if (input.userMessageCount !== 1) return false;
  const defaultTitle = getDefaultTitleFromPrompt(input.prompt);
  return input.currentTitle === defaultTitle || input.currentTitle === DEFAULT_SESSION_TITLE;
}

// The model self-identifies its answer as `TITLE:: <title>`. The gateway inlines
// chain-of-thought into the content, so read the text after the last marker and
// ignore whatever precedes it; fall back to the first non-empty line when the
// marker is absent.
const TITLE_MARKER_RE = /TITLE::?[ \t]*([^\r\n]*)/gi;

export function normalizeGeneratedTitle(value: string | null | undefined): string | null {
  if (!value) return null;

  const marked = [...value.matchAll(TITLE_MARKER_RE)].pop()?.[1]?.trim();
  const candidate =
    marked ||
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ||
    '';

  const normalized = candidate.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!normalized) return null;
  if (
    normalized.toLowerCase() === '(no content)' ||
    normalized.toLowerCase() === '(empty content)'
  ) {
    return null;
  }
  return normalized.slice(0, 120);
}

export function buildTitlePrompt(prompt: string): string {
  return [
    'Generate a short title for the following user request. Rules:',
    '- Max 15 characters (Chinese) or 6 words (English)',
    '- Reply in the same language as the user request',
    '- No quotes, numbering, or punctuation at the end',
    '- Output format (strict): a single line "TITLE:: <title>" and nothing else',
    '',
    '请根据用户请求生成一个简短的对话标题：',
    '- 不超过15个字',
    '- 同语言输出',
    '- 不要加引号或编号',
    '- 输出格式（严格）：只输出一行 "TITLE:: <标题>"，不要输出任何其它内容',
    '',
    `User request / 用户请求：${prompt.trim()}`,
  ].join('\n');
}
