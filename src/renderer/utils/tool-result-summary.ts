const screenshotSuccessPattern =
  /\b(?:screenshot\s+(?:saved|captured)|saved\s+screenshot|captured\s+screenshot)\b/i;
const omittedImageOutputPattern =
  /^\[(?:1 image output|\d+ image outputs) omitted from text context\]$/i;
const emptyOutputPattern = /^\(no output\)$/i;

function isScreenshotToolName(toolName?: string): boolean {
  if (!toolName) {
    return false;
  }
  const lower = toolName.toLowerCase();
  if (lower.endsWith('__screenshot_for_display')) {
    return true;
  }
  return /(?:^|__|_)(?:screenshot|take_screenshot|capture_screenshot)(?:$|__|_)/.test(lower);
}

export function shouldUseScreenshotSummary(toolName: string | undefined, content: string): boolean {
  if (isScreenshotToolName(toolName)) {
    return true;
  }
  return screenshotSuccessPattern.test(content);
}

export function shouldPreferToolResultImages(
  toolName: string | undefined,
  content: string,
  hasImages: boolean,
  isError = false
): boolean {
  if (isError || !hasImages) {
    return false;
  }

  const normalized = content.trim();
  if (shouldUseScreenshotSummary(toolName, normalized)) {
    return true;
  }

  return omittedImageOutputPattern.test(normalized) || emptyOutputPattern.test(normalized);
}

export function shouldRenderToolResultText(
  toolName: string | undefined,
  content: string,
  hasImages: boolean,
  isError = false
): boolean {
  if (!content.trim()) {
    return false;
  }

  return !shouldPreferToolResultImages(toolName, content, hasImages, isError);
}
