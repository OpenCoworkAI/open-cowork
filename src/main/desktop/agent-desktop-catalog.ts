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
 *     conhecida — e agora são **explícitas para as 67 operações reais** do
 *     v1.2.0, para que nenhuma operação caia silenciosamente no fallback.
 *
 *  2. **Toda operação carrega uma semântica de risco e de entrega.** Risco
 *     governa o hook de permissão (observação é livre; input físico exige
 *     autorização explícita). Entrega (`disposition`) governa o retry: só
 *     `not_delivered` é repetível — timeout NÃO prova que a ação não ocorreu
 *     (achado C4), então nada é re-executado automaticamente.
 *
 * Contrato verificado contra o binário real em 2026-11-09 (spike 0):
 * `agent-desktop v1.2.0`, Windows x64, 67 tools. Ver
 * `tests/fixtures/agent-desktop-tools-v1.2.0.json` e
 * `SPIKE-EMPACOTAMENTO-AGENT-DESKTOP.md` §10.
 */

/** Prefixo das tools do upstream (`src/mcp/catalog.rs`). */
export const UPSTREAM_TOOL_PREFIX = 'desktop_';

/**
 * Tag do upstream com o qual este catálogo foi verificado.
 * As tabelas abaixo valem para esta versão; upgrade do upstream exige
 * reexecutar o spike de contrato (teste `agent-desktop-upstream-contract.test.ts`).
 */
export const UPSTREAM_CONTRACT_TAG = 'v1.2.0';

/** Agregados expostos ao modelo (metodologia de computer use semântico). */
export type AgentDesktopAggregate =
  | 'observe'
  | 'act'
  | 'wait'
  | 'app'
  | 'window'
  | 'clipboard'
  | 'notifications'
  | 'status'
  | 'skills';

export const AGGREGATE_ORDER: readonly AgentDesktopAggregate[] = [
  'observe',
  'act',
  'wait',
  'app',
  'window',
  'clipboard',
  'notifications',
  'status',
  // `skills` por último: é leitura pura e de uso raro (carregar uma reference
  // sob demanda), então não deve competir por atenção no topo da lista.
  'skills',
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
  /** Comando executado (presente no upstream v1.2.0). */
  command?: string;
  data?: unknown;
  /**
   * Disposition da ação bem-sucedida. O upstream a coloca **dentro de `data`**
   * ("Action results carry `data.disposition`") — o cliente precisa ler aqui,
   * não só em `error.disposition`.
   */
  error?: {
    code?: string;
    message?: string;
    disposition?: { delivery?: unknown; retry?: unknown };
    recovery?: string;
    details?: unknown;
  };
}

/**
 * Operação → agregado, **explícita para as 67 operações reais** do upstream
 * v1.2.0 (ver `tests/fixtures/agent-desktop-tools-v1.2.0.json`).
 *
 * Tudo que não estiver na tabela cai em `act` (fail-safe: nunca em observação).
 * O teste de contrato falha se o upstream ganhar uma operação nova sem
 * classificação explícita — para que a adição seja uma decisão, não um acidente.
 */
export const AGGREGATE_BY_OPERATION: Readonly<Record<string, AgentDesktopAggregate>> = {
  // --- observe: leitura da árvore de acessibilidade e de estado ---
  snapshot: 'observe',
  find: 'observe',
  screenshot: 'observe',
  get: 'observe',
  is: 'observe',
  list_surfaces: 'observe',
  skills_list: 'skills',
  skills_get: 'skills',
  skills_path: 'skills',

  // --- act: ação semântica sobre um elemento ---
  click: 'act',
  double_click: 'act',
  // Triple-click e fisica por definicao do upstream: devolve POLICY_DENIED
  // quando o input fisico esta desligado.
  triple_click: 'act',
  right_click: 'act',
  type: 'act',
  set_value: 'act',
  clear: 'act',
  focus: 'act',
  select: 'act',
  toggle: 'act',
  check: 'act',
  uncheck: 'act',
  expand: 'act',
  collapse: 'act',
  scroll: 'act',
  scroll_to: 'act',
  press: 'act',
  key_down: 'act',
  key_up: 'act',
  // Input fisico: cursor, hover e drag. Risco physical_input (autorizacao
  // explicita por operacao), agregado act.
  hover: 'act',
  drag: 'act',
  mouse_move: 'act',
  mouse_click: 'act',
  mouse_down: 'act',
  mouse_up: 'act',
  mouse_wheel: 'act',
  // Abre uma superfície do shell (start-menu, taskbar, dock, menu-bar-extras).
  // **Tem efeito visível** — não é observação, apesar de parecer uma consulta.
  open_system_surface: 'act',
  // Execução de um lote sequencial e não-atômico; o risco é escalado em runtime.
  batch: 'act',

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

  // --- status: diagnóstico, sessão, trace e overlay ---
  status: 'status',
  permissions: 'status',
  version: 'status',
  session_start: 'status',
  session_end: 'status',
  session_list: 'status',
  session_gc: 'status',
  cursor_overlay_enable: 'status',
  cursor_overlay_disable: 'status',
  trace_show: 'status',
  trace_export: 'status',
};

/**
 * Operações que **movem o cursor ou enviam evento físico**.
 * Precisam de autorização explícita — o padrão é headless.
 *
 * Verificado no upstream v1.2.0:
 *  - `triple_click` retorna `POLICY_DENIED` quando input físico está desabilitado
 *    → o próprio upstream a classifica como física;
 *  - `cursor_overlay_enable` desenha um cursor animado na tela do usuário
 *    (args `travel_ms`, `motion_seed`, `tremor`) → efeito físico no desktop.
 */
export const PHYSICAL_INPUT_OPERATIONS: ReadonlySet<string> = new Set([
  'hover',
  'drag',
  'mouse_move',
  'mouse_click',
  'mouse_down',
  'mouse_up',
  'mouse_wheel',
  'triple_click',
  'cursor_overlay_enable',
]);

/**
 * Operações puramente de leitura (nunca exigem confirmação).
 *
 * `wait` entra aqui porque apenas faz polling de estado — não altera nada.
 * `session_start` / `session_end` / `session_gc` / `trace_export` **não** entram:
 * criam, selam ou apagam estado no disco.
 */
export const OBSERVATION_OPERATIONS: ReadonlySet<string> = new Set([
  'snapshot',
  'find',
  'screenshot',
  'get',
  'is',
  'list_surfaces',
  'skills_list',
  'skills_get',
  'skills_path',
  'list_apps',
  'list_windows',
  'list_displays',
  'list_notifications',
  'status',
  'permissions',
  'version',
  'session_list',
  'trace_show',
  'wait',
]);

/**
 * Nome do argumento que carrega o lote no upstream v1.2.0.
 * `desktop_batch` recebe `commands_json`: uma **string** com um array JSON de
 * `{ command, args }`.
 */
export const BATCH_COMMANDS_ARG = 'commands_json';

/** Extrai o nome da operação a partir do nome da tool upstream. */
export function operationFromUpstreamTool(toolName: string): string | null {
  if (!toolName.startsWith(UPSTREAM_TOOL_PREFIX)) return null;
  const operation = toolName.slice(UPSTREAM_TOOL_PREFIX.length);
  return operation.length > 0 ? operation : null;
}

/**
 * A operação está explicitamente classificada?
 *
 * `false` significa que o upstream introduziu algo novo e o fallback `act`
 * foi aplicado — precisa de revisão explícita, não de default silencioso.
 */
export function isKnownOperation(operation: string): boolean {
  return operation in AGGREGATE_BY_OPERATION;
}

/**
 * Operação pedida por uma chamada da tool agregada.
 * Lê `input.operation` — o envelope `{ operation, args }` das 8 tools.
 */
export function requestedOperation(input: Record<string, unknown>): string {
  return typeof input.operation === 'string' ? input.operation : '';
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
  const operation = requestedOperation(input);
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
    skills: [],
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
 *
 * O upstream v1.2.0 usa `commands_json`: uma **string** contendo um array JSON
 * de `{ command, args }`. Aceitamos também `operations` / `ops` / `actions` /
 * `commands` (array direto) para tolerância e para o stub de teste.
 */
export function extractBatchedOperations(args: Record<string, unknown>): string[] {
  const raw = readBatchPayload(args);
  if (!Array.isArray(raw)) return [];

  const names: string[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      names.push(operationFromUpstreamTool(entry) ?? entry);
      continue;
    }
    if (entry && typeof entry === 'object') {
      const candidate = entry as {
        command?: unknown;
        operation?: unknown;
        tool?: unknown;
        name?: unknown;
      };
      const value =
        candidate.command ?? candidate.operation ?? candidate.tool ?? candidate.name;
      if (typeof value === 'string') {
        names.push(operationFromUpstreamTool(value) ?? value);
      }
    }
  }
  return names;
}

/** Lê o payload do lote, aceitando `commands_json` (string JSON) e arrays diretos. */
function readBatchPayload(args: Record<string, unknown>): unknown {
  const commandsJson = args[BATCH_COMMANDS_ARG];
  if (typeof commandsJson === 'string') {
    try {
      const parsed = JSON.parse(commandsJson);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // JSON inválido → sem operações detectadas (o upstream vai recusar a call
      // com INVALID_ARGS, que é `not_delivered` e repetível).
      return undefined;
    }
  } else if (Array.isArray(commandsJson)) {
    return commandsJson;
  }

  const raw = args.operations ?? args.ops ?? args.actions ?? args.commands;
  return Array.isArray(raw) ? raw : undefined;
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
 * Extrai a disposition do upstream.
 *
 * O upstream v1.2.0 usa `disposition.retry` como a **string** `"safe"` (não
 * booleano) — "Retry or substitute an action only when `disposition.retry` is
 * `safe`. Only `not_delivered` is safe."
 *
 * Só repetimos quando **as duas** condições valem: a entrega foi comprovadamente
 * `not_delivered` **e** o upstream declarou o retry como seguro. Qualquer valor
 * desconhecido é fail-safe (não repete).
 */
export function parseDisposition(value: unknown): AgentDesktopDisposition {
  const raw = (value ?? {}) as { delivery?: unknown; retry?: unknown };
  const delivery = parseDelivery(raw.delivery);
  const retryDeclaredSafe = raw.retry === 'safe' || raw.retry === true;
  return {
    delivery,
    retry: delivery === 'not_delivered' && retryDeclaredSafe,
  };
}

/**
 * Interpreta o resultado de uma tool MCP como envelope do upstream.
 * Aceita `structuredContent` ou o primeiro bloco de texto com JSON.
 *
 * Devolve `null` quando o upstream respondeu **texto simples** — o caso
 * documentado de "a call rejected before the command runs returns plain text".
 * Nesse caso o cliente **não** pode tratar a resposta como sucesso.
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

/**
 * Disposition declarada no **sucesso** — o upstream a coloca em `data.disposition`
 * ("Action results carry `data.disposition`").
 */
export function parseSuccessDisposition(envelope: AgentDesktopEnvelope | null): AgentDesktopDisposition | null {
  if (!envelope || envelope.ok !== true) return null;
  const data = envelope.data;
  if (!data || typeof data !== 'object') return null;
  const disposition = (data as { disposition?: unknown }).disposition;
  if (!disposition || typeof disposition !== 'object') return null;
  return parseDisposition(disposition);
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
