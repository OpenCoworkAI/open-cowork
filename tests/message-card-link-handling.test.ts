import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const messageCardPath = path.resolve(process.cwd(), 'src/renderer/components/MessageCard.tsx');

describe('MessageCard local link handling', () => {
  it('renders local markdown links as folder-locate buttons instead of target-blank anchors', () => {
    const source = fs.readFileSync(messageCardPath, 'utf8');

    expect(source).toContain(
      'const localFilePath = resolveLocalFilePathFromHref(href, currentWorkingDir);'
    );
    expect(source).toContain("title={t('messageCard.revealInFolder')}");
    expect(source).toContain('await window.electronAPI.showItemInFolder(');
    expect(source).toContain('localFilePath,');
    expect(source).toContain('currentWorkingDir ?? undefined');
    expect(source).not.toContain('const fallbackUrl = `file://${encodeURI(localFilePath)}`;');
    expect(source).not.toContain('target="_blank"');
  });
});
