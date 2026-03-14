import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const contextPanelPath = path.resolve(process.cwd(), 'src/renderer/components/ContextPanel.tsx');

describe('ContextPanel Claude-style layout', () => {
  it('uses a slimmer quieter panel width and muted shell', () => {
    const source = fs.readFileSync(contextPanelPath, 'utf8');
    expect(source).toContain("w-[18.5rem]");
    expect(source).toContain('bg-background-secondary/88');
  });

  it('uses rounded surface cards for compact summary blocks', () => {
    const source = fs.readFileSync(contextPanelPath, 'utf8');
    expect(source).toContain('rounded-2xl border border-border-subtle bg-background/50');
  });
});
