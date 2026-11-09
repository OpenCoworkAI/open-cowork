/**
 * Teste fim-a-fim da camada de skill contra o **binário real** do upstream.
 *
 * É o que valida a cadeia completa: binário → envelope JSON v2.6 → `SKILL.md`
 * utilizável pelo pi. Sem o binário, o teste é pulado (não falha) — a suíte
 * hermética em `agent-desktop-skill.test.ts` cobre a lógica.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AGENT_DESKTOP_PATH_ENV } from '../src/main/desktop/agent-desktop-paths';
import {
  materializeAgentDesktopSkills,
  readAgentDesktopVersion,
} from '../src/main/desktop/agent-desktop-skill';

/** Binário real usado no spike (fora do repositório). */
const SPIKE_BINARY =
  'C:/Users/nislei/AppData/Local/Temp/open-cowork-agent-desktop-spike/artifacts/agent-desktop.exe';

function resolveRealBinary(): string | undefined {
  const fromEnv = process.env[AGENT_DESKTOP_PATH_ENV];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (existsSync(SPIKE_BINARY)) return SPIKE_BINARY;
  return undefined;
}

const BINARY = resolveRealBinary();

describe.skipIf(!BINARY)('camada de skill contra o binário real do upstream', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'agent-desktop-skill-real-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('lê a versão real do binário', async () => {
    const version = await readAgentDesktopVersion(BINARY!);
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('materializa o guia core com o adaptador do Open Cowork', async () => {
    const result = await materializeAgentDesktopSkills({
      binaryPath: BINARY!,
      targetRoot: workDir,
    });

    expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(result.skills.length).toBeGreaterThan(0);

    const core = result.skills.find((skill) => skill.name === 'agent-desktop');
    expect(core).toBeDefined();

    const content = readFileSync(core!.filePath, 'utf8');

    // 1. O adaptador está presente e vem antes do guia upstream.
    expect(content).toContain('## Open Cowork adapter');
    expect(content.indexOf('## Open Cowork adapter')).toBeLessThan(
      content.indexOf('# agent-desktop')
    );

    // 2. A interface real (agregada) está documentada.
    expect(content).toContain('desktop_observe');
    expect(content).toContain('desktop_act');
    expect(content).toContain('desktop_skills');

    // 3. A semântica de entrega está presente.
    expect(content).toContain('not_delivered');
    expect(content).toContain('delivery_uncertain');

    // 4. O conteúdo upstream foi preservado (não reescrito do zero).
    expect(content).toContain('snapshot');
    expect(content.length).toBeGreaterThan(1000);
  });

  it('a skill da plataforma corrente também é materializada', async () => {
    const result = await materializeAgentDesktopSkills({
      binaryPath: BINARY!,
      targetRoot: workDir,
    });

    const platformSkill = result.skills.find((skill) => skill.name !== 'agent-desktop');
    expect(platformSkill).toBeDefined();

    const content = readFileSync(platformSkill!.filePath, 'utf8');
    expect(content).toContain('## Open Cowork adapter');
  });

  it('o materializado é reaproveitado no cache versionado', async () => {
    const first = await materializeAgentDesktopSkills({
      binaryPath: BINARY!,
      targetRoot: workDir,
    });
    const second = await materializeAgentDesktopSkills({
      binaryPath: BINARY!,
      targetRoot: workDir,
      version: first.version,
    });

    expect(second.cached).toBe(true);
    expect(second.directory).toBe(first.directory);
    expect(second.skills.map((skill) => skill.name)).toEqual(
      first.skills.map((skill) => skill.name)
    );
  });
});
