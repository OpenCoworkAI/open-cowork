export const DEFAULT_SESSION_TITLE = 'New Session';
const MAX_SESSION_TITLE_LENGTH = 50;

function truncateSessionTitle(value: string): string {
  return value.length > MAX_SESSION_TITLE_LENGTH
    ? `${value.slice(0, MAX_SESSION_TITLE_LENGTH)}...`
    : value;
}

export function getDefaultTitleFromPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return DEFAULT_SESSION_TITLE;
  return truncateSessionTitle(trimmed);
}

export function getInitialSessionTitle(prompt: string, firstAttachmentName?: string | null): string {
  const promptTitle = getDefaultTitleFromPrompt(prompt);
  if (promptTitle !== DEFAULT_SESSION_TITLE) {
    return promptTitle;
  }

  const attachmentName = firstAttachmentName?.trim();
  if (attachmentName) {
    return truncateSessionTitle(attachmentName);
  }

  return DEFAULT_SESSION_TITLE;
}
