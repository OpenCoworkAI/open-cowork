export function isScreenInterpretationPrompt(prompt: string): boolean {
  const text = (prompt || '').trim().toLowerCase();
  if (!text) {
    return false;
  }

  const hasScreenshotIntent =
    /截图|屏幕截图|截屏|screenshot|screen capture|capture (the )?screen/.test(text);
  if (!hasScreenshotIntent) {
    return false;
  }

  const hasInterpretIntent =
    /解读|解释|分析|描述|识别|interpret|describe|analy[sz]e|read/.test(text);
  const hasScreenInfoIntent = /屏幕信息|screen info|screen state|当前屏幕/.test(text);
  return hasInterpretIntent || hasScreenInfoIntent;
}

export function buildScreenInterpretVisionQuestion(prompt: string): string {
  const raw = (prompt || '').replace(/\s+/g, ' ').trim();
  const fallback = '请详细解读当前屏幕内容，包括窗口、关键文本、状态提示、错误信息与下一步建议。';
  if (!raw) {
    return fallback;
  }
  return [
    '请详细解读当前屏幕内容，包括：',
    '1. 当前可见的应用或窗口',
    '2. 关键文本和按钮',
    '3. 是否有错误、异常或权限提示',
    '4. 最值得执行的下一步建议',
    '',
    `用户原始请求：${raw}`,
  ].join('\n');
}
