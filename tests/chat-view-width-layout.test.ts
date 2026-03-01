import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function readChatView() {
  const filePath = path.resolve(__dirname, '../src/renderer/components/ChatView.tsx');
  return fs.readFileSync(filePath, 'utf8');
}

describe('chat view width layout', () => {
  it('uses a wider responsive messages container', () => {
    const source = readChatView();
    expect(source).toContain('max-w-[1180px]');
    expect(source).toContain('lg:px-6');
  });

  it('observes message container via ref instead of hard-coded class selector', () => {
    const source = readChatView();
    expect(source).toContain('messagesContainerRef');
    expect(source).not.toContain("querySelector('.max-w-3xl')");
  });
});
