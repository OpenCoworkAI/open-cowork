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
  const statement = { run: vi.fn() } as unknown as ReturnType<DatabaseInstance['prepare']>;
  return {
    raw: {} as unknown as DatabaseInstance['raw'],
    sessions: {} as unknown as DatabaseInstance['sessions'],
    messages: {} as unknown as DatabaseInstance['messages'],
    traceSteps: {} as unknown as DatabaseInstance['traceSteps'],
    scheduledTasks: {} as unknown as DatabaseInstance['scheduledTasks'],
    prepare: vi.fn(() => statement) as unknown as DatabaseInstance['prepare'],
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn(),
  };
}

function writeSkill(rootPath: string, skillName: string): void {
  const skillRoot = path.join(rootPath, skillName);
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(
    path.join(skillRoot, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: ${skillName} skill\n---\n\nUse ${skillName}.`,
    'utf8'
  );
}

describe('SkillsManager project skill loading', () => {
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-project-skills-'));
    fs.mkdirSync(path.join(testRoot, 'userData'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'home'), { recursive: true });
  });

  afterEach(() => {
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('loads only .skills and ignores symlinks that escape the project root', async () => {
    const manager = new SkillsManager(createDbMock());
    const projectRoot = path.join(testRoot, 'project');
    const projectSkillsRoot = path.join(projectRoot, '.skills');
    const bareSkillsRoot = path.join(projectRoot, 'skills');
    const outsideRoot = path.join(testRoot, 'outside');

    fs.mkdirSync(projectSkillsRoot, { recursive: true });
    fs.mkdirSync(bareSkillsRoot, { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });

    writeSkill(projectSkillsRoot, 'local-skill');
    writeSkill(bareSkillsRoot, 'ignored-bare-skill');
    writeSkill(outsideRoot, 'escaped-skill');

    fs.symlinkSync(
      path.join(outsideRoot, 'escaped-skill'),
      path.join(projectSkillsRoot, 'escaped-skill'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    const skills = await manager.loadProjectSkills(projectRoot);

    expect(skills.map((skill) => skill.name)).toEqual(['local-skill']);
  });
});
