import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const indexPath = path.resolve(process.cwd(), 'src/main/index.ts');

describe('Main process quit cleanup guard', () => {
  it('before-quit does not pre-set isCleaningUp, so cleanupSandboxResources runs its body', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const beforeQuitBlock = source.match(/app\.on\('before-quit'[\s\S]*?\n}\);/)?.[0] || '';

    expect(beforeQuitBlock).not.toBe('');
    // cleanupSandboxResources() is the sole owner of isCleaningUp: if before-quit
    // assigns it first, cleanup's own guard short-circuits and Cmd+Q needs two
    // presses (OpenCoworkAI/open-cowork#297).
    expect(beforeQuitBlock).not.toMatch(/isCleaningUp\s*=\s*true/);
    expect(beforeQuitBlock).toContain('decideBeforeQuitAction');
    expect(beforeQuitBlock).toContain('void shutdownAndQuit()');
  });

  it('cleanupSandboxResources is the only place that sets isCleaningUp true', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const setters = source.match(/isCleaningUp\s*=\s*true/g) || [];

    expect(setters.length).toBe(1);
  });

  it('both quit paths route through shutdownAndQuit()', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const windowAllClosedBlock =
      source.match(/app\.on\('window-all-closed'[\s\S]*?\n}\);/)?.[0] || '';
    const beforeQuitBlock = source.match(/app\.on\('before-quit'[\s\S]*?\n}\);/)?.[0] || '';

    expect(windowAllClosedBlock).toContain('await shutdownAndQuit()');
    expect(beforeQuitBlock).toContain('void shutdownAndQuit()');
  });
});
