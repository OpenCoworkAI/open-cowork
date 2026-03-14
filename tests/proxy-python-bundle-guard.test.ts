import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('bundled proxy python dependencies', () => {
  it('includes claude-code-proxy runtime packages in prepare-python script', () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(testDir, '../scripts/prepare-python.js'),
      'utf-8'
    );

    expect(source).toContain('const BUNDLED_PROXY_PACKAGES = [');
    expect(source).toContain("'fastapi[standard]>=0.115.11'");
    expect(source).toContain("'litellm>=1.77.7'");
    expect(source).toContain("'google-cloud-aiplatform>=1.120.0'");
  });

  it('keeps the default python minor aligned with the hardcoded fallback URLs', () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(testDir, '../scripts/prepare-python.js'),
      'utf-8'
    );

    expect(source).toContain("const PYTHON_MINOR = process.env.OPEN_COWORK_PYTHON_MINOR || '3.10';");
    expect(source).toContain("const DEFAULT_PYTHON_URLS = PYTHON_MINOR === '3.10'");
    expect(source).not.toContain("const PYTHON_MINOR = process.env.OPEN_COWORK_PYTHON_MINOR || '3.12';");
  });

  it('uses the extracted bundled python as the default pip runtime and records a bundle fingerprint', () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(testDir, '../scripts/prepare-python.js'),
      'utf-8'
    );

    expect(source).toContain('const BUNDLED_PROXY_RUNTIME_FINGERPRINT = [');
    expect(source).toContain("const pipPython = process.env.OPEN_COWORK_PIP_PYTHON || pythonBin;");
    expect(source).not.toContain("const pipPython = process.env.OPEN_COWORK_PIP_PYTHON || 'python3';");
  });

  it('keeps linux bundled python packaging wired into the build', () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(testDir, '../electron-builder.yml'),
      'utf-8'
    );

    expect(source).toContain('resources/python/linux-${arch}');
  });
});
