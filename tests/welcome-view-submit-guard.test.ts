import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const welcomeViewPath = path.resolve(process.cwd(), 'src/renderer/components/WelcomeView.tsx');

describe('WelcomeView submit guards', () => {
  it('disables the submit button when there is no text, image, or file to send', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');

    expect(source).toContain('const canSubmit = prompt.trim().length > 0 || pastedImages.length > 0 || attachedFiles.length > 0;');
    expect(source).toContain('disabled={!canSubmit || isSubmitting}');
  });

  it('only clears the composer after startSession returns a created session', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');

    expect(source).toContain('const session = await startSession(sessionTitle, contentBlocks, workingDir || undefined);');
    expect(source).toContain('if (session) {');
    expect(source).toContain('setPrompt(\'\');');
    expect(source).toContain('setPastedImages([]);');
    expect(source).toContain('setAttachedFiles([]);');
  });
});
