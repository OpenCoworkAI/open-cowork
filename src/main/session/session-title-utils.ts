export type TitleDecisionInput = {
  userMessageCount: number;
  currentTitle: string;
  prompt: string;
  hasAttempted: boolean;
};

export function getDefaultTitleFromPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return 'New Session';
  return trimmed.length > 50 ? `${trimmed.slice(0, 50)}...` : trimmed;
}

export function shouldGenerateTitle(input: TitleDecisionInput): boolean {
  if (input.hasAttempted) return false;
  if (input.userMessageCount !== 1) return false;
  const defaultTitle = getDefaultTitleFromPrompt(input.prompt);
  return input.currentTitle === defaultTitle || input.currentTitle === 'New Session';
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
