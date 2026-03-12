import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const messageCardPath = path.resolve(process.cwd(), 'src/renderer/components/MessageCard.tsx');

describe('MessageCard Claude-style layout', () => {
  it('uses a softer user bubble treatment', () => {
    const source = fs.readFileSync(messageCardPath, 'utf8');
    expect(source).toContain('message-user px-4 py-3');
    expect(source).toContain('rounded-[1.65rem]');
  });

  it('uses quieter rounded shells for tool and thinking cards', () => {
    const source = fs.readFileSync(messageCardPath, 'utf8');
    expect(source).toContain('rounded-2xl border overflow-hidden');
    expect(source).toContain('rounded-2xl border border-border-subtle bg-background/40 overflow-hidden');
  });
});
