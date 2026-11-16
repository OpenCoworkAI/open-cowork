import type { ImageContent as PiImageContent } from '@mariozechner/pi-ai';
import type { Message } from '../../renderer/types';

/** Convert persisted clipboard/upload images to the SDK's prompt attachment format. */
export function buildPromptImageOptions(
  message: Message | null,
  imageCapable: boolean
): { images: PiImageContent[] } | undefined {
  if (!imageCapable || message?.role !== 'user') return undefined;
  const images: PiImageContent[] = [];
  for (const block of message.content) {
    if (block.type === 'image' && block.source.data) {
      images.push({ type: 'image', data: block.source.data, mimeType: block.source.media_type });
    }
  }
  return images.length ? { images } : undefined;
}
