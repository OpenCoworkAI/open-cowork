import { describe, expect, it, vi } from 'vitest';

vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import {
  detectImageMediaType,
  parseFeishuMessageContent,
  resolveFeishuRemoteContent,
} from '../../main/remote/channels/feishu/feishu-message-content';

/** 1x1 transparent PNG */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('parseFeishuMessageContent', () => {
  it('parses webhook and WebSocket image payloads into the same imageKey contract', () => {
    const webhookMessage = {
      message_id: 'om_img',
      chat_id: 'oc_chat',
      message_type: 'image',
      content: JSON.stringify({ image_key: 'img_v2_repro' }),
    };
    const websocketMessage = {
      message_type: 'image',
      content: '{"image_key":"img_v2_repro"}',
    };

    expect(parseFeishuMessageContent(webhookMessage)).toEqual({
      type: 'image',
      imageKey: 'img_v2_repro',
    });
    expect(parseFeishuMessageContent(websocketMessage)).toEqual({
      type: 'image',
      imageKey: 'img_v2_repro',
    });
  });

  it('parses an already-decoded content object', () => {
    expect(
      parseFeishuMessageContent({
        message_type: 'image',
        content: { image_key: 'img_v2_repro' },
      })
    ).toEqual({
      type: 'image',
      imageKey: 'img_v2_repro',
    });
  });

  it('preserves file.key and voice.key', () => {
    expect(
      parseFeishuMessageContent({
        message_type: 'file',
        content: JSON.stringify({
          file_name: 'report.pdf',
          file_key: 'file_v2_repro',
          file_size: 42,
        }),
      })
    ).toEqual({
      type: 'file',
      file: { name: 'report.pdf', key: 'file_v2_repro', size: 42 },
    });

    expect(
      parseFeishuMessageContent({
        message_type: 'audio',
        content: JSON.stringify({ file_key: 'voice_v2_repro', duration: 12 }),
      })
    ).toEqual({
      type: 'voice',
      voice: { key: 'voice_v2_repro', duration: 12 },
    });
  });

  it('returns null for invalid JSON content', () => {
    expect(
      parseFeishuMessageContent({
        message_type: 'image',
        content: 'not-json',
      })
    ).toBeNull();
  });
});

describe('resolveFeishuRemoteContent', () => {
  it('downloads imageKey into base64 image data', async () => {
    const downloadImage = vi.fn(async () => PNG_1X1);
    const resolved = await resolveFeishuRemoteContent(
      { type: 'image', imageKey: 'img_v2_repro' },
      downloadImage
    );

    expect(downloadImage).toHaveBeenCalledWith('img_v2_repro');
    expect(resolved).toEqual({
      type: 'image',
      imageKey: 'img_v2_repro',
      imageBase64: PNG_1X1.toString('base64'),
      imageMediaType: 'image/png',
    });
  });

  it('leaves imageKey unresolved when download fails', async () => {
    const resolved = await resolveFeishuRemoteContent(
      { type: 'image', imageKey: 'img_v2_repro' },
      async () => {
        throw new Error('Failed to download image: Not Found');
      }
    );

    expect(resolved).toEqual({ type: 'image', imageKey: 'img_v2_repro' });
    expect(resolved.imageBase64).toBeUndefined();
  });

  it('leaves imageKey unresolved for unsupported binary formats', async () => {
    const resolved = await resolveFeishuRemoteContent(
      { type: 'image', imageKey: 'img_v2_repro' },
      async () => Buffer.from('not-an-image')
    );

    expect(resolved.imageBase64).toBeUndefined();
    expect(detectImageMediaType(Buffer.from('not-an-image'))).toBeUndefined();
  });
});
