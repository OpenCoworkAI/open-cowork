import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

// Import the runChecks function from the CommonJS script using createRequire
const require = createRequire(import.meta.url);
const { runChecks } = require('../../scripts/pre-build-check.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pre-build-check-test-'));
}

function makeFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '// placeholder');
}

function makeDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Creates all artifacts that are required for a successful darwin/arm64 check.
 */
function populateDarwinArtifacts(root: string, arch: string = 'arm64'): void {
  // Common FATAL resources
  makeFile(path.join(root, '.bundle-resources/mcp/gui-operate-server.js'));
  makeFile(path.join(root, '.bundle-resources/mcp/software-dev-server-example.js'));
  makeDir(path.join(root, 'dist-electron'));
  makeDir(path.join(root, 'dist'));
  makeDir(path.join(root, '.claude/skills'));

  // macOS FATAL resources
  makeFile(path.join(root, `resources/node/darwin-${arch}/bin/node`));
  makeFile(path.join(root, 'dist-lima-agent/index.js'));
}

/**
 * Creates all artifacts that are required for a successful win32/x64 check.
 */
function populateWin32Artifacts(root: string): void {
  makeFile(path.join(root, '.bundle-resources/mcp/gui-operate-server.js'));
  makeFile(path.join(root, '.bundle-resources/mcp/software-dev-server-example.js'));
  makeDir(path.join(root, 'dist-electron'));
  makeDir(path.join(root, 'dist'));
  makeDir(path.join(root, '.claude/skills'));
  makeFile(path.join(root, 'resources/node/win32-x64/node.exe'));
  makeFile(path.join(root, 'dist-wsl-agent/index.js'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pre-build-check: runChecks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // All-pass scenarios
  // -------------------------------------------------------------------------

  it('passes all FATAL checks on darwin when required artifacts exist', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.failed).toBe(0);
    expect(result.hasFatal).toBe(false);
    // 5 common + 2 darwin FATAL = 7 FATAL checks should pass
    expect(result.passed).toBeGreaterThanOrEqual(7);
  });

  it('passes all FATAL checks on win32 when required artifacts exist', () => {
    populateWin32Artifacts(tmpDir);

    const result = runChecks(tmpDir, 'win32', 'x64');

    expect(result.failed).toBe(0);
    expect(result.hasFatal).toBe(false);
    expect(result.passed).toBeGreaterThanOrEqual(7);
  });

  it('reports warnings for optional darwin resources that are missing', () => {
    // Only populate FATAL items; leave warn items absent
    populateDarwinArtifacts(tmpDir, 'x64');

    const result = runChecks(tmpDir, 'darwin', 'x64');

    expect(result.failed).toBe(0);
    expect(result.hasFatal).toBe(false);
    // Both python and tools dirs are absent => 2 warnings
    expect(result.warnings).toBe(2);
  });

  it('reports zero warnings when optional darwin resources are present', () => {
    populateDarwinArtifacts(tmpDir, 'x64');
    makeDir(path.join(tmpDir, 'resources/python/darwin-x64'));
    makeDir(path.join(tmpDir, 'resources/tools/darwin-x64'));

    const result = runChecks(tmpDir, 'darwin', 'x64');

    expect(result.failed).toBe(0);
    expect(result.warnings).toBe(0);
    expect(result.hasFatal).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Failure scenarios
  // -------------------------------------------------------------------------

  it('reports hasFatal when a common FATAL file is missing', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');
    // Remove a required common file
    fs.rmSync(path.join(tmpDir, '.bundle-resources/mcp/gui-operate-server.js'));

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('reports hasFatal when dist-electron directory is missing', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');
    fs.rmSync(path.join(tmpDir, 'dist-electron'), { recursive: true });

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('reports hasFatal when darwin node binary is missing', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');
    fs.rmSync(path.join(tmpDir, 'resources/node/darwin-arm64/bin/node'));

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('reports hasFatal when win32 node.exe is missing', () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(path.join(tmpDir, 'resources/node/win32-x64/node.exe'));

    const result = runChecks(tmpDir, 'win32', 'x64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('reports hasFatal when wsl-agent index.js is missing', () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(path.join(tmpDir, 'dist-wsl-agent/index.js'));

    const result = runChecks(tmpDir, 'win32', 'x64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('reports hasFatal when lima-agent index.js is missing', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');
    fs.rmSync(path.join(tmpDir, 'dist-lima-agent/index.js'));

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('fails all checks when root directory is completely empty', () => {
    const result = runChecks(tmpDir, 'darwin', 'arm64');

    // All checks should fail or warn; none should pass
    expect(result.passed).toBe(0);
    expect(result.hasFatal).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Result shape
  // -------------------------------------------------------------------------

  it('returns a results array with one entry per check', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(Array.isArray(result.results)).toBe(true);
    // Each result must have required fields
    for (const r of result.results) {
      expect(typeof r.label).toBe('string');
      expect(typeof r.relPath).toBe('string');
      expect(typeof r.passed).toBe('boolean');
      expect(['fatal', 'warn']).toContain(r.severity);
    }
  });

  it('passed + warnings + failed sums equal total checks', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.passed + result.warnings + result.failed).toBe(result.results.length);
  });

  // -------------------------------------------------------------------------
  // Linux platform
  // -------------------------------------------------------------------------

  it('includes linux-specific check on linux platform', () => {
    const result = runChecks(tmpDir, 'linux', 'x64');

    const linuxCheck = result.results.find((r) => r.relPath === 'resources/node/linux-x64');
    expect(linuxCheck).toBeDefined();
    expect(linuxCheck?.severity).toBe('fatal');
  });
});
