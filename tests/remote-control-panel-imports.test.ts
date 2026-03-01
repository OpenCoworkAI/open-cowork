import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const panelPath = path.resolve(process.cwd(), 'src/renderer/components/RemoteControlPanel.tsx');
const panelContent = readFileSync(panelPath, 'utf8');

describe('RemoteControlPanel icon imports', () => {
  it('imports ExternalLink when used in JSX', () => {
    const usesExternalLink = panelContent.includes('<ExternalLink');
    if (!usesExternalLink) {
      return;
    }
    const match = panelContent.match(/import\s*{[\s\S]*?}\s*from 'lucide-react';/);
    expect(match).toBeTruthy();
    expect(match![0]).toContain('ExternalLink');
  });
});
