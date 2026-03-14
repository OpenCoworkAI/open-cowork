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

  it('shows a warning toast when revealing a local file fails', () => {
    const source = fs.readFileSync(messageCardPath, 'utf8');

    expect(source).toContain('const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);');
    expect(source).toContain('if (!revealed) {');
    expect(source).toContain("message: t('context.revealFailed')");
  });

  it('treats Windows forward-slash paths as absolute file targets', () => {
    const source = fs.readFileSync(messageCardPath, 'utf8');

    expect(source).toContain('const resolveFilePath = (value: string) => resolvePathAgainstWorkspace(value, currentWorkingDir);');
  });
});
