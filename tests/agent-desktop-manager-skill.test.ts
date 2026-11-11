import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentDesktopManager } from '../src/main/desktop/agent-desktop-manager';
import type { AgentDesktopClient } from '../src/main/desktop/agent-desktop-client';
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

describe('AgentDesktopManager — ciclo de vida do cliente por sessão', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'agent-desktop-manager-client-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function pathContext(): {
    userDataPath: string;
    env: NodeJS.ProcessEnv;
    fileExists: () => boolean;
  } {
    return {
      userDataPath: workDir,
      env: { [AGENT_DESKTOP_PATH_ENV]: '/fake/agent-desktop' } as NodeJS.ProcessEnv,
      fileExists: () => true,
    };
  }

  it('cria UM cliente quando duas chamadas concorrentes pedem a mesma sessão', async () => {
    let created = 0;
    let started = 0;

    const fake = {
      start: async () => {
        started += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
      close: async () => undefined,
      isReady: () => true,
    } as unknown as AgentDesktopClient;

    const manager = new AgentDesktopManager({
      pathContext: pathContext(),
      createClient: () => {
        created += 1;
        return fake;
      },
    });

    const [first, second] = await Promise.all([
      manager.getSessionClient('session-a'),
      manager.getSessionClient('session-a'),
    ]);

    // O upstream fixa `--session` no start: dois processos com o mesmo id
    // disputariam o estado da sessão, e um deles ficaria órfão.
    expect(created).toBe(1);
    expect(started).toBe(1);
    expect(first).toBe(second);
    expect(manager.activeSessionCount).toBe(1);
  });

  it('fecha o cliente quando o start falha (nenhum processo órfão)', async () => {
    let closed = 0;

    const failing = {
      start: async () => {
        throw new Error('start falhou');
      },
      close: async () => {
        closed += 1;
      },
      isReady: () => false,
    } as unknown as AgentDesktopClient;

    const manager = new AgentDesktopManager({
      pathContext: pathContext(),
      createClient: () => failing,
    });

    await expect(manager.getSessionClient('session-a')).rejects.toThrow(/start falhou/);

    // Sem este close, o cliente não entraria no Map e ficaria órfão.
    expect(closed).toBe(1);
    expect(manager.activeSessionCount).toBe(0);
  });

  it('permite nova criação para a mesma sessão depois de um start falho', async () => {
    let attempts = 0;

    const manager = new AgentDesktopManager({
      pathContext: pathContext(),
      createClient: () => {
        attempts += 1;
        const shouldFail = attempts === 1;
        return {
          start: async () => {
            if (shouldFail) throw new Error('primeira tentativa falhou');
          },
          close: async () => undefined,
          isReady: () => true,
        } as unknown as AgentDesktopClient;
      },
    });

    await expect(manager.getSessionClient('session-a')).rejects.toThrow();
    // A falha não pode envenenar a sessão: a segunda tentativa funciona.
    const client = await manager.getSessionClient('session-a');
    expect(client).toBeDefined();
    expect(attempts).toBe(2);
  });
});
