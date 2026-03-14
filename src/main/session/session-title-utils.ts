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

export function normalizeGeneratedTitle(value: string | null | undefined): string | null {
  if (!value) return null;
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;
  const normalized = firstLine.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!normalized) return null;
  if (normalized.toLowerCase() === '(no content)' || normalized.toLowerCase() === '(empty content)') {
    return null;
  }
  return normalized.slice(0, 120);
}

export function buildTitlePrompt(prompt: string): string {
  return [
    '请根据用户请求生成一个简短的对话标题：',
    '- 标题不超过15个字',
    '- 同语言输出',
    '- 不要加引号或编号',
    '',
    `用户请求：${prompt.trim()}`,
  ].join('\n');
}
