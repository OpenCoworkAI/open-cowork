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

function createSkill(skillName: string, skillContent: string): string {
  const skillRoot = path.join(testRoot, 'incoming', skillName);
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), skillContent, 'utf8');
  return skillRoot;
}

describe('SkillsManager compatibility metadata', () => {
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-skill-compatibility-'));
    fs.mkdirSync(path.join(testRoot, 'userData'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'home'), { recursive: true });
  });

  afterEach(() => {
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('parses optional compatibility metadata from SKILL.md', () => {
    const manager = new SkillsManager(createDbMock());
    const skillRoot = createSkill(
      'alpha',
      [
        '---',
        'name: alpha',
        'description: Alpha skill',
        'compatibility: "Cross-platform with Python 3"',
        '---',
        '',
        'Use alpha.',
      ].join('\n')
    );

    expect(manager.getSkillMetadata(skillRoot)).toEqual({
      name: 'alpha',
      description: 'Alpha skill',
      compatibility: 'Cross-platform with Python 3',
    });
  });

  it('rejects empty compatibility metadata during validation', async () => {
    const manager = new SkillsManager(createDbMock());
    const skillRoot = createSkill(
      'beta',
      [
        '---',
        'name: beta',
        'description: Beta skill',
        'compatibility:',
        '---',
        '',
        'Use beta.',
      ].join('\n')
    );

    await expect(manager.validateSkillFolder(skillRoot)).resolves.toEqual({
      valid: false,
      errors: ['SKILL.md "compatibility" must be a non-empty single-line string'],
    });
  });

  it('rejects invalid dependency manifests during validation', async () => {
    const manager = new SkillsManager(createDbMock());
    const skillRoot = createSkill(
      'delta',
      ['---', 'name: delta', 'description: Delta skill', '---', '', 'Use delta.'].join('\n')
    );
    fs.writeFileSync(
      path.join(skillRoot, 'DEPENDENCIES.json'),
      JSON.stringify({ schemaVersion: 3, pythonPackages: [''] }, null, 2),
      'utf8'
    );

    await expect(manager.validateSkillFolder(skillRoot)).resolves.toEqual({
      valid: false,
      errors: [
        '"schemaVersion" must be 1 when present',
        '"pythonPackages" must not contain empty strings',
        'Dependency manifest must declare at least one dependency list',
      ],
    });
  });
});
