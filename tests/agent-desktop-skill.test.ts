import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AGGREGATE_BY_OPERATION } from '../src/main/desktop/agent-desktop-catalog';
import {
  AGENT_DESKTOP_CORE_SKILL,
  buildAdapterSection,
  buildSkillDocument,
  buildStaticOperationCatalog,
  extractDescription,
  listAgentDesktopSkills,
  materializeAgentDesktopSkills,
  readAgentDesktopVersion,
  selectSkillNames,
  splitFrontmatter,
  type AgentDesktopSkillExec,
} from '../src/main/desktop/agent-desktop-skill';

/** Guia upstream simulado — mesmo formato do binário v1.2.0 (CRLF + `description: >`). */
const UPSTREAM_GUIDE = [
  '---',
  'name: agent-desktop',
  'tags: computer-use, desktop-automation, cli',
  'requirements:',
  '  - agent-desktop',
  'description: >',
  '  Operate desktop applications through native accessibility trees,',
  '  using the agent-desktop CLI.',
  '---',
  '',
  '# agent-desktop',
  '',
  '## Core guide',
  '',
  'Run `agent-desktop snapshot` then `agent-desktop click --ref @s1:e1`.',
  '',
].join('\r\n');

const UPSTREAM_PLATFORM_GUIDE = [
  '---',
  'name: agent-desktop-windows',
  'description: >',
  '  Windows platform guide for the agent-desktop CLI.',
  '---',
  '',
  '# agent-desktop-windows',
  '',
  'UIPI elevation notes.',
  '',
].join('\r\n');

interface FakeExecCall {
  command: string;
  args: string[];
}

interface FakeExec {
  exec: AgentDesktopSkillExec;
  calls: FakeExecCall[];
}

/**
 * Dublê de `execFile` que emula o binário upstream.
 */
function createFakeExec(options: { failOn?: string } = {}): FakeExec {
  const calls: FakeExecCall[] = [];

  const exec: AgentDesktopSkillExec = async (command, args) => {
    calls.push({ command, args: [...args] });

    const argsList = [...args];

    if (options.failOn && argsList.includes(options.failOn)) {
      throw new Error(`simulated failure: ${options.failOn}`);
    }

    if (argsList.includes('--version')) {
      return { stdout: 'agent-desktop 1.2.0\n', stderr: '' };
    }

    if (argsList[0] === 'skills' && argsList[1] === 'list') {
      return {
        stdout: JSON.stringify({
          version: '2.6',
          ok: true,
          command: 'skills',
          data: {
            skills: [
              {
                name: 'agent-desktop',
                current: false,
                references: ['references/commands-observation.md'],
                summary: 'Core guide for every OS.',
              },
              {
                name: 'agent-desktop-windows',
                current: true,
                references: ['references/troubleshooting.md'],
                summary: 'Windows platform guide.',
              },
            ],
          },
        }),
        stderr: '',
      };
    }

    if (argsList[0] === 'skills' && argsList[1] === 'get') {
      const name = argsList[2];
      const content = name === 'agent-desktop-windows' ? UPSTREAM_PLATFORM_GUIDE : UPSTREAM_GUIDE;
      return {
        stdout: JSON.stringify({ version: '2.6', ok: true, data: { content } }),
        stderr: '',
      };
    }

    return { stdout: '', stderr: '' };
  };

  return { exec, calls };
}

describe('camada de skill do agent-desktop', () => {
  describe('splitFrontmatter', () => {
    it('separa o frontmatter do corpo e normaliza CRLF', () => {
      const { frontmatter, body } = splitFrontmatter(UPSTREAM_GUIDE);

      expect(frontmatter).toContain('name: agent-desktop');
      expect(frontmatter).toContain('description: >');
      expect(body).toContain('# agent-desktop');
      expect(body).not.toContain('---');
      expect(body).not.toContain('\r');
    });

    it('devolve o documento inteiro quando não há frontmatter', () => {
      const { frontmatter, body } = splitFrontmatter('# só corpo\n');
      expect(frontmatter).toBe('');
      expect(body).toContain('# só corpo');
    });
  });

  describe('extractDescription', () => {
    it('lê block scalar `>` (formato do upstream v1.2.0)', () => {
      const { frontmatter } = splitFrontmatter(UPSTREAM_GUIDE);
      expect(extractDescription(frontmatter)).toBe(
        'Operate desktop applications through native accessibility trees, using the agent-desktop CLI.'
      );
    });

    it('lê escalar simples', () => {
      expect(extractDescription('name: x\ndescription: "Valor simples"\n')).toBe('Valor simples');
    });

    it('devolve vazio quando não há description', () => {
      expect(extractDescription('name: x\n')).toBe('');
    });
  });

  describe('buildStaticOperationCatalog', () => {
    it('cobre exatamente as operações classificadas no contrato upstream', () => {
      const operations = buildStaticOperationCatalog();
      const names = operations.map((operation) => operation.operation).sort();

      expect(names).toEqual(Object.keys(AGGREGATE_BY_OPERATION).sort());
    });

    it('expõe o nome upstream com o prefixo correto', () => {
      const operations = buildStaticOperationCatalog();
      const snapshot = operations.find((operation) => operation.operation === 'snapshot');

      expect(snapshot?.upstreamTool).toBe('desktop_snapshot');
      expect(snapshot?.aggregate).toBe('observe');
    });
  });

  describe('buildAdapterSection', () => {
    const adapter = buildAdapterSection(buildStaticOperationCatalog());

    it('declara a interface agregada e proíbe a sintaxe CLI', () => {
      expect(adapter).toContain('desktop_<agregado>({ operation: "<operacao>", args: { ... } })');
      expect(adapter).toContain('a CLI não é a interface suportada');
      expect(adapter).toContain('não a invoque via `bash`');
      expect(adapter).toContain('gate de permissão');
      expect(adapter).toContain('set_value');
      expect(adapter).toContain('set-value');
    });

    it('lista as 8 tools agregadas', () => {
      for (const aggregate of [
        'observe',
        'act',
        'wait',
        'app',
        'window',
        'clipboard',
        'notifications',
        'status',
      ]) {
        expect(adapter).toContain(`\`desktop_${aggregate}\``);
      }
    });

    it('documenta a semântica de entrega com os 4 estados', () => {
      expect(adapter).toContain('not_delivered');
      expect(adapter).toContain('delivered_verified');
      expect(adapter).toContain('delivered_unverified');
      expect(adapter).toContain('delivery_uncertain');
      expect(adapter).toContain('Não repita');
    });

    it('ensina a abrir references sob demanda via desktop_skills', () => {
      expect(adapter).toContain('desktop_skills({ operation: "get"');
      expect(adapter).toContain('references/commands-observation.md');
      // A rota antiga (skills_get dentro de desktop_observe) saiu de cena: as
      // operações de skills têm tool agregada própria.
      expect(adapter).not.toContain('operation: "skills_get"');
    });

    it('exige snapshot novo em STALE_REF/AMBIGUOUS_TARGET', () => {
      expect(adapter).toContain('STALE_REF');
      expect(adapter).toContain('AMBIGUOUS_TARGET');
    });
  });

  describe('buildSkillDocument', () => {
    const document = buildSkillDocument({
      name: AGENT_DESKTOP_CORE_SKILL,
      upstreamContent: UPSTREAM_GUIDE,
      operations: buildStaticOperationCatalog(),
    });

    it('produz frontmatter válido com name e description', () => {
      const { frontmatter } = splitFrontmatter(document);
      expect(frontmatter).toContain('name: agent-desktop');
      expect(frontmatter).toContain('description: >-');
    });

    it('a description aponta para as tools agregadas, não para a CLI', () => {
      const { frontmatter } = splitFrontmatter(document);
      const description = extractDescription(frontmatter);

      expect(description).toContain('desktop_observe');
      expect(description).toContain('SEMPRE use as tools `desktop_*`');
    });

    it('preserva o corpo upstream verbatim abaixo do adaptador', () => {
      expect(document).toContain('# agent-desktop');
      expect(document).toContain('## Core guide');
      expect(document).toContain('Run `agent-desktop snapshot`');
    });

    it('o adaptador vem ANTES do guia upstream', () => {
      const adapterIndex = document.indexOf('## Open Cowork adapter');
      const upstreamIndex = document.indexOf('# agent-desktop');
      expect(adapterIndex).toBeGreaterThan(-1);
      expect(upstreamIndex).toBeGreaterThan(adapterIndex);
    });
  });

  describe('selectSkillNames', () => {
    const summaries = [
      { name: 'agent-desktop', references: [], current: false },
      { name: 'agent-desktop-windows', references: [], current: true },
      { name: 'agent-desktop-linux', references: [], current: false },
    ];

    it('escolhe a core + a skill da plataforma corrente', () => {
      expect(selectSkillNames(summaries)).toEqual(['agent-desktop', 'agent-desktop-windows']);
    });

    it('respeita a lista explícita', () => {
      expect(selectSkillNames(summaries, ['agent-desktop-linux'])).toEqual(['agent-desktop-linux']);
    });
  });

  describe('readAgentDesktopVersion', () => {
    it('extrai a versão do output do `--version`', async () => {
      const { exec } = createFakeExec();
      await expect(readAgentDesktopVersion('/fake/agent-desktop', exec)).resolves.toBe('1.2.0');
    });
  });

  describe('listAgentDesktopSkills', () => {
    it('lê as skills do envelope JSON', async () => {
      const { exec } = createFakeExec();
      const skills = await listAgentDesktopSkills('/fake/agent-desktop', exec);

      expect(skills.map((skill) => skill.name)).toEqual([
        'agent-desktop',
        'agent-desktop-windows',
      ]);
      expect(skills.find((skill) => skill.name === 'agent-desktop-windows')?.current).toBe(true);
    });
  });

  describe('materializeAgentDesktopSkills', () => {
    let workDir: string;

    beforeEach(() => {
      workDir = mkdtempSync(path.join(tmpdir(), 'agent-desktop-skill-'));
    });

    afterEach(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    it('materializa a core e a skill da plataforma em disco', async () => {
      const { exec } = createFakeExec();
      const result = await materializeAgentDesktopSkills({
        binaryPath: '/fake/agent-desktop',
        targetRoot: workDir,
        exec,
      });

      expect(result.version).toBe('1.2.0');
      expect(result.cached).toBe(false);
      expect(result.skills.map((skill) => skill.name)).toEqual([
        'agent-desktop',
        'agent-desktop-windows',
      ]);

      const corePath = path.join(result.directory, 'agent-desktop', 'SKILL.md');
      const content = readFileSync(corePath, 'utf8');
      expect(content).toContain('## Open Cowork adapter');
      expect(content).toContain('desktop_observe');
    });

    it('o diretório é versionado (upgrade do binário invalida o cache)', async () => {
      const { exec } = createFakeExec();
      const result = await materializeAgentDesktopSkills({
        binaryPath: '/fake/agent-desktop',
        targetRoot: workDir,
        exec,
      });

      expect(path.basename(result.directory)).toBe('1.2.0');
      expect(result.directory.startsWith(workDir)).toBe(true);
    });

    it('reaproveita o cache sem spawnar de novo (com a versão pré-resolvida)', async () => {
      const { exec, calls } = createFakeExec();
      // O manager resolve a versão uma única vez e a repassa — caminho de produção.
      const options = {
        binaryPath: '/fake/agent-desktop',
        targetRoot: workDir,
        version: '1.2.0',
        exec,
      };

      const first = await materializeAgentDesktopSkills(options);
      const callsAfterFirst = calls.length;

      const second = await materializeAgentDesktopSkills(options);

      expect(second.cached).toBe(true);
      expect(second.directory).toBe(first.directory);
      expect(second.skills.map((skill) => skill.name)).toEqual(
        first.skills.map((skill) => skill.name)
      );
      // Nenhum spawn adicional: o marcador de materialização evita até o `skills list`.
      expect(calls.length).toBe(callsAfterFirst);
      expect(callsAfterFirst).toBe(3); // skills list + 2× skills get
    });

    it('sem a versão pré-resolvida, o cache ainda evita reextrair as skills', async () => {
      const { exec, calls } = createFakeExec();
      const options = {
        binaryPath: '/fake/agent-desktop',
        targetRoot: workDir,
        exec,
      };

      await materializeAgentDesktopSkills(options);
      const callsAfterFirst = calls.length;

      await materializeAgentDesktopSkills(options);

      // Só o `--version` é repetido (necessário para localizar o cache versionado);
      // `skills list` e `skills get` NÃO são reexecutados.
      const secondCallArgs = calls.slice(callsAfterFirst).map((call) => call.args.join(' '));
      expect(secondCallArgs).toEqual(['--version']);
    });

    it('a descrição materializada é orientada às tools agregadas', async () => {
      const { exec } = createFakeExec();
      const result = await materializeAgentDesktopSkills({
        binaryPath: '/fake/agent-desktop',
        targetRoot: workDir,
        exec,
      });

      const core = result.skills.find((skill) => skill.name === 'agent-desktop');
      expect(core?.description).toContain('desktop_observe');
      expect(core?.description).toContain('SEMPRE use as tools `desktop_*`');
    });

    it('propaga a falha quando o binário falha (falha fechada, não silenciosa)', async () => {
      const { exec } = createFakeExec({ failOn: 'skills' });
      await expect(
        materializeAgentDesktopSkills({
          binaryPath: '/fake/agent-desktop',
          targetRoot: workDir,
          exec,
        })
      ).rejects.toThrow();
    });
  });
});
