import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const tracePanelPath = path.resolve(process.cwd(), 'src/renderer/components/TracePanel.tsx');

describe('TracePanel Claude-style layout', () => {
  it('uses a quieter background and rounded cards', () => {
    const source = fs.readFileSync(tracePanelPath, 'utf8');
    expect(source).toContain('bg-background-secondary/88');
    expect(source).toContain('rounded-2xl border border-border-subtle bg-background/55');
  });
});
