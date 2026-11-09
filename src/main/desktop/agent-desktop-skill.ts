/**
 * Camada de skill do `agent-desktop` (computer use semântico).
 *
 * ## Por que esta camada existe
 *
 * O upstream (`vercel-labs/agent-desktop` v1.2.0) embute **6 skills** no binário
 * (`skills path` → `location: "embedded"`, sempre version-matched). Elas são o
 * *conhecimento operacional* do computer use semântico: o loop observe→act→observe,
 * a semântica de entrega (4 estados), as regras de retry e as armadilhas por OS.
 *
 * O guia upstream, porém, é escrito para a **CLI** (`agent-desktop snapshot`).
 * O Open Cowork expõe a API **agregada** (`desktop_observe({operation:"snapshot"})`).
 * Embutir o guia cru ensinaria ao modelo a interface errada — o modo de falha
 * mais caro possível (148 invocações de sintaxe CLI num único documento).
 *
 * ## Estratégia: conteúdo upstream + adaptador Open Cowork
 *
 * - O **conteúdo** vem do upstream (autoritativo, version-matched por construção);
 * - O **adaptador** é nosso: uma seção que traduz a sintaxe CLI para as tools
 *   agregadas e documenta a semântica de entrega no envelope do Open Cowork.
 * - As **references** (até 107 KB por skill) **não** são materializadas em disco:
 *   são carregadas sob demanda via `desktop_skills({operation:"get"})`,
 *   o que mantém o version-match e evita I/O desnecessário.
 *
 * ## Materialização e cache
 *
 * As skills são extraídas do **binário**, não do servidor MCP — assim elas
 * existem mesmo se o MCP falhar, e não acoplam ao ciclo de vida do cliente.
 * O cache é versionado: `<root>/<version>/<skill-name>/SKILL.md`.
 *
 * ## Módulo puro
 *
 * Sem Electron e sem `child_process` no import: a execução é injetada
 * (`execFile`) para permitir testes determinísticos.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile as nodeExecFile } from 'node:child_process';

import {
  AGGREGATE_BY_OPERATION,
  AGGREGATE_ORDER,
  UPSTREAM_TOOL_PREFIX,
  aggregateToolName,
  classifyRisk,
  groupOperationsByAggregate,
  type AgentDesktopOperation,
} from './agent-desktop-catalog';

/**
 * Catálogo estático das operações do upstream v1.2.0 (67 operações).
 *
 * Deriva de `AGGREGATE_BY_OPERATION`, que o teste de contrato
 * (`tests/agent-desktop-upstream-contract.test.ts`) confronta com o
 * `tools/list` real do upstream — logo, a tabela do adaptador é
 * guaranteedly igual à das tools expostas, **sem** precisar do cliente MCP.
 */
export function buildStaticOperationCatalog(): AgentDesktopOperation[] {
  return Object.entries(AGGREGATE_BY_OPERATION)
    .map(([operation, aggregate]) => ({
      operation,
      upstreamTool: `${UPSTREAM_TOOL_PREFIX}${operation}`,
      aggregate,
      risk: classifyRisk(operation),
    }))
    .sort((a, b) => {
      const aggregateDiff = AGGREGATE_ORDER.indexOf(a.aggregate) - AGGREGATE_ORDER.indexOf(b.aggregate);
      if (aggregateDiff !== 0) return aggregateDiff;
      return a.operation.localeCompare(b.operation);
    });
}

/** Nome da skill "core" do upstream (always load first). */
export const AGENT_DESKTOP_CORE_SKILL = 'agent-desktop';

/**
 * Assinatura do `execFile` injetado.
 *
 * Mantém o módulo testável sem spawnar processos reais.
 */
export type AgentDesktopSkillExec = (
  command: string,
  args: readonly string[],
  options: { timeout: number }
) => Promise<{ stdout: string; stderr: string }>;

/** Skill disponível no binário, conforme `skills list`. */
export interface AgentDesktopSkillSummary {
  name: string;
  summary?: string;
  references: string[];
  /** `true` quando é a skill específica da plataforma corrente. */
  current?: boolean;
}

/** Skill materializada em disco. */
export interface AgentDesktopMaterializedSkill {
  name: string;
  /** Caminho absoluto do `SKILL.md`. */
  filePath: string;
  description: string;
  /** Diretório da skill (contém `SKILL.md` e `references/`). */
  directory: string;
}

export interface AgentDesktopSkillMaterialization {
  /** Diretório raiz do cache (contém `<skill>/SKILL.md`). */
  directory: string;
  /** Versão do binário de origem (ex.: `1.2.0`). */
  version: string;
  skills: AgentDesktopMaterializedSkill[];
  /** `true` quando o cache versionado já existia e foi reaproveitado. */
  cached: boolean;
}

export interface MaterializeAgentDesktopSkillsOptions {
  /** Caminho absoluto do executável `agent-desktop`. */
  binaryPath: string;
  /** Raiz do cache (ex.: `<userData>/agent-desktop/skills`). */
  targetRoot: string;
  /**
   * Catálogo de operações para gerar a tabela de mapeamento do adaptador.
   * Padrão: o catálogo estático do contrato upstream v1.2.0.
   */
  operations?: readonly AgentDesktopOperation[];
  /**
   * Versão do binário, quando já resolvida pelo chamador (evita um spawn extra).
   */
  version?: string;
  /** `execFile` injetado (testes). */
  exec?: AgentDesktopSkillExec;
  /** Timeout por comando, em ms. */
  timeoutMs?: number;
  /**
   * Skills a materializar. Padrão: a core + a da plataforma corrente
   * (detectada por `current: true` em `skills list`).
   */
  skillNames?: readonly string[];
}

/**
 * Envelope JSON do upstream (documentação v2.6).
 */
interface UpstreamEnvelope {
  ok?: boolean;
  data?: {
    content?: string;
    skills?: Array<{
      name: string;
      summary?: string;
      references?: string[];
      current?: boolean;
    }>;
    available?: string[];
  };
  error?: { message?: string };
}

/**
 * Executa o binário e devolve o stdout.
 */
async function run(
  exec: AgentDesktopSkillExec,
  binaryPath: string,
  args: readonly string[],
  timeoutMs: number
): Promise<string> {
  const { stdout } = await exec(binaryPath, args, { timeout: timeoutMs });
  return stdout;
}

/**
 * Interpreta a saída JSON do upstream.
 *
 * O upstream sempre responde JSON; ainda assim, toleramos saída não-JSON
 * (ex.: uma versão mais nova em modo texto) devolvendo o texto cru.
 */
function parseEnvelope(raw: string): UpstreamEnvelope | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed) as UpstreamEnvelope;
  } catch {
    return null;
  }
}

/**
 * Extrai o conteúdo textual de `skills get`.
 */
function extractContent(raw: string): string {
  const envelope = parseEnvelope(raw);
  const content = envelope?.data?.content;
  if (typeof content === 'string' && content.length > 0) return content;
  // Fallback: saída em texto puro.
  return raw;
}

/**
 * Lê a versão do binário (`agent-desktop --version` → `agent-desktop 1.2.0`).
 */
export async function readAgentDesktopVersion(
  binaryPath: string,
  exec: AgentDesktopSkillExec = defaultExec,
  timeoutMs = 15_000
): Promise<string> {
  const raw = await run(exec, binaryPath, ['--version'], timeoutMs);
  const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(raw);
  return match?.[1] ?? 'unknown';
}

/**
 * Lista as skills embutidas no binário (`skills list`).
 */
export async function listAgentDesktopSkills(
  binaryPath: string,
  exec: AgentDesktopSkillExec = defaultExec,
  timeoutMs = 15_000
): Promise<AgentDesktopSkillSummary[]> {
  const raw = await run(exec, binaryPath, ['skills', 'list'], timeoutMs);
  const envelope = parseEnvelope(raw);
  const skills = envelope?.data?.skills;
  if (!Array.isArray(skills)) return [];

  return skills
    .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill?.name))
    .map((skill) => ({
      name: skill.name,
      summary: skill.summary,
      references: Array.isArray(skill.references) ? skill.references : [],
      current: skill.current === true,
    }));
}

/**
 * Extrai o guia completo de uma skill (`skills get <name>`).
 */
export async function extractAgentDesktopSkillGuide(
  binaryPath: string,
  skillName: string,
  exec: AgentDesktopSkillExec = defaultExec,
  timeoutMs = 20_000
): Promise<string> {
  const raw = await run(exec, binaryPath, ['skills', 'get', skillName], timeoutMs);
  return extractContent(raw);
}

/**
 * Divide o frontmatter YAML do upstream do corpo do documento.
 *
 * O upstream usa `description: >` (block scalar) com indentação de 2 espaços.
 */
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!match) return { frontmatter: '', body: normalized };
  return { frontmatter: match[1], body: normalized.slice(match[0].length) };
}

/**
 * Extrai a `description` do frontmatter (block scalar `>`/`|` ou escalar simples).
 */
export function extractDescription(frontmatter: string): string {
  const lines = frontmatter.split('\n');
  const start = lines.findIndex((line) => /^description\s*:/.test(line));
  if (start === -1) return '';

  const value = lines[start].slice(lines[start].indexOf(':') + 1).trim();

  if (value === '>' || value === '>' + '-' || value === '|' || value === '|-') {
    const collected: string[] = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() === '') {
        collected.push('');
        continue;
      }
      if (!/^\s/.test(line)) break;
      collected.push(line.trim());
    }
    return collected.join(' ').replace(/\s+/g, ' ').trim();
  }

  return value.replace(/^['"]|['"]$/g, '').trim();
}

/**
 * Constrói a seção **adaptadora** do Open Cowork.
 *
 * Esta é a peça que impede o modelo de seguir a sintaxe CLI. Ela:
 *  1. declara a interface real (tools agregadas);
 *  2. mapeia cada operação para o agregado correspondente (tabela gerada do
 *     catálogo — nunca hardcoded, para acompanhar o contrato upstream);
 *  3. traduz a grafia CLI (hífen) para a grafia da tool (underscore);
 *  4. documenta como abrir as references sob demanda;
 *  5. reescreve a semântica de entrega no vocabulário do Open Cowork.
 */
export function buildAdapterSection(operations: readonly AgentDesktopOperation[]): string {
  const grouped = groupOperationsByAggregate(operations);
  const lines: string[] = [];

  lines.push('## Open Cowork adapter (LEIA ANTES DO GUIA ABAIXO)');
  lines.push('');
  lines.push(
    'O guia original do `agent-desktop` foi escrito para a **CLI** (`agent-desktop <comando>`).'
  );
  lines.push(
    '**No Open Cowork a CLI não é a interface suportada — não a invoque via `bash`.**'
  );
  lines.push(
    'Use exclusivamente as tools agregadas `desktop_*`: elas passam pelo gate de permissão, ' +
      'respeitam o modo headless e devolvem a semântica de entrega necessária para decidir ' +
      'se uma ação pode ou não ser repetida.'
  );
  lines.push('');

  lines.push('### Como chamar');
  lines.push('');
  lines.push('```');
  lines.push('desktop_<agregado>({ operation: "<operacao>", args: { ... } })');
  lines.push('```');
  lines.push('');
  lines.push(
    'Atenção à grafia: o guia CLI usa **hífen** (`set-value`), a tool usa **underscore** ' +
      '(`set_value`). Os valores de `operation` listados abaixo são os válidos.'
  );
  lines.push('');

  lines.push('### Operações por tool');
  lines.push('');
  lines.push('| Tool | operation | Risco |');
  lines.push('| --- | --- | --- |');
  for (const aggregate of AGGREGATE_ORDER) {
    const ops = grouped[aggregate] ?? [];
    for (const operation of ops) {
      lines.push(
        `| \`${aggregateToolName(aggregate)}\` | \`${operation.operation}\` | ${riskLabel(operation.risk)} |`
      );
    }
  }
  lines.push('');

  lines.push('### Abrir as references sob demanda');
  lines.push('');
  lines.push(
    'As references completas (ex.: `references/commands-observation.md`) **não** estão em disco. ' +
      'Abra apenas a que precisar, sob demanda:'
  );
  lines.push('');
  lines.push('```');
  lines.push('desktop_skills({ operation: "get", args: { name: "agent-desktop", reference: "references/commands-observation.md" } })');
  lines.push('```');
  lines.push('');
  lines.push(
    'Para a skill da plataforma, substitua `name` por `agent-desktop-<plataforma>` ' +
      '(ex.: `agent-desktop-windows`).'
  );
  lines.push('');

  lines.push('### Semântica de entrega (obrigatória)');
  lines.push('');
  lines.push(
    'Toda ação devolve um envelope com `disposition.delivery`. **Nunca repita uma ação ' +
      'automaticamente** sem checar esse campo:'
  );
  lines.push('');
  lines.push('- `not_delivered` → **não** executou. Repetir é seguro.');
  lines.push('- `delivered_verified` → executou e o efeito foi confirmado. Não repita.');
  lines.push('- `delivered_unverified` → executou, efeito não confirmado. Releia o estado antes de decidir.');
  lines.push(
    '- `delivery_uncertain` → estado desconhecido. **Não repita.** Releia o estado e decida.'
  );
  lines.push('');
  lines.push(
    'Erros de identidade (`STALE_REF`, `AMBIGUOUS_TARGET`) exigem um novo `snapshot` — ' +
      'nunca adivinhe o alvo por posição ou geometria.'
  );
  lines.push('');

  lines.push('### Autorização');
  lines.push('');
  lines.push(
    'Operações `physical_input` (cursor, foco, digitação física) exigem autorização ' +
      'explícita do usuário. As demais operam por árvore de acessibilidade e rodam headless.'
  );
  lines.push('');

  return lines.join('\n');
}

/** Rótulo legível do risco. */
function riskLabel(risk: AgentDesktopOperation['risk']): string {
  switch (risk) {
    case 'observation':
      return 'observação';
    case 'semantic_action':
      return 'ação semântica';
    case 'physical_input':
      return 'input físico';
    default:
      return risk;
  }
}

/**
 * Monta o documento final da skill.
 *
 * O frontmatter upstream é **descartado** e regerado: a `description` original
 * diz "using the agent-desktop CLI", o que dispararia o gatilho errado no modelo.
 * Mantemos `name` e acrescentamos `tags`.
 */
export function buildSkillDocument(options: {
  name: string;
  upstreamContent: string;
  operations: readonly AgentDesktopOperation[];
}): string {
  const { name, upstreamContent, operations } = options;
  const { frontmatter, body } = splitFrontmatter(upstreamContent);
  const upstreamDescription = extractDescription(frontmatter);

  const description = buildDescription(name, upstreamDescription, operations);

  const header = [
    '---',
    `name: ${name}`,
    'tags: computer-use, desktop-automation, accessibility, ai-agent, gui-automation, open-cowork',
    'description: >-',
    ...wrapDescription(description),
    '---',
    '',
  ].join('\n');

  return `${header}${buildAdapterSection(operations)}\n---\n\n${body.trim()}\n`;
}

/**
 * Constrói a `description` da skill, orientada à interface real.
 */
function buildDescription(
  name: string,
  upstreamDescription: string,
  operations: readonly AgentDesktopOperation[]
): string {
  const grouped = groupOperationsByAggregate(operations);
  const toolNames = AGGREGATE_ORDER.filter((aggregate) => (grouped[aggregate] ?? []).length > 0).map(
    aggregateToolName
  );

  const parts = [
    `Control semântico de desktop (${name}) via árvore de acessibilidade, exposto no Open Cowork ` +
      `como as tools agregadas ${toolNames.join(', ')}.`,
    'Use quando o agente precisa ver ou agir em uma GUI: clicar botões, preencher formulários, ' +
      'ler estado da UI, navegar menus, marcar checkboxes, rolar, arrastar, digitar, atalhos, ' +
      'capturar tela, gerenciar janelas, usar a área de transferência, abrir/fechar aplicativos ' +
      'e ler notificações.',
    'SEMPRE use as tools `desktop_*` descritas no adaptador — a sintaxe `agent-desktop <comando>` ' +
      'do guia original NÃO se aplica aqui.',
  ];

  if (upstreamDescription) {
    parts.push(`Contexto do guia upstream: ${upstreamDescription}`);
  }

  return parts.join(' ');
}

/**
 * Quebra a descrição em linhas com indentação de 2 espaços (block scalar `>-`).
 */
function wrapDescription(description: string, width = 100): string[] {
  const words = description.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + word.length + 1 <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  return lines.map((line) => `  ${line}`);
}

/**
 * Decide quais skills materializar.
 *
 * Padrão: a core (`agent-desktop`) + a skill da plataforma corrente
 * (marcada com `current: true` pelo upstream).
 */
export function selectSkillNames(
  summaries: readonly AgentDesktopSkillSummary[],
  requested?: readonly string[]
): string[] {
  if (requested && requested.length > 0) {
    return [...new Set(requested)];
  }

  const names: string[] = [];
  if (summaries.some((skill) => skill.name === AGENT_DESKTOP_CORE_SKILL)) {
    names.push(AGENT_DESKTOP_CORE_SKILL);
  }
  const current = summaries.find((skill) => skill.current === true);
  if (current && current.name !== AGENT_DESKTOP_CORE_SKILL) {
    names.push(current.name);
  }
  return names;
}

/**
 * Materializa as skills do agent-desktop em disco.
 *
 * Idempotente: se o cache versionado já existe, reaproveita (sem spawn).
 * Falha de extração de **uma** skill não invalida as demais.
 */
export async function materializeAgentDesktopSkills(
  options: MaterializeAgentDesktopSkillsOptions
): Promise<AgentDesktopSkillMaterialization> {
  const exec = options.exec ?? defaultExec;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const { binaryPath, targetRoot } = options;
  const operations = options.operations ?? buildStaticOperationCatalog();

  const version =
    options.version ?? (await readAgentDesktopVersion(binaryPath, exec, timeoutMs));
  const directory = path.join(targetRoot, version);

  // Fast path: cache versionado já materializado — nenhum spawn.
  const marker = readMaterializationMarker(directory);
  if (marker && !options.skillNames) {
    const cachedSkills = marker.skills
      .filter((name) => fs.existsSync(path.join(directory, name, 'SKILL.md')))
      .map((name) => describeMaterializedSkill(directory, name));
    if (cachedSkills.length === marker.skills.length && cachedSkills.length > 0) {
      return { directory, version, skills: cachedSkills, cached: true };
    }
  }

  const summaries = await listAgentDesktopSkills(binaryPath, exec, timeoutMs);
  const names = selectSkillNames(summaries, options.skillNames);

  const skills: AgentDesktopMaterializedSkill[] = [];
  let cached = false;

  for (const name of names) {
    const skillDirectory = path.join(directory, name);
    const filePath = path.join(skillDirectory, 'SKILL.md');

    if (fs.existsSync(filePath)) {
      cached = true;
      skills.push(describeMaterializedSkill(directory, name));
      continue;
    }

    const upstreamContent = await extractAgentDesktopSkillGuide(binaryPath, name, exec, timeoutMs);
    const document = buildSkillDocument({ name, upstreamContent, operations });

    fs.mkdirSync(skillDirectory, { recursive: true });
    fs.writeFileSync(filePath, document, 'utf8');

    skills.push({
      name,
      filePath,
      directory: skillDirectory,
      description: extractDescription(splitFrontmatter(document).frontmatter),
    });
  }

  writeMaterializationMarker(directory, { version, skills: names });

  return { directory, version, skills, cached };
}

/** Nome do arquivo de marcador do cache versionado. */
const MATERIALIZATION_MARKER_FILE = '.materialized.json';

interface MaterializationMarker {
  version: string;
  skills: string[];
}

/** Descreve uma skill já materializada em disco. */
function describeMaterializedSkill(
  directory: string,
  name: string
): AgentDesktopMaterializedSkill {
  const skillDirectory = path.join(directory, name);
  const filePath = path.join(skillDirectory, 'SKILL.md');
  return {
    name,
    filePath,
    directory: skillDirectory,
    description: readCachedDescription(filePath),
  };
}

/** Lê o marcador de materialização (optimização — ausência não é erro). */
function readMaterializationMarker(directory: string): MaterializationMarker | null {
  try {
    const raw = fs.readFileSync(path.join(directory, MATERIALIZATION_MARKER_FILE), 'utf8');
    const parsed = JSON.parse(raw) as MaterializationMarker;
    if (!parsed || !Array.isArray(parsed.skills)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Grava o marcador de materialização. */
function writeMaterializationMarker(directory: string, marker: MaterializationMarker): void {
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, MATERIALIZATION_MARKER_FILE),
      `${JSON.stringify(marker, null, 2)}\n`,
      'utf8'
    );
  } catch {
    // O marcador é apenas otimização: falhar aqui não invalida a materialização.
  }
}

/**
 * Lê a `description` de um `SKILL.md` já materializado.
 */
function readCachedDescription(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return extractDescription(splitFrontmatter(content).frontmatter);
  } catch {
    return '';
  }
}

/**
 * `execFile` padrão (Node).
 */
const defaultExec: AgentDesktopSkillExec = (command, args, execOptions) =>
  new Promise((resolve, reject) => {
    nodeExecFile(
      command,
      [...args],
      { timeout: execOptions.timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
