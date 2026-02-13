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
    prepare: vi.fn(() => statement as any),
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn(),
  };
}

function createPluginDirectory(
  root: string,
  pluginName: string,
  skills: Array<{ name: string; description: string }>,
  withManifest = true
): string {
  const pluginRoot = path.join(root, pluginName);
  if (withManifest) {
    fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: pluginName, version: '1.0.0', description: `${pluginName} plugin` }, null, 2),
      'utf8'
    );
  }

  for (const skill of skills) {
    const skillRoot = path.join(pluginRoot, 'skills', skill.name);
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.writeFileSync(
      path.join(skillRoot, 'SKILL.md'),
      `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\nUse ${skill.name}.`,
      'utf8'
    );
  }

  return pluginRoot;
}

describe('SkillsManager installPluginFromDirectory', () => {
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-plugin-test-'));
    fs.mkdirSync(path.join(testRoot, 'userData'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'home'), { recursive: true });
  });

  afterEach(() => {
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('installs all skills from a valid plugin directory', async () => {
    const pluginRoot = createPluginDirectory(testRoot, 'demo-plugin', [
      { name: 'alpha', description: 'Alpha skill' },
      { name: 'beta', description: 'Beta skill' },
    ]);
    const manager = new SkillsManager(createDbMock());

    const result = await manager.installPluginFromDirectory(pluginRoot);

    expect(result.pluginName).toBe('demo-plugin');
    expect(result.installedSkills.sort()).toEqual(['alpha', 'beta']);
    expect(result.errors).toEqual([]);
  });

  it('overwrites same skill when plugin is reinstalled', async () => {
    const pluginRoot = createPluginDirectory(testRoot, 'demo-plugin', [{ name: 'alpha', description: 'Old description' }]);
    const manager = new SkillsManager(createDbMock());
    await manager.installPluginFromDirectory(pluginRoot);

    fs.writeFileSync(
      path.join(pluginRoot, 'skills', 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: New description\n---\n\nUpdated',
      'utf8'
    );

    const result = await manager.installPluginFromDirectory(pluginRoot);
    expect(result.installedSkills).toEqual(['alpha']);

    const installedSkillPath = path.join(testRoot, 'userData', 'claude', 'skills', 'alpha', 'SKILL.md');
    expect(fs.readFileSync(installedSkillPath, 'utf8')).toContain('New description');
  });

  it('returns clear error when plugin has no skills directory', async () => {
    const pluginRoot = createPluginDirectory(testRoot, 'empty-plugin', []);
    const manager = new SkillsManager(createDbMock());

    await expect(manager.installPluginFromDirectory(pluginRoot)).rejects.toThrow('Plugin has no installable skills');
  });

  it('installs skills even when plugin manifest is missing', async () => {
    const pluginRoot = createPluginDirectory(
      testRoot,
      'plugin-dev',
      [{ name: 'skill-development', description: 'Develop plugin skills' }],
      false
    );
    const manager = new SkillsManager(createDbMock());

    const result = await manager.installPluginFromDirectory(pluginRoot);

    expect(result.pluginName).toBe('plugin-dev');
    expect(result.installedSkills).toEqual(['skill-development']);
    expect(result.errors).toEqual([]);
  });

  it('does not show duplicate skills after plugin install', async () => {
    const pluginRoot = createPluginDirectory(testRoot, 'hookify', [
      { name: 'Writing Hookify Rules', description: 'Write hookify rules' },
    ]);
    const manager = new SkillsManager(createDbMock());

    await manager.installPluginFromDirectory(pluginRoot);

    const skills = await manager.listSkills({ type: 'custom' });
    const sameNameSkills = skills.filter(
      (skill) => skill.name.toLowerCase() === 'writing hookify rules'
    );

    expect(sameNameSkills).toHaveLength(1);
    expect(sameNameSkills[0].id.startsWith('global-')).toBe(true);
  });
});
