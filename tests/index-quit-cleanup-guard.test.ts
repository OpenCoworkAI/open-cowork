import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const indexPath = path.resolve(process.cwd(), 'src/main/index.ts');

describe('Main process quit cleanup guard', () => {
  it('before-quit does not pre-set isCleaningUp, so cleanupSandboxResources runs its body', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const beforeQuitBlock = source.match(/app\.on\('before-quit'[\s\S]*?\n}\);/)?.[0] || '';

    expect(beforeQuitBlock).not.toBe('');
    // cleanupSandboxResources() is the sole owner of isCleaningUp: it must be the
    // only place that assigns it, or its own guard short-circuits before the
    // cleanup body (remote-control stop, sandbox sync-back, MCP shutdown, DB
    // close) ever runs.
    expect(beforeQuitBlock).not.toMatch(/isCleaningUp\s*=\s*true/);
    expect(beforeQuitBlock).toContain('await cleanupSandboxResources();');
  });

  it('before-quit defers a second quit attempt received mid-cleanup instead of letting it through', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const beforeQuitBlock = source.match(/app\.on\('before-quit'[\s\S]*?\n}\);/)?.[0] || '';

    expect(beforeQuitBlock).toMatch(/if\s*\(quitReady\)\s*return;/);
    expect(beforeQuitBlock).toMatch(/if\s*\(isCleaningUp\)\s*\{[\s\S]*?event\.preventDefault\(\);/);
  });

  it('cleanupSandboxResources is the only place that sets isCleaningUp true', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const setters = source.match(/isCleaningUp\s*=\s*true/g) || [];

    expect(setters.length).toBe(1);
  });

  it('both quit paths mark quitReady before calling app.quit()', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const windowAllClosedBlock =
      source.match(/app\.on\('window-all-closed'[\s\S]*?\n}\);/)?.[0] || '';
    const beforeQuitBlock = source.match(/app\.on\('before-quit'[\s\S]*?\n}\);/)?.[0] || '';

    expect(windowAllClosedBlock).toMatch(/quitReady = true;\s*\n\s*app\.quit\(\);/);
    expect(beforeQuitBlock).toMatch(/quitReady = true;\s*\n\s*app\.quit\(\);/);
  });
});
