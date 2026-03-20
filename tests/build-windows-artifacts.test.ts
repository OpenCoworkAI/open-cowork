import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { writeLegacyCleanupArtifacts } = require('../scripts/build-windows-artifacts.js');

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('build-windows artifacts helper', () => {
  it('copies legacy cleanup tools into the requested output directory', () => {
    const outputDir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-build-win-artifacts-'));
    tempDirs.push(outputDir);

    const copiedPaths = writeLegacyCleanupArtifacts({
      projectRoot: process.cwd(),
      outputDir,
    });

    expect(copiedPaths).toHaveLength(2);
    expect(fs.existsSync(path.join(outputDir, 'Open-Cowork-Legacy-Cleanup.cmd'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'Open-Cowork-Legacy-Cleanup.ps1'))).toBe(true);

    const cmdContent = fs.readFileSync(path.join(outputDir, 'Open-Cowork-Legacy-Cleanup.cmd'), 'utf8');
    expect(cmdContent).toContain('ExecutionPolicy Bypass');
  });
});
