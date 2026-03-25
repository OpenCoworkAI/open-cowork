import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('afterAllArtifactBuild hook', () => {
  it('copies legacy cleanup helpers into the electron-builder output directory on Windows builds', async () => {
    const outputDir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-after-all-artifacts-'));
    tempDirs.push(outputDir);
    const { addWindowsReleaseArtifacts } = await import('../scripts/compress-dmg.js');

    const copiedPaths = addWindowsReleaseArtifacts({
      outDir: outputDir,
      configuration: {},
    });

    expect(copiedPaths).toHaveLength(2);
    expect(fs.existsSync(path.join(outputDir, 'Open-Cowork-Legacy-Cleanup.cmd'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'Open-Cowork-Legacy-Cleanup.ps1'))).toBe(true);
  });
});
