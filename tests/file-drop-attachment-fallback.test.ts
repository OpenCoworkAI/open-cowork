import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function readFile(relativePath: string) {
  const filePath = path.resolve(__dirname, '..', relativePath);
  return fs.readFileSync(filePath, 'utf8');
}

describe('file drop attachment fallback', () => {
  it('handles non-image dropped files in WelcomeView', () => {
    const source = readFile('src/renderer/components/WelcomeView.tsx');
    expect(source).toContain('const otherFiles = files.filter(file => !file.type.startsWith(\'image/\'))');
  });

  it('supports inline data fallback when dropped file path is unavailable', () => {
    const rendererTypes = readFile('src/renderer/types/index.ts');
    const sessionManager = readFile('src/main/session/session-manager.ts');
    expect(rendererTypes).toContain('inlineDataBase64?: string');
    expect(sessionManager).toContain('fileBlock.inlineDataBase64');
    expect(sessionManager).toContain('Buffer.from(fileBlock.inlineDataBase64, \'base64\')');
  });
});
