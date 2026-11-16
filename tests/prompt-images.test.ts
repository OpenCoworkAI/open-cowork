import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/renderer/types';
import { buildPromptImageOptions } from '../src/main/agent/prompt-images';
import { resolvePiRegistryModel } from '../src/main/agent/pi-model-resolution';

const message: Message = {
  id: 'clipboard',
  sessionId: 'session',
  role: 'user',
  timestamp: 1,
  content: [
    { type: 'text', text: 'Read this screenshot' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'cG5n' } },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'anBlZw==' } },
  ],
};

describe('prompt image forwarding', () => {
  it('passes every pasted image to the SDK without changing the persisted message', async () => {
    const original = structuredClone(message);
    const prompt = vi.fn().mockResolvedValue(undefined);
    await prompt('Read this screenshot', buildPromptImageOptions(message, true));
    expect(prompt).toHaveBeenCalledWith('Read this screenshot', {
      images: [
        { type: 'image', mimeType: 'image/png', data: 'cG5n' },
        { type: 'image', mimeType: 'image/jpeg', data: 'anBlZw==' },
      ],
    });
    expect(message).toEqual(original);
  });

  it('does not attach images to text-only models or reuse assistant images', () => {
    expect(buildPromptImageOptions(message, false)).toBeUndefined();
    expect(buildPromptImageOptions({ ...message, role: 'assistant' }, true)).toBeUndefined();
    expect(buildPromptImageOptions(null, true)).toBeUndefined();
    expect(
      buildPromptImageOptions({ ...message, content: [{ type: 'text', text: 'Hi' }] }, true)
    ).toBeUndefined();
  });

  it('preserves the registry capabilities of known vision models', () => {
    const model = resolvePiRegistryModel('anthropic/claude-sonnet-4-6');
    expect(model?.input).toContain('image');
    expect(buildPromptImageOptions(message, model!.input.includes('image'))?.images).toHaveLength(
      2
    );
  });
});
