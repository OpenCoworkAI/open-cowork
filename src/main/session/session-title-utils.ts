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
    '',
    '- 15',
    '- ',
    '- ',
    '',
    `${prompt.trim()}`,
  ].join('\n');
}
