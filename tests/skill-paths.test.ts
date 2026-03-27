import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let testRoot = '';
let originalResourcesPathDescriptor: PropertyDescriptor | undefined;

vi.mock('electron', () => ({
  app: {
    getAppPath: () => path.join(testRoot, 'app.asar'),
  },
}));

describe('skill path resolution', () => {
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-skill-paths-'));
    originalResourcesPathDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: path.join(testRoot, 'resources'),
    });
  });

  afterEach(() => {
    if (originalResourcesPathDescriptor) {
      Object.defineProperty(process, 'resourcesPath', originalResourcesPathDescriptor);
    } else {
      delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    }

    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('prefers resourcesPath skills over legacy unpacked fallback', async () => {
    const resourcesSkillsPath = path.join(testRoot, 'resources', 'skills');
    const unpackedSkillsPath = path.join(testRoot, 'app.asar.unpacked', '.claude', 'skills');
    fs.mkdirSync(resourcesSkillsPath, { recursive: true });
    fs.mkdirSync(unpackedSkillsPath, { recursive: true });

    vi.resetModules();
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      const normalizedTestRoot = testRoot.replace(/\\/g, '/');

      return {
        ...actual,
        existsSync(candidate: Parameters<typeof actual.existsSync>[0]) {
          const normalizedCandidate =
            typeof candidate === 'string' ? candidate.replace(/\\/g, '/') : String(candidate);
          if (normalizedCandidate.endsWith('/.claude/skills')) {
            return normalizedCandidate.startsWith(normalizedTestRoot);
          }
          return actual.existsSync(candidate);
        },
      };
    });

    try {
      const { resolveBuiltinSkillsPath } = await import('../src/main/skills/skill-paths');
      expect(resolveBuiltinSkillsPath()).toBe(resourcesSkillsPath);
    } finally {
      vi.doUnmock('fs');
      vi.resetModules();
    }
  });

  it('discovers only the project .skills directory', async () => {
    const projectRoot = path.join(testRoot, 'project');
    fs.mkdirSync(path.join(projectRoot, '.skills'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'skills'), { recursive: true });

    const { resolveProjectSkillDirs } = await import('../src/main/skills/skill-paths');
    expect(resolveProjectSkillDirs(projectRoot)).toEqual([path.join(projectRoot, '.skills')]);
  });

  it('ignores a project .skills symlink that escapes the project root', async () => {
    const projectRoot = path.join(testRoot, 'project');
    const outsideRoot = path.join(testRoot, 'outside-skills');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });

    fs.symlinkSync(
      outsideRoot,
      path.join(projectRoot, '.skills'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    const { resolveProjectSkillDirs } = await import('../src/main/skills/skill-paths');
    expect(resolveProjectSkillDirs(projectRoot)).toEqual([]);
  });
});
