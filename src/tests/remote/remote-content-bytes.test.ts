import { describe, expect, it } from 'vitest';
import { convertRemoteContentToBlocks } from '../../main/remote/remote-content-blocks';

describe('transport-neutral downloaded remote content', () => {
  it('preserves downloaded document bytes and captions for session attachment staging', () => {
    expect(
      convertRemoteContentToBlocks({
        type: 'file',
        text: 'Read this',
        file: {
          name: 'notes.txt',
          size: 3,
          mimeType: 'text/plain',
          inlineDataBase64: 'YWJj',
        },
      })
    ).toEqual({
      deliverToAgent: true,
      blocks: [
        { type: 'text', text: 'Read this' },
        {
          type: 'file_attachment',
          filename: 'notes.txt',
          relativePath: '',
          size: 3,
          mimeType: 'text/plain',
          inlineDataBase64: 'YWJj',
        },
      ],
    });
  });
  it('retains an image caption along with its downloaded image bytes', () => {
    expect(
      convertRemoteContentToBlocks({
        type: 'image',
        text: 'Describe this',
        imageBase64: 'YWJj',
        imageMediaType: 'image/png',
      })
    ).toEqual({
      deliverToAgent: true,
      blocks: [
        { type: 'text', text: 'Describe this' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } },
      ],
    });
  });
});
