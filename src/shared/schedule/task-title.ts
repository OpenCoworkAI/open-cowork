const SCHEDULE_TITLE_PREFIX = '[Scheduled Task]';
const EMPTY_TITLE_FALLBACK = 'Untitled Task';
const DEFAULT_SUMMARY_MAX_LENGTH = 48;
const PREFIX_PATTERN = /^\s*\[Scheduled Task\]\s*/;

function normalizeTitlePart(value: string): string {
  return value
    .trim()
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function stripSchedulePrefix(value: string): string {
  return value.replace(PREFIX_PATTERN, '').trim();
}

export function summarizeSchedulePrompt(
  prompt: string,
  maxLength: number = DEFAULT_SUMMARY_MAX_LENGTH
): string {
  const normalizedPrompt = normalizeTitlePart(prompt);
  if (!normalizedPrompt) {
    return EMPTY_TITLE_FALLBACK;
  }
  if (!Number.isFinite(maxLength) || maxLength <= 0) {
    return normalizedPrompt;
  }
  if (normalizedPrompt.length <= maxLength) {
    return normalizedPrompt;
  }
  return `${normalizedPrompt.slice(0, Math.max(1, maxLength - 3))}...`;
}

export function buildScheduledTaskTitle(titleOrSummary: string): string {
  const normalized = normalizeTitlePart(stripSchedulePrefix(titleOrSummary));
  const summary = normalized || EMPTY_TITLE_FALLBACK;
  return `${SCHEDULE_TITLE_PREFIX} ${summary}`;
}

export function buildScheduledTaskFallbackTitle(prompt: string): string {
  return buildScheduledTaskTitle(summarizeSchedulePrompt(prompt));
}
