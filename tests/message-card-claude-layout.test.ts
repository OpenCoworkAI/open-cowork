import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Content split across MessageCard.tsx and the message/ sub-components directory
const messageCardPath = path.resolve(process.cwd(), 'src/renderer/components/MessageCard.tsx');
const messageDir = path.resolve(process.cwd(), 'src/renderer/components/message');

function readAllMessageContent() {
  return [
    fs.readFileSync(messageCardPath, 'utf8'),
    ...fs.readdirSync(messageDir).map((f) => fs.readFileSync(path.join(messageDir, f), 'utf8')),
  ].join('\n');
}

describe('MessageCard Claude-style layout', () => {
  it('uses a softer user bubble treatment', () => {
    const source = readAllMessageContent();
    expect(source).toContain('message-user px-4 py-3');
    expect(source).toContain('rounded-4xl');
  });

  it('uses quieter rounded shells for tool and thinking cards', () => {
    const source = readAllMessageContent();
    expect(source).toContain('rounded-2xl border overflow-hidden');
    expect(source).toContain('border-border-subtle bg-background/40');
  });
});
