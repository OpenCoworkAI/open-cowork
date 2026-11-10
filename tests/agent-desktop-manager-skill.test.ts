import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentDesktopManager } from '../src/main/desktop/agent-desktop-manager';
import { AGENT_DESKTOP_PATH_ENV } from '../src/main/desktop/agent-desktop-paths';
import type { AgentDesktopSkillExec } from '../src/main/desktop/agent-desktop-skill';

const UPSTREAM_GUIDE = [
  '---',
  'name: agent-desktop',
  'description: >',
  '  Operate desktop applications using the agent-desktop CLI.',
  '---',
  '',
  '# agent-desktop',
  '',
  'Run `agent-desktop snapshot`.',
  '',
].join('\r\n');

function createFakeExec(): { exec: AgentDesktopSkillExec; calls: string[][] } {
  const calls: string[][] = [];

  const exec: AgentDesktopSkillExec = async (_command, args) => {
    calls.push([...args]);

    if (args.includes('--version')) {
      return { stdout: 'agent-desktop 1.2.0\n', stderr: '' };
    }
    if (args[0] === 'skills' && args[1] === 'list') {
      return {
        stdout: JSON.stringify({
          ok: true,
          data: {
            skills: [
              { name: 'agent-desktop', current: false, references: [] },
              { name: 'agent-desktop-windows', current: true, references: [] },
            ],
          },
        }),
        stderr: '',
      };
    }
    if (args[0] === 'skills' && args[1] === 'get') {
      return {
        stdout: JSON.stringify({ ok: true, data: { content: UPSTREAM_GUIDE } }),
        stderr: '',
      };
    }
    return { stdout: '', stderr: '' };
  };

  return { exec, calls };
}

describe('AgentDesktopManager — camada de skill', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'agent-desktop-manager-skill-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('materializa as skills sob <userData>/agent-desktop/skills/<versão>', async () => {
    const { exec } = createFakeExec();
    const manager = new AgentDesktopManager({
      pathContext: {
        userDataPath: workDir,
        env: { [AGENT_DESKTOP_PATH_ENV]: '/fake/agent-desktop' } as NodeJS.ProcessEnv,
        fileExists: () => true,
      },
      skillExec: exec,
    });

    const result = await manager.ensureSkillsMaterialized();

    expect(result).not.toBeNull();
    expect(result?.version).toBe('1.2.0');
    expect(result?.directory).toBe(path.join(workDir, 'agent-desktop', 'skills', '1.2.0'));
    expect(result?.skills.map((skill) => skill.name)).toEqual([
      'agent-desktop',
      'agent-desktop-windows',
    ]);

    const content = readFileSync(
      path.join(result!.directory, 'agent-desktop', 'SKILL.md'),
      'utf8'
    );
    expect(content).toContain('## Open Cowork adapter');
  });

  it('devolve null (degradação declarada) quando não há userData', async () => {
    const { exec } = createFakeExec();
    const manager = new AgentDesktopManager({
      pathContext: {
        env: { [AGENT_DESKTOP_PATH_ENV]: '/fake/agent-desktop' } as NodeJS.ProcessEnv,
        fileExists: () => true,
      },
      skillExec: exec,
    });

    await expect(manager.ensureSkillsMaterialized()).resolves.toBeNull();
  });

  it('devolve null quando o binário não existe', async () => {
    const { exec } = createFakeExec();
    const manager = new AgentDesktopManager({
      pathContext: {
        userDataPath: workDir,
        env: {} as NodeJS.ProcessEnv,
        fileExists: () => false,
      },
      skillExec: exec,
    });

    await expect(manager.ensureSkillsMaterialized()).resolves.toBeNull();
  });

  it('devolve null quando a extração falha (não envenena o cache)', async () => {
    const manager = new AgentDesktopManager({
      pathContext: {
        userDataPath: workDir,
        env: { [AGENT_DESKTOP_PATH_ENV]: '/fake/agent-desktop' } as NodeJS.ProcessEnv,
        fileExists: () => true,
      },
      skillExec: async () => {
        throw new Error('spawn falhou');
      },
    });

    await expect(manager.ensureSkillsMaterialized()).resolves.toBeNull();
    // A segunda tentativa ainda é possível (o cache não foi envenenado).
    await expect(manager.ensureSkillsMaterialized()).resolves.toBeNull();
  });

  it('materializa apenas uma vez por versão (spawns deduplicados)', async () => {
    const { exec, calls } = createFakeExec();
    const manager = new AgentDesktopManager({
      pathContext: {
        userDataPath: workDir,
        env: { [AGENT_DESKTOP_PATH_ENV]: '/fake/agent-desktop' } as NodeJS.ProcessEnv,
        fileExists: () => true,
      },
      skillExec: exec,
    });

    const first = await manager.ensureSkillsMaterialized();
    const callsAfterFirst = calls.length;
    const second = await manager.ensureSkillsMaterialized();

    expect(second?.directory).toBe(first?.directory);
    expect(calls.length).toBe(callsAfterFirst);
  });
});
