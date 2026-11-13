import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AGGREGATE_BY_OPERATION,
  OBSERVATION_OPERATIONS,
  PHYSICAL_INPUT_OPERATIONS,
  buildOperationCatalog,
  classifyAggregate,
  classifyRisk,
  isKnownOperation,
} from '../src/main/desktop/agent-desktop-catalog';

/**
 * Contrato com o upstream REAL.
 *
 * O fixture é o `tools/list` capturado do `agent-desktop.exe` v1.2.0 (Windows x64)
 * em 2026-11-09 — 67 tools. Este teste existe para que:
 *  - uma operação nova do upstream **não** caia silenciosamente no fallback
 *    `act` (o fallback é seguro, mas esconderia uma classificação ausente);
 *  - uma tabela nossa **não** aponte para operações que não existem mais;
 *  - as operações que o upstream trata como físicas continuem físicas.
 *
 * Ao atualizar o upstream: regenere o fixture e ajuste as tabelas — o teste
 * falha até que a classificação seja uma decisão explícita.
 */
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/agent-desktop-tools-v1.2.0.json');

interface UpstreamTool {
  name: string;
  description: string;
  inputSchema: { properties?: Record<string, unknown>; required?: string[] };
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
  source: string;
  tools: UpstreamTool[];
};

const upstreamToolNames = fixture.tools.map((tool) => tool.name);
const upstreamOperations = upstreamToolNames.map((name) => name.replace(/^desktop_/, ''));

describe(`contrato com o upstream agent-desktop (${fixture.source})`, () => {
  it('o fixture tem as 67 tools do upstream v1.2.0', () => {
    expect(upstreamToolNames).toHaveLength(67);
    expect(fixture.source).toContain('v1.2.0');
  });

  it('toda operação real tem classificação explícita (sem fallback silencioso)', () => {
    const semClassificacao = upstreamOperations.filter((operation) => !isKnownOperation(operation));
    expect(semClassificacao).toEqual([]);
  });

  it('nenhuma entrada da tabela aponta para operação inexistente', () => {
    const obsoletas = Object.keys(AGGREGATE_BY_OPERATION).filter(
      (operation) => !upstreamOperations.includes(operation)
    );
    expect(obsoletas).toEqual([]);
  });

  it('as tabelas de risco não têm entradas obsoletas', () => {
    expect([...PHYSICAL_INPUT_OPERATIONS].filter((op) => !upstreamOperations.includes(op))).toEqual(
      []
    );
    expect([...OBSERVATION_OPERATIONS].filter((op) => !upstreamOperations.includes(op))).toEqual([]);
  });

  it('as operações físicas do upstream permanecem físicas', () => {
    // O upstream devolve POLICY_DENIED para `triple_click` quando o input
    // físico está desabilitado — ou seja, é física por definição do upstream.
    expect(PHYSICAL_INPUT_OPERATIONS.has('triple_click')).toBe(true);
    // `cursor_overlay_enable` desenha um cursor animado na tela do usuário.
    expect(PHYSICAL_INPUT_OPERATIONS.has('cursor_overlay_enable')).toBe(true);
    for (const operation of ['mouse_click', 'mouse_move', 'hover', 'drag']) {
      expect(PHYSICAL_INPUT_OPERATIONS.has(operation)).toBe(true);
    }
  });

  it('`open_system_surface` é ação, não observação', () => {
    // Abre o start-menu/taskbar/dock: tem efeito visível. Classificá-lo como
    // observação colocaria uma ação com efeito colateral dentro de
    // `desktop_observe`, cuja descrição diz "takes no action on the system".
    expect(classifyAggregate('open_system_surface')).toBe('act');
    expect(classifyRisk('open_system_surface')).toBe('semantic_action');
    expect(OBSERVATION_OPERATIONS.has('open_system_surface')).toBe(false);
  });

  it('operações que criam/apagam estado não são observações', () => {
    for (const operation of [
      'session_start',
      'session_end',
      'session_gc',
      'trace_export',
    ]) {
      expect(OBSERVATION_OPERATIONS.has(operation)).toBe(false);
      expect(classifyRisk(operation)).toBe('semantic_action');
    }
  });

  it('o catálogo construído a partir do fixture real cobre as 67 operações', () => {
    const catalog = buildOperationCatalog(upstreamToolNames);
    expect(catalog).toHaveLength(67);
    expect(catalog.every((operation) => isKnownOperation(operation.operation))).toBe(true);
  });

  it('todo tool real aceita batch com `commands_json`', () => {
    const batch = fixture.tools.find((tool) => tool.name === 'desktop_batch');
    expect(batch).toBeDefined();
    expect(Object.keys(batch?.inputSchema.properties ?? {})).toContain('commands_json');
    expect(batch?.inputSchema.required).toContain('commands_json');
  });
});
