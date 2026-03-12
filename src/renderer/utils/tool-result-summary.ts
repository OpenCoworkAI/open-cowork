const screenshotSuccessPattern = /\b(?:screenshot\s+(?:saved|captured)|saved\s+screenshot|captured\s+screenshot)\b/i;

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
