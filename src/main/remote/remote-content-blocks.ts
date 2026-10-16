/**
 * Convert remote channel content into agent ContentBlocks.
 * Image keys that were downloaded become image blocks; unresolved
 * attachments become explicit notices instead of empty content.
 */

import type { RemoteContent } from './types';
import type { ContentBlock, ImageContent, TextContent } from '../../renderer/types/index';

export interface RemoteContentConversion {
  blocks: ContentBlock[];
  /** When false, the router should reply with the notice and not call the agent. */
  deliverToAgent: boolean;
}

export function convertRemoteContentToBlocks(content: RemoteContent): RemoteContentConversion {
  switch (content.type) {
    case 'text':
      if (content.text) {
        return {
          blocks: [{ type: 'text', text: content.text } as TextContent],
          deliverToAgent: true,
        };
      }
      return { blocks: [], deliverToAgent: true };

    case 'image':
      return convertImageContent(content);

    case 'file':
      return {
        blocks: [{ type: 'text', text: describeFileContent(content) } as TextContent],
        deliverToAgent: true,
      };

    case 'voice':
      return {
        blocks: [{ type: 'text', text: describeVoiceContent(content) } as TextContent],
        deliverToAgent: true,
      };

    default:
      return {
        blocks: [
          {
            type: 'text',
            text: content.text || '[不支持的消息类型]',
          } as TextContent,
        ],
        deliverToAgent: true,
      };
  }
}

function convertImageContent(content: RemoteContent): RemoteContentConversion {
  if (content.imageBase64 && content.imageMediaType) {
    const imageBlock: ImageContent = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: content.imageMediaType,
        data: content.imageBase64,
      },
    };
    return { blocks: [imageBlock], deliverToAgent: true };
  }

  if (content.imageUrl) {
    const details = [
      content.imageUrl,
      content.imageKey ? `imageKey=${content.imageKey}` : undefined,
    ].filter(Boolean);
    return {
      blocks: [
        {
          type: 'text',
          text: `[用户发送了一张图片: ${details.join(', ')}]`,
        } as TextContent,
      ],
      deliverToAgent: true,
    };
  }

  const notice = content.imageKey
    ? `[图片无法处理: 未能下载 imageKey=${content.imageKey} 的图片内容]`
    : '[图片消息缺少 imageUrl/imageKey，无法读取图片内容]';
  return {
    blocks: [{ type: 'text', text: notice } as TextContent],
    deliverToAgent: false,
  };
}

function describeFileContent(content: RemoteContent): string {
  const file = content.file;
  if (!file) {
    return '[用户发送了文件]';
  }
  const details = [
    file.name,
    file.key ? `fileKey=${file.key}` : undefined,
    file.size != null ? `size=${file.size}` : undefined,
    file.mimeType ? `mimeType=${file.mimeType}` : undefined,
  ].filter(Boolean);
  return `[用户发送了文件: ${details.join(', ')}]`;
}

function describeVoiceContent(content: RemoteContent): string {
  const voice = content.voice;
  if (!voice) {
    return '[用户发送了语音消息]';
  }
  const details = [
    voice.key ? `voiceKey=${voice.key}` : undefined,
    voice.duration != null ? `duration=${voice.duration}s` : undefined,
    voice.url ? `url=${voice.url}` : undefined,
  ].filter(Boolean);
  if (details.length === 0) {
    return '[用户发送了语音消息]';
  }
  return `[用户发送了语音消息: ${details.join(', ')}]`;
}
