import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const scriptPath = path.resolve(process.cwd(), 'scripts/build-windows.js');

describe('build-windows helper', () => {
  it('exits early on non-Windows hosts to avoid misleading runs', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');

    expect(source).toContain("if (process.platform !== 'win32') {");
    expect(source).toContain('Skipping build.');
    expect(source).toContain('process.exit(0);');
  });

  it('copies legacy cleanup helpers into the Windows release output after a successful build', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');

    expect(source).toContain("const { writeLegacyCleanupArtifacts } = require('./build-windows-artifacts');");
    expect(source).toContain('writeLegacyCleanupArtifacts({');
    expect(source).toContain('Added legacy cleanup helper:');
  });
});
