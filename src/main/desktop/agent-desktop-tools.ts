/**
 * Tools agregadas do agent-desktop expostas ao modelo.
 *
 * O upstream publica ~60 tools (`desktop_snapshot`, `desktop_click`, …).
 * Expor todas ao modelo é ruído: o agente se perde em catálogo grande e
 * confunde camada semântica com camada visual (achado R8).
 *
 * Aqui a superfície é **8 tools** — uma por agregado — e cada chamada carrega
 * `{ operation, args }`:
 *
 *   desktop_observe({ operation: "snapshot", args: { depth: 3 } })
 *
 * O `operation` é validado contra o catálogo **real** que veio do `tools/list`
 * do upstream, então:
 *  - comando novo do upstream aparece sozinho (sem hardcode de catálogo);
 *  - operação inexistente é recusada com mensagem explícita, sem chamar o filho;
 *  - o modelo nunca inventa nome de tool.
 *
 * O schema de `args` é **aberto** (`additionalProperties: true`) porque cada
 * operação upstream tem seus próprios parâmetros e o catálogo completo mudaria
 * a cada release do upstream. O envelope de retorno carrega `delivery` para que
 * o modelo distinga "não entregou" de "entregou mas não deu para verificar".
 */

import { Type, type TSchema } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';

import {
  AGGREGATE_ORDER,
  aggregateToolName,
  groupOperationsByAggregate,
  resolveEffectiveRisk,
  type AgentDesktopAggregate,
  type AgentDesktopOperation,
  type AgentDesktopRisk,
} from './agent-desktop-catalog';
import type { AgentDesktopClient, AgentDesktopCallResult } from './agent-desktop-client';
import { log } from '../utils/logger';

export interface AgentDesktopToolsOptions {
  client: AgentDesktopClient;
  /** Callback para avaliar a política de permissão antes de executar. */
  onBeforeExecute?: (context: {
    aggregate: AgentDesktopAggregate;
    operation: AgentDesktopOperation;
    risk: AgentDesktopRisk;
    args: Record<string, unknown>;
  }) => void | Promise<void>;
}

/** Descrições por agregado — usadas na descrição da tool para o modelo. */
const AGGREGATE_DESCRIPTIONS: Record<AgentDesktopAggregate, string> = {
  observe:
    'Inspect the desktop accessibility tree. Read-only: takes no action on the system. ' +
    'Start here: call operation "snapshot" to capture the current UI, then "find" to locate ' +
    'elements by role/name, then "get"/"is" to read their state.',
  act:
    'Act on a UI element identified by a reference from a previous observe (snapshot/find). ' +
    'Prefer semantic actions (click, type, set_value) over raw mouse actions. ' +
    'After acting, observe again to verify the effect.',
  wait:
    'Wait for a UI condition (element appears, window focused, text changed) instead of a fixed sleep.',
  app: 'Manage application lifecycle: launch an app, close an app, list running apps.',
  window: 'Inspect and control windows and displays: list, focus, resize, move, minimize, maximize, restore.',
  clipboard: 'Read or write the system clipboard. Reading returns the clipboard content to the model.',
  notifications: 'Inspect and act on system notifications.',
  status:
    'Diagnostics: platform status, accessibility permissions, version, session info and trace. ' +
    'Use "permissions" to check whether accessibility access is granted.',
};

/**
 * Mapeia o nome da operação pedida pelo modelo para a operação do catálogo.
 * Aceita o nome sem prefixo (`snapshot`) ou completo (`desktop_snapshot`).
 */
export function resolveRequestedOperation(
  operations: readonly AgentDesktopOperation[],
  requested: string
): AgentDesktopOperation | undefined {
  const normalized = requested.startsWith('desktop_')
    ? requested.slice('desktop_'.length)
    : requested;
  return operations.find((operation) => operation.operation === normalized);
}

/**
 * Formata o resultado da chamada para o modelo.
 *
 * Em caso de falha, a mensagem é explícita sobre o estado de entrega e **instrui
 * o modelo a não repetir** quando a entrega é incerta — é a contraparte textual
 * do achado C4 (retry de transporte pode duplicar ação).
 */
export function formatAgentDesktopResult(
  aggregate: AgentDesktopAggregate,
  operation: string,
  result: AgentDesktopCallResult
): string {
  if (result.ok) {
    const payload = result.data === undefined ? '' : `\n${safeJson(result.data)}`;
    return [
      `OK — ${aggregate}/${operation} (delivery: ${result.delivery})`,
      result.retried ? 'note: the call was retried once because the first attempt was not delivered.' : '',
      payload,
    ]
      .filter(Boolean)
      .join('\n');
  }

  const lines = [
    `FAILED — ${aggregate}/${operation}`,
    `delivery: ${result.delivery}`,
    result.code ? `code: ${result.code}` : '',
    result.message ? `message: ${result.message}` : '',
    result.recovery ? `recovery: ${result.recovery}` : '',
  ].filter(Boolean);

  if (result.delivery === 'delivery_uncertain') {
    lines.push(
      'The action may or may not have been applied. Do NOT call it again automatically — ' +
        'observe the current state first (desktop_observe) and decide from that.'
    );
  } else if (result.delivery === 'delivered_unverified') {
    lines.push('The action was delivered but could not be verified. Observe to confirm the effect.');
  } else if (result.delivery === 'not_delivered') {
    lines.push('The action was not delivered. It is safe to retry once.');
  }

  if (result.details !== undefined) {
    lines.push(`details: ${safeJson(result.details)}`);
  }

  return lines.join('\n');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[unserializable]';
  }
}

/**
 * Constrói as 8 tools agregadas a partir do catálogo real do upstream.
 * Agregados sem operação disponível são omitidos (ex.: `clipboard` em
 * plataformas sem suporte) — o modelo não deve ver tool que não funciona.
 */
export function buildAgentDesktopTools(options: AgentDesktopToolsOptions): ToolDefinition[] {
  const operations = options.client.getOperations();
  const grouped = groupOperationsByAggregate(operations);

  const tools: ToolDefinition[] = [];

  for (const aggregate of AGGREGATE_ORDER) {
    const aggregateOperations = grouped[aggregate];
    if (aggregateOperations.length === 0) continue;

    const operationNames = aggregateOperations.map((operation) => operation.operation);
    const physicalOperations = aggregateOperations
      .filter((operation) => operation.risk === 'physical_input')
      .map((operation) => operation.operation);

    const parameters = Type.Object(
      {
        operation: Type.String({
          description: `Operation to perform. One of: ${operationNames.join(', ')}.`,
          enum: operationNames,
        }),
        args: Type.Optional(
          Type.Record(Type.String(), Type.Unknown(), {
            description:
              'Arguments for the operation, as documented by the agent-desktop CLI ' +
              '(e.g. snapshot: { depth }, click: { ref }, find: { name, role }). ' +
              'Omit when the operation takes no arguments.',
          })
        ),
      },
      { additionalProperties: false }
    ) as TSchema;

    const toolName = aggregateToolName(aggregate);
    const physicalNote =
      physicalOperations.length > 0
        ? ` Operations requiring explicit authorization (physical input): ${physicalOperations.join(', ')}.`
        : '';

    const toolDef: ToolDefinition<TSchema, unknown> = {
      name: toolName,
      label: `Desktop → ${aggregate}`,
      description:
        `${AGGREGATE_DESCRIPTIONS[aggregate]} ` +
        `Available operations: ${operationNames.join(', ')}.` +
        physicalNote,
      promptSnippet: `desktop_${aggregate} — semantic desktop access (${aggregate})`,
      parameters,
      async execute(_toolCallId, params, signal) {
        const request = params as { operation?: unknown; args?: unknown };
        const requested = typeof request.operation === 'string' ? request.operation : '';
        const args =
          request.args && typeof request.args === 'object'
            ? (request.args as Record<string, unknown>)
            : {};

        const operation = resolveRequestedOperation(operations, requested);
        if (!operation) {
          throw new Error(
            `Unknown operation "${requested}" for ${toolName}. ` +
              `Available: ${operationNames.join(', ')}`
          );
        }

        const risk = resolveEffectiveRisk(operation, args);
        if (options.onBeforeExecute) {
          await options.onBeforeExecute({ aggregate, operation, risk, args });
        }

        log(
          `[AgentDesktopTools] ${toolName} → ${operation.operation} (risk: ${risk})`
        );

        const result = await options.client.call(operation.operation, args, signal);
        const text = formatAgentDesktopResult(aggregate, operation.operation, result);

        return {
          content: [{ type: 'text' as const, text }],
          details: {
            aggregate,
            operation: operation.operation,
            delivery: result.delivery,
            ok: result.ok,
            risk,
          },
        };
      },
    };

    tools.push(toolDef);
  }

  return tools;
}
