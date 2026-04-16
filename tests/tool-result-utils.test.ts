import { describe, expect, it } from 'vitest';
import {
  normalizeMcpToolResultForModel,
  normalizeToolExecutionResultForUi,
} from '../src/main/claude/tool-result-utils';

describe('tool result utils', () => {
  it('keeps screenshot metadata text while omitting image base64 from model context', () => {
    const base64Image = 'A'.repeat(2048);
    const result = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, path: '/tmp/screenshot.png' }, null, 2),
        },
        {
          type: 'image',
          data: base64Image,
          mimeType: 'image/png',
        },
      ],
    };

    const normalized = normalizeMcpToolResultForModel(result);

    expect(normalized.text).toContain('"success": true');
    expect(normalized.text).toContain('/tmp/screenshot.png');
    expect(normalized.text).not.toContain(base64Image);
    expect(normalized.images).toEqual([{ data: base64Image, mimeType: 'image/png' }]);
  });

  it('extracts tool result images into the dedicated ui field', () => {
    const base64Image = 'B'.repeat(1024);
    const result = {
      content: [{ type: 'text', text: 'Screenshot captured successfully' }],
      details: {
        openCoworkImages: [
          {
            data: base64Image,
            mimeType: 'image/png',
          },
        ],
      },
    };

    const normalized = normalizeToolExecutionResultForUi(result);

    expect(normalized.content).toBe('Screenshot captured successfully');
    expect(normalized.images).toEqual([{ data: base64Image, mimeType: 'image/png' }]);
  });

  it('keeps different images that share the same prefix and length', () => {
    const sharedPrefix = 'PREFIX'.repeat(20);
    const firstImage = `${sharedPrefix}${'X'.repeat(64)}`;
    const secondImage = `${sharedPrefix}${'Y'.repeat(64)}`;
    const result = {
      content: [{ type: 'text', text: 'Captured two screenshots' }],
      details: {
        openCoworkImages: [
          { data: firstImage, mimeType: 'image/png' },
          { data: secondImage, mimeType: 'image/png' },
        ],
      },
    };

    const normalized = normalizeToolExecutionResultForUi(result);

    expect(normalized.images).toEqual([
      { data: firstImage, mimeType: 'image/png' },
      { data: secondImage, mimeType: 'image/png' },
    ]);
  });

  it('redacts data urls and image payloads when stringifying fallback tool results', () => {
    const dataUrl = `data:image/png;base64,${'C'.repeat(512)}`;
    const result = {
      content: [
        {
          type: 'image_url',
          image_url: {
            url: dataUrl,
          },
        },
      ],
    };

    const normalized = normalizeToolExecutionResultForUi(result);

    expect(normalized.content).toContain('[image data URL omitted');
    expect(normalized.content).not.toContain(dataUrl);
  });
});
