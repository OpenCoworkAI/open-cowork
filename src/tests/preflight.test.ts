/**
 * Tests for the runtime preflight check.
 * Mocks electron app.isPackaged and process.resourcesPath to simulate
 * packaged and development environments.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Electron mock ────────────────────────────────────────────
// The global alias maps 'electron' → tests/mocks/electron.ts (isPackaged: false).
// We override it per-test with vi.mock to control isPackaged.

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
  },
}));

// ── Helpers ──────────────────────────────────────────────────

function touch(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
}

function makeSkillsDir(resourcesDir: string): void {
  fs.mkdirSync(path.join(resourcesDir, 'skills'), { recursive: true });
}

// ── Test suite ───────────────────────────────────────────────

describe('runPreflight', () => {
  let tmpDir: string;
  const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-preflight-'));
    Object.defineProperty(process, 'resourcesPath', {
      value: tmpDir,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      writable: true,
      configurable: true,
    });
    vi.resetModules();
  });

  it('returns empty array when all resources are present (darwin)', async () => {
    // Simulate darwin platform
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true,
      configurable: true,
    });

    touch(path.join(tmpDir, 'mcp/gui-operate-server.js'));
    touch(path.join(tmpDir, 'node/bin/node'));
    touch(path.join(tmpDir, 'lima-agent/index.js'));
    makeSkillsDir(tmpDir);

    const { runPreflight } = await import('../main/preflight');
    const issues = runPreflight();
    expect(issues).toHaveLength(0);

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('returns critical issue when MCP server is missing', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true,
      configurable: true,
    });

    // Provide everything except mcp/gui-operate-server.js
    touch(path.join(tmpDir, 'node/bin/node'));
    touch(path.join(tmpDir, 'lima-agent/index.js'));
    makeSkillsDir(tmpDir);

    const { runPreflight } = await import('../main/preflight');
    const issues = runPreflight();
    const critical = issues.filter((i) => i.severity === 'critical');
    expect(critical).toHaveLength(1);
    expect(critical[0].resource).toBe('MCP Server (GUI)');
    expect(critical[0].message).toContain('mcp/gui-operate-server.js');

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('returns critical issue when bundled Node.js is missing (darwin)', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true,
      configurable: true,
    });

    // Provide everything except node binary
    touch(path.join(tmpDir, 'mcp/gui-operate-server.js'));
    touch(path.join(tmpDir, 'lima-agent/index.js'));
    makeSkillsDir(tmpDir);

    const { runPreflight } = await import('../main/preflight');
    const issues = runPreflight();
    const critical = issues.filter((i) => i.severity === 'critical');
    expect(critical).toHaveLength(1);
    expect(critical[0].resource).toBe('Bundled Node.js');
    expect(critical[0].message).toContain('node/bin/node');

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('returns critical issue when bundled Node.js is missing (win32)', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      writable: true,
      configurable: true,
    });

    // Provide everything except node.exe
    touch(path.join(tmpDir, 'mcp/gui-operate-server.js'));
    touch(path.join(tmpDir, 'wsl-agent/index.js'));
    makeSkillsDir(tmpDir);

    const { runPreflight } = await import('../main/preflight');
    const issues = runPreflight();
    const critical = issues.filter((i) => i.severity === 'critical');
    expect(critical).toHaveLength(1);
    expect(critical[0].resource).toBe('Bundled Node.js');
    expect(critical[0].message).toContain('node/node.exe');

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('returns warning issue when skills directory is missing', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true,
      configurable: true,
    });

    // Provide everything except skills
    touch(path.join(tmpDir, 'mcp/gui-operate-server.js'));
    touch(path.join(tmpDir, 'node/bin/node'));
    touch(path.join(tmpDir, 'lima-agent/index.js'));
    // skills directory intentionally omitted

    const { runPreflight } = await import('../main/preflight');
    const issues = runPreflight();
    const warnings = issues.filter((i) => i.severity === 'warning');
    expect(warnings.some((w) => w.resource === 'Built-in Skills')).toBe(true);
    const skillsWarning = warnings.find((w) => w.resource === 'Built-in Skills');
    expect(skillsWarning?.message).toContain('skills');

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('returns empty array and skips all checks when app.isPackaged is false', async () => {
    // Re-mock electron with isPackaged: false for this test
    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
      },
    }));

    // Do NOT create any resources in tmpDir — should still return []
    const { runPreflight } = await import('../main/preflight');
    const issues = runPreflight();
    expect(issues).toHaveLength(0);
  });
});
