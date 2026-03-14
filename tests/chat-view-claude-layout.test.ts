import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const chatViewPath = path.resolve(process.cwd(), 'src/renderer/components/ChatView.tsx');

function readChatView() {
  return fs.readFileSync(chatViewPath, 'utf8');
}

describe('ChatView Claude-style layout', () => {
  it('uses a narrower conversation column shared by messages and composer', () => {
    const source = readChatView();
    expect(source).toContain('max-w-[920px]');
  });

  it('uses a quieter header treatment with Open Cowork eyebrow and compact connector badge', () => {
    const source = readChatView();
    expect(source).toContain('Open Cowork');
    expect(source).toContain('bg-background/88');
    expect(source).toContain('border-border-muted');
  });

  it('uses a softer rounded composer shell instead of the previous heavy input bar', () => {
    const source = readChatView();
    expect(source).toContain('rounded-[1.75rem]');
    expect(source).toContain('shadow-soft');
  });
});
