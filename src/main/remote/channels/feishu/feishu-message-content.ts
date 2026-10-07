/**
 * Shared Feishu inbound content parsing and image resolution.
 * Used by both webhook and WebSocket receive paths.
 */

import { log, logError } from '../../../utils/logger';
import type { RemoteContent } from '../../types';
import type { ImageContent } from '../../../../renderer/types/index';

export type FeishuImageMediaType = ImageContent['source']['media_type'];
export type FeishuImageDownloader = (imageKey: string) => Promise<Buffer>;

/** Claude/provider base64 image payloads are limited; reject oversized downloads explicitly. */
export const FEISHU_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function parseFeishuMessageContent(message: Record<string, unknown>): RemoteContent | null {
  const msgType = message.message_type as string;

  try {
    const contentJson = parseFeishuContentPayload(message.content);

    switch (msgType) {
      case 'text':
        return {
          type: 'text',
          text: contentJson.text as string | undefined,
        };

      case 'image':
        return {
          type: 'image',
          imageKey: asOptionalString(contentJson.image_key),
        };

      case 'file':
        return {
          type: 'file',
          file: {
            name: String(contentJson.file_name ?? ''),
            key: asOptionalString(contentJson.file_key),
            size: typeof contentJson.file_size === 'number' ? contentJson.file_size : undefined,
          },
        };

      case 'audio':
        return {
          type: 'voice',
          voice: {
            key: asOptionalString(contentJson.file_key),
            duration: typeof contentJson.duration === 'number' ? contentJson.duration : undefined,
          },
        };

      case 'post':
        return {
          type: 'rich_text',
          text: extractTextFromPost(contentJson),
          richText: contentJson,
        };

      case 'interactive':
        return {
          type: 'interactive',
          interactive: contentJson,
        };

      default:
        log('[Feishu] Unknown message type:', msgType);
        return {
          type: 'text',
          text: `[不支持的消息类型: ${msgType}]`,
        };
    }
  } catch (error) {
    logError('[Feishu] Failed to parse message content:', error);
    return null;
  }
}

/**
 * Download a Feishu imageKey into agent-ready base64 when possible.
 * On failure the content stays `type: "image"` with `imageKey` so the router
 * can return an explicit download-failed notice instead of a generic prompt.
 */
export async function resolveFeishuRemoteContent(
  content: RemoteContent,
  downloadImage: FeishuImageDownloader
): Promise<RemoteContent> {
  if (content.type !== 'image') {
    return content;
  }
  if (content.imageBase64 && content.imageMediaType) {
    return content;
  }
  if (!content.imageKey) {
    return content;
  }

  try {
    const buffer = await downloadImage(content.imageKey);
    if (!buffer || buffer.length === 0) {
      logError('[Feishu] Downloaded image was empty:', content.imageKey);
      return content;
    }
    if (buffer.length > FEISHU_MAX_IMAGE_BYTES) {
      logError('[Feishu] Downloaded image exceeds size limit:', {
        imageKey: content.imageKey,
        bytes: buffer.length,
      });
      return content;
    }

    const mediaType = detectImageMediaType(buffer);
    if (!mediaType) {
      logError('[Feishu] Downloaded image has unsupported format:', content.imageKey);
      return content;
    }

    return {
      ...content,
      imageBase64: buffer.toString('base64'),
      imageMediaType: mediaType,
    };
  } catch (error) {
    logError('[Feishu] Failed to download image:', content.imageKey, error);
    return content;
  }
}

export function detectImageMediaType(buffer: Buffer): FeishuImageMediaType | undefined {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return undefined;
}

function parseFeishuContentPayload(content: unknown): Record<string, unknown> {
  if (typeof content === 'string') {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Feishu message content JSON must be an object');
    }
    return parsed as Record<string, unknown>;
  }
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    return content as Record<string, unknown>;
  }
  throw new Error('Invalid Feishu message content');
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function extractTextFromPost(post: Record<string, unknown>): string {
  const texts: string[] = [];

  try {
    const zhCn = post.zh_cn as Record<string, unknown> | undefined;
    const enUs = post.en_us as Record<string, unknown> | undefined;
    const rawContent = post.content || zhCn?.content || enUs?.content || [];
    const content = Array.isArray(rawContent) ? (rawContent as unknown[][]) : [];

    for (const paragraph of content) {
      for (const el of paragraph) {
        const element = el as Record<string, unknown>;
        if (element.tag === 'text') {
          texts.push(String(element.text || ''));
        } else if (element.tag === 'at') {
          texts.push(`@${element.user_name || element.user_id || ''}`);
        }
      }
      texts.push('\n');
    }
  } catch (error) {
    logError('[Feishu] Failed to extract text from post:', error);
  }

  return texts.join('').trim();
}
