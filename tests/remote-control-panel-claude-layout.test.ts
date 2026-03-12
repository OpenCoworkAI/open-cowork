import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const remotePanelPath = path.resolve(process.cwd(), 'src/renderer/components/RemoteControlPanel.tsx');

describe('RemoteControlPanel Claude-style layout', () => {
  it('uses softer shell treatments instead of dashboard-heavy panels', () => {
    const source = fs.readFileSync(remotePanelPath, 'utf8');
    expect(source).toContain('rounded-[2rem]');
    expect(source).toContain('border-border-subtle');
  });
});
