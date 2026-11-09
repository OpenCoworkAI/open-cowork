/**
 * Catálogo do agent-desktop (vercel-labs/agent-desktop, v1.2.0+).
 *
 * O upstream expõe, via `agent-desktop mcp`, uma tool MCP por comando leaf da CLI,
 * com o prefixo `desktop_` (ex.: `desktop_snapshot`, `desktop_click`).
 *
 * Este módulo é a fronteira "conhecida" entre o catálogo bruto do upstream e a
 * superfície agregada exposta ao modelo (8 tools). Duas decisões estruturam tudo:
 *
 *  1. **O catálogo NÃO é hardcoded.** Ele é derivado de `tools/list` em runtime
 *     (ver `buildOperationCatalog`), então comandos novos do upstream aparecem
 *     sozinhos. As tabelas abaixo são apenas a *classificação* de cada operação
 *     conhecida — o fallback (`act`) cobre o que for novo.
 *
 *  2. **Toda operação carrega uma semântica de risco e de entrega.** Risco
 *     governa o hook de permissão (observação é livre; input físico exige
 *     autorização explícita). Entrega (`disposition`) governa o retry: só
 *     `not_delivered` é repetível — timeout NÃO prova que a ação não ocorreu
 *     (achado C4), então nada é re-executado automaticamente.
 */

/** Prefixo das tools do upstream (`src/mcp/catalog.rs`). */
export const UPSTREAM_TOOL_PREFIX = 'desktop_';

/** Agregados expostos ao modelo (metodologia de computer use semântico). */
export type AgentDesktopAggregate =
  | 'observe'
  | 'act'
  | 'wait'
  | 'app'
  | 'window'
  | 'clipboard'
  | 'notifications'
  | 'status';

export const AGGREGATE_ORDER: readonly AgentDesktopAggregate[] = [
  'observe',
  'act',
  'wait',
  'app',
  'window',
  'clipboard',
  'notifications',
  'status',
];

/** Nome da tool agregada exposta ao modelo. */
export function aggregateToolName(aggregate: AgentDesktopAggregate): string {
  return `desktop_${aggregate}`;
}

/**
 * Risco da operação.
 * - `observation`     — só lê (snapshot, find, list_*). Sem efeito colateral.
 * - `semantic_action` — age via árvore de acessibilidade (AX/UIA/AT-SPI).
 * - `physical_input`  — move cursor/roba foco/envia evento físico. Exige
 *                        autorização explícita (headless por padrão).
 */
export type AgentDesktopRisk = 'observation' | 'semantic_action' | 'physical_input';

export interface AgentDesktopOperation {
  /** Nome da operação sem prefixo (ex.: `snapshot`). */
  operation: string;
  /** Nome da tool upstream (ex.: `desktop_snapshot`). */
  upstreamTool: string;
  /** Agregado ao qual pertence. */
  aggregate: AgentDesktopAggregate;
  /** Risco para o hook de permissão. */
  risk: AgentDesktopRisk;
}

/**
 * Semântica de entrega (4 estados). `not_delivered` é o único repetível.
 * `unknown` do upstream é tratado como `delivery_uncertain` — fail-safe.
 */
export type AgentDesktopDelivery =
  | 'not_delivered'
  | 'delivered_unverified'
  | 'delivered_verified'
  | 'delivery_uncertain';

export interface AgentDesktopDisposition {
  delivery: AgentDesktopDelivery;
  /** Repetição é segura? Só `true` quando `delivery === 'not_delivered'`. */
  retry: boolean;
}

/** Envelope de resposta do upstream (documentação JSON v2.6). */
export interface AgentDesktopEnvelope {
  version?: string;
  ok: boolean;
  data?: unknown;
  error?: {
    code?: string;
    message?: string;
    disposition?: { delivery?: string; retry?: boolean };
    recovery?: string;
    details?: unknown;
  };
}

/** Operação → agregado. Tudo que não estiver na tabela cai em `act`. */
const AGGREGATE_BY_OPERATION: Readonly<Record<string, AgentDesktopAggregate>> = {
  // --- observe: leitura da árvore de acessibilidade ---
  snapshot: 'observe',
  find: 'observe',
  screenshot: 'observe',
  get: 'observe',
  is: 'observe',
  list_surfaces: 'observe',
  skills: 'observe',
  open_system_surface: 'observe',

  // --- wait: espera orientada a evento ---
  wait: 'wait',

  // --- app: lifecycle de aplicações ---
  launch: 'app',
  close_app: 'app',
  list_apps: 'app',

  // --- window: janelas e displays ---
  list_windows: 'window',
  focus_window: 'window',
  resize_window: 'window',
  move_window: 'window',
  minimize: 'window',
  maximize: 'window',
  restore: 'window',
  list_displays: 'window',

  // --- clipboard ---
  clipboard_get: 'clipboard',
  clipboard_set: 'clipboard',
  clipboard_clear: 'clipboard',

  // --- notifications ---
  list_notifications: 'notifications',
  dismiss_notification: 'notifications',
  dismiss_all_notifications: 'notifications',
  notification_action: 'notifications',

  // --- status: diagnóstico ---
  status: 'status',
  permissions: 'status',
  version: 'status',
  session: 'status',
  trace: 'status',
  cursor_overlay: 'status',
};

/**
 * Operações que **movem o cursor ou enviam evento físico**.
 * Precisam de autorização explícita — o padrão é headless.
 */
const PHYSICAL_INPUT_OPERATIONS: ReadonlySet<string> = new Set([
  'hover',
  'drag',
  'mouse_move',
  'mouse_click',
  'mouse_down',
  'mouse_up',
  'mouse_wheel',
  'cursor_overlay',
]);

/** Operações puramente de leitura (nunca exigem confirmação). */
const OBSERVATION_OPERATIONS: ReadonlySet<string> = new Set([
  'snapshot',
  'find',
  'screenshot',
  'get',
  'is',
  'list_surfaces',
  'list_apps',
  'list_windows',
  'list_displays',
  'list_notifications',
  'status',
  'permissions',
  'version',
  'session',
  'skills',
  'trace',
]);

/** Extrai o nome da operação a partir do nome da tool upstream. */
export function operationFromUpstreamTool(toolName: string): string | null {
  if (!toolName.startsWith(UPSTREAM_TOOL_PREFIX)) return null;
  const operation = toolName.slice(UPSTREAM_TOOL_PREFIX.length);
  return operation.length > 0 ? operation : null;
}

/**
 * Operações de **input físico** pedidas por uma chamada.
 *
 * Lê o `operation` da tool agregada (`{ operation, args }`) e, no caso de
 * `batch`, inspeciona as operações aninhadas. É o que o hook de permissão
 * usa para exigir autorização explícita — headless por padrão.
 */
export function collectRequestedPhysicalOperations(
  input: Record<string, unknown>
): string[] {
  const operation = typeof input.operation === 'string' ? input.operation : '';
  if (!operation) return [];

  if (operation !== 'batch') {
    return isPhysicalInputOperation(operation) ? [operation] : [];
  }

  const args =
    input.args && typeof input.args === 'object'
      ? (input.args as Record<string, unknown>)
      : input;

  return extractBatchedOperations(args).filter(isPhysicalInputOperation);
}

/**
 * A operação exige **input físico** (move cursor / evento de mouse)?
 * Usado pelo hook de permissão: input físico só passa com autorização
 * explícita, mesmo que a regra geral da tool permita.
 */
export function isPhysicalInputOperation(operation: string): boolean {
  return PHYSICAL_INPUT_OPERATIONS.has(operation);
}

/** A operação é puramente de leitura (nunca exige confirmação)? */
export function isObservationOperation(operation: string): boolean {
  return OBSERVATION_OPERATIONS.has(operation);
}

/** Classifica a operação no agregado correspondente. */
export function classifyAggregate(operation: string): AgentDesktopAggregate {
  return AGGREGATE_BY_OPERATION[operation] ?? 'act';
}

/** Classifica o risco da operação. */
export function classifyRisk(operation: string): AgentDesktopRisk {
  if (PHYSICAL_INPUT_OPERATIONS.has(operation)) return 'physical_input';
  if (OBSERVATION_OPERATIONS.has(operation)) return 'observation';
  return 'semantic_action';
}

/**
 * Constrói o catálogo a partir dos nomes de tools devolvidos por `tools/list`.
 * Só entram tools com o prefixo `desktop_`; duplicatas são ignoradas.
 */
export function buildOperationCatalog(upstreamToolNames: readonly string[]): AgentDesktopOperation[] {
  const seen = new Set<string>();
  const operations: AgentDesktopOperation[] = [];

  for (const toolName of upstreamToolNames) {
    const operation = operationFromUpstreamTool(toolName);
    if (!operation || seen.has(operation)) continue;
    seen.add(operation);
    operations.push({
      operation,
      upstreamTool: toolName,
      aggregate: classifyAggregate(operation),
      risk: classifyRisk(operation),
    });
  }

  // Ordem estável: por agregado (ordem canônica) e depois por operação.
  return operations.sort((a, b) => {
    const aggregateDiff = AGGREGATE_ORDER.indexOf(a.aggregate) - AGGREGATE_ORDER.indexOf(b.aggregate);
    if (aggregateDiff !== 0) return aggregateDiff;
    return a.operation.localeCompare(b.operation);
  });
}

/** Agrupa as operações por agregado. */
export function groupOperationsByAggregate(
  operations: readonly AgentDesktopOperation[]
): Record<AgentDesktopAggregate, AgentDesktopOperation[]> {
  const grouped = {
    observe: [],
    act: [],
    wait: [],
    app: [],
    window: [],
    clipboard: [],
    notifications: [],
    status: [],
  } as Record<AgentDesktopAggregate, AgentDesktopOperation[]>;

  for (const operation of operations) {
    grouped[operation.aggregate].push(operation);
  }
  return grouped;
}

/**
 * Risco efetivo de uma chamada — pode diferir da classificação estática.
 *
 * `batch` executa várias operações em uma só chamada; se alguma delas for de
 * input físico, a chamada inteira é escalada para `physical_input`.
 */
export function resolveEffectiveRisk(
  operation: AgentDesktopOperation,
  args: Record<string, unknown> | undefined
): AgentDesktopRisk {
  if (operation.operation !== 'batch' || !args) return operation.risk;

  const batched = extractBatchedOperations(args);
  if (batched.some((name) => PHYSICAL_INPUT_OPERATIONS.has(name))) {
    return 'physical_input';
  }
  return operation.risk;
}

/**
 * Extrai os nomes das operações de um `batch`.
 * Aceita tanto `{ operations: [...] }` quanto o array direto.
 */
export function extractBatchedOperations(args: Record<string, unknown>): string[] {
  const raw = args.operations ?? args.ops ?? args.actions;
  if (!Array.isArray(raw)) return [];

  const names: string[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      names.push(entry);
      continue;
    }
    if (entry && typeof entry === 'object') {
      const candidate = (entry as { operation?: unknown; tool?: unknown; name?: unknown });
      const value = candidate.operation ?? candidate.tool ?? candidate.name;
      if (typeof value === 'string') {
        names.push(operationFromUpstreamTool(value) ?? value);
      }
    }
  }
  return names;
}

/** Normaliza o valor de `delivery` do upstream para os 4 estados conhecidos. */
export function parseDelivery(value: unknown): AgentDesktopDelivery {
  switch (value) {
    case 'not_delivered':
      return 'not_delivered';
    case 'delivered_unverified':
      return 'delivered_unverified';
    case 'delivered_verified':
      return 'delivered_verified';
    case 'delivery_uncertain':
      return 'delivery_uncertain';
    default:
      // `unknown` (ou qualquer valor novo) → fail-safe: tratamento como incerto.
      return 'delivery_uncertain';
  }
}

/**
 * Extrai a disposition do erro do upstream.
 * `retry` só é verdadeiro quando a entrega é `not_delivered` — é a única
 * situação em que repetir NÃO pode duplicar uma ação já executada.
 */
export function parseDisposition(value: unknown): AgentDesktopDisposition {
  const raw = (value ?? {}) as { delivery?: unknown; retry?: unknown };
  const delivery = parseDelivery(raw.delivery);
  return {
    delivery,
    retry: delivery === 'not_delivered' && raw.retry !== false,
  };
}

/**
 * Interpreta o resultado de uma tool MCP como envelope do upstream.
 * Aceita `structuredContent` ou o primeiro bloco de texto com JSON.
 */
export function parseEnvelope(raw: unknown): AgentDesktopEnvelope | null {
  const candidates: unknown[] = [];

  if (raw && typeof raw === 'object') {
    const structured = (raw as { structuredContent?: unknown }).structuredContent;
    if (structured !== undefined) candidates.push(structured);

    const content = (raw as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === 'object') {
          const text = (block as { text?: unknown }).text;
          if (typeof text === 'string') candidates.push(text);
        }
      }
    }
  } else if (typeof raw === 'string') {
    candidates.push(raw);
  }

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (!parsed || typeof parsed !== 'object') continue;
    const envelope = parsed as AgentDesktopEnvelope;
    if (typeof envelope.ok === 'boolean') return envelope;
  }

  return null;
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}
