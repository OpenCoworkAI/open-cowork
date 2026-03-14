import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const indexPath = path.resolve(process.cwd(), 'src/main/index.ts');

describe('Main process file navigation handling', () => {
  it('treats raw file:// links as local reveal targets in window navigation hooks', () => {
    const source = fs.readFileSync(indexPath, 'utf8');

    expect(source).toContain("if (parsed.protocol === 'file:') {");
    expect(source).toContain('return localPathFromFileUrl(url);');
    expect(source).toContain('void revealNavigationTarget(url);');
    expect(source).toContain('return revealFileInFolder(localPath);');
  });
});
