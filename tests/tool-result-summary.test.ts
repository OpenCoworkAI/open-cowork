import { describe, it, expect } from 'vitest';
import { shouldUseScreenshotSummary } from '../src/renderer/utils/tool-result-summary';

describe('shouldUseScreenshotSummary', () => {
  it('does not classify generic command output as screenshot by keyword alone', () => {
    const content = [
      '# Superpowers Bootstrap for Codex',
      'Available skills:',
      '- screenshot',
      '- browser',
    ].join('\n');

    expect(shouldUseScreenshotSummary('Bash', content)).toBe(false);
  });

  it('classifies screenshot tool outputs as screenshot', () => {
    expect(shouldUseScreenshotSummary('mcp__gui__screenshot_for_display', 'ok')).toBe(true);
    expect(shouldUseScreenshotSummary('mcp__chrome__take_screenshot', 'done')).toBe(true);
  });

  it('classifies explicit screenshot success phrases', () => {
    expect(shouldUseScreenshotSummary('Bash', 'Screenshot saved to /tmp/a.png')).toBe(true);
    expect(shouldUseScreenshotSummary(undefined, 'captured screenshot successfully')).toBe(true);
  });
});
