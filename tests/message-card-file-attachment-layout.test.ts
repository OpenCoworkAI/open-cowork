import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function readMessageCard() {
  const filePath = path.resolve(__dirname, '../src/renderer/components/MessageCard.tsx');
  return fs.readFileSync(filePath, 'utf8');
}

describe('message card file attachment layout', () => {
  it('keeps user bubble shrinkable in flex layouts', () => {
    const source = readMessageCard();
    expect(source).toContain('max-w-[80%] min-w-0 break-words');
  });

  it('prevents file attachment row overflow with long filenames', () => {
    const source = readMessageCard();
    expect(source).toContain('max-w-full min-w-0');
    expect(source).toContain('overflow-hidden');
    expect(source).toContain('text-sm text-text-primary truncate');
  });
});
