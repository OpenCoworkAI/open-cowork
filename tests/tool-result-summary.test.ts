import { describe, it, expect } from 'vitest';
import {
  shouldPreferToolResultImages,
  shouldRenderToolResultText,
  shouldUseScreenshotSummary,
} from '../src/renderer/utils/tool-result-summary';

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

  it('prefers image-first output for screenshot tool results with images', () => {
    expect(
      shouldPreferToolResultImages(
        'mcp__gui__screenshot_for_display',
        '{\n  "path": "/tmp/screenshot.png"\n}',
        true
      )
    ).toBe(true);
    expect(
      shouldRenderToolResultText(
        'mcp__gui__screenshot_for_display',
        '{\n  "path": "/tmp/screenshot.png"\n}',
        true
      )
    ).toBe(false);
  });

  it('hides placeholder text when image payload is already available', () => {
    expect(
      shouldPreferToolResultImages(undefined, '[1 image output omitted from text context]', true)
    ).toBe(true);
    expect(
      shouldRenderToolResultText(undefined, '[1 image output omitted from text context]', true)
    ).toBe(false);
  });

  it('keeps text output for non-screenshot tools with meaningful text', () => {
    expect(shouldPreferToolResultImages('read', 'OCR extracted text', true)).toBe(false);
    expect(shouldRenderToolResultText('read', 'OCR extracted text', true)).toBe(true);
  });
});
