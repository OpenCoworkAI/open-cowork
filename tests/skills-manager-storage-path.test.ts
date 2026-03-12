import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let testRoot = '';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => testRoot,
    getVersion: () => '0.0.0-test',
    getPath: (name: string) => {
      if (name === 'userData') return path.join(testRoot, 'userData');
      if (name === 'home') return path.join(testRoot, 'home');
      return testRoot;
    },
  },
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { SkillsManager } from '../src/main/skills/skills-manager';
import type { DatabaseInstance } from '../src/main/db/database';

function createDbMock(): DatabaseInstance {
  const statement = { run: vi.fn() };
  return {
    raw: {} as any,
    sessions: {} as any,
    messages: {} as any,
    traceSteps: {} as any,
    scheduledTasks: {} as any,
    prepare: vi.fn(() => statement as any),
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn(),
  };
}

function writeSkill(rootPath: string, name: string, description = `${name} skill`): void {
  const skillRoot = path.join(rootPath, name);
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(
    path.join(skillRoot, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nUse ${name}.`,
    'utf8'
  );
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for condition');
}

describe('SkillsManager storage path management', () => {
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-skills-storage-test-'));
    fs.mkdirSync(path.join(testRoot, 'userData'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'home'), { recursive: true });
  });

  afterEach(() => {
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('migrates skills to new configured storage directory', async () => {
    let configuredPath = '';
    const manager = new SkillsManager(createDbMock(), {
      getConfiguredGlobalSkillsPath: () => configuredPath,
      setConfiguredGlobalSkillsPath: (nextPath) => {
        configuredPath = nextPath;
      },
    });

    const defaultPath = manager.getGlobalSkillsPath();
    writeSkill(defaultPath, 'alpha');

    const targetPath = path.join(testRoot, 'custom-skills');
    const result = await manager.setGlobalSkillsPath(targetPath, true);

    expect(result.path).toBe(path.resolve(targetPath));
    expect(result.migratedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(configuredPath).toBe(path.resolve(targetPath));
    expect(fs.existsSync(path.join(targetPath, 'alpha', 'SKILL.md'))).toBe(true);
  });

  it('skips migration when same skill already exists in target directory', async () => {
    let configuredPath = '';
    const manager = new SkillsManager(createDbMock(), {
      getConfiguredGlobalSkillsPath: () => configuredPath,
      setConfiguredGlobalSkillsPath: (nextPath) => {
        configuredPath = nextPath;
      },
    });

    const defaultPath = manager.getGlobalSkillsPath();
    writeSkill(defaultPath, 'alpha', 'source description');

    const targetPath = path.join(testRoot, 'custom-skills');
    writeSkill(targetPath, 'alpha', 'target description');

    const result = await manager.setGlobalSkillsPath(targetPath, true);

    expect(result.migratedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    const targetSkillContent = fs.readFileSync(path.join(targetPath, 'alpha', 'SKILL.md'), 'utf8');
    expect(targetSkillContent).toContain('target description');
  });

  it('throws when target path is not a directory and keeps configured path unchanged', async () => {
    let configuredPath = '';
    const manager = new SkillsManager(createDbMock(), {
      getConfiguredGlobalSkillsPath: () => configuredPath,
      setConfiguredGlobalSkillsPath: (nextPath) => {
        configuredPath = nextPath;
      },
    });

    const invalidPath = path.join(testRoot, 'not-a-directory');
    fs.writeFileSync(invalidPath, 'content', 'utf8');

    await expect(manager.setGlobalSkillsPath(invalidPath, true)).rejects.toThrow('Target path is not a directory');
    expect(configuredPath).toBe('');
  });

  it('emits storage changed event when storage directory path switches', async () => {
    let configuredPath = '';
    const manager = new SkillsManager(createDbMock(), {
      getConfiguredGlobalSkillsPath: () => configuredPath,
      setConfiguredGlobalSkillsPath: (nextPath) => {
        configuredPath = nextPath;
      },
    });

    const reasons: string[] = [];
    const unsubscribe = manager.onStorageChanged((event) => {
      reasons.push(event.reason);
    });

    const targetPath = path.join(testRoot, 'new-storage');
    await manager.setGlobalSkillsPath(targetPath, true);

    await waitFor(() => reasons.includes('path_changed'));

    unsubscribe();
    expect(reasons).toContain('path_changed');
  });
});
