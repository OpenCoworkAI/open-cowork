import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const indexPath = path.resolve(process.cwd(), 'src/main/index.ts');

describe('credentials IPC password stripping', () => {
  it('credentials.save strips password from return value', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    // Find the credentials.save handler block
    const saveBlock =
      source.match(
        /'credentials\.save'[\s\S]*?(?=ipcMain\.handle\(\s*\n?\s*'credentials\.update')/
      )?.[0] ?? '';

    expect(saveBlock).toContain('const saved = credentialsStore.save(credential)');
    expect(source).toContain('function omitCredentialPassword');
    expect(saveBlock).toContain('return omitCredentialPassword(saved)');
    // Must NOT return the raw save result directly
    expect(saveBlock).not.toMatch(/return credentialsStore\.save\(/);
  });

  it('credentials.update strips password from return value', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    // Find the credentials.update handler block
    const updateBlock =
      source.match(
        /'credentials\.update'[\s\S]*?(?=ipcMain\.handle\('credentials\.delete')/
      )?.[0] ?? '';

    expect(updateBlock).toContain('const updated = credentialsStore.update(id, updates)');
    expect(source).toContain('function omitCredentialPassword');
    expect(updateBlock).toContain('return omitCredentialPassword(updated)');
    // Must NOT return the raw update result directly
    expect(updateBlock).not.toMatch(/return credentialsStore\.update\(/);
  });

  it('credentials.update handles undefined return (credential not found)', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const updateBlock =
      source.match(
        /'credentials\.update'[\s\S]*?(?=ipcMain\.handle\('credentials\.delete')/
      )?.[0] ?? '';

    // Must guard against undefined before destructuring
    expect(updateBlock).toMatch(/if\s*\(!updated\)\s*return undefined/);
  });
});
