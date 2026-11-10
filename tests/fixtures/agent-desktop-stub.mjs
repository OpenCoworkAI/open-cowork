#!/usr/bin/env node
/**
 * Stub do servidor MCP do agent-desktop, para testes de contrato.
 *
 * Reproduz o **envelope e o formato de resposta do upstream v1.2.0 real**
 * (verificado em 2026-11-09 contra `agent-desktop.exe` v1.2.0, Windows x64):
 *  - 67 tools com o prefixo `desktop_`;
 *  - resultado MCP com `content[].text` (JSON) **e** `structuredContent`
 *    (o mesmo envelope nos dois lugares, como o upstream real);
 *  - envelope `{version:'2.6', command, ok, data|error}`;
 *  - `error.disposition = {delivery, retry}` com `retry` como **string** `"safe"`;
 *  - `data.disposition` presente em ações bem-sucedidas;
 *  - recusa **antes** da execução devolve **texto simples**, sem JSON.
 *
 * Protocolo MCP sobre stdio = JSON-RPC 2.0, uma mensagem por linha.
 *
 * Comportamento controlado por variáveis de ambiente:
 *   STUB_CALL_LOG         — arquivo onde cada `tools/call` é appendido (JSONL)
 *   STUB_FAIL_TOOL        — tool que devolve envelope de erro
 *   STUB_DELIVERY         — estado de entrega do erro (default: delivery_uncertain)
 *   STUB_RETRY            — valor de `disposition.retry` (default: "safe")
 *   STUB_FAIL_TIMES       — quantas vezes a tool falha antes de sucesso (default: ∞)
 *   STUB_REJECT_TOOL      — tool recusada ANTES da execução (texto simples)
 *   STUB_HANG_TOOL        — tool que nunca responde (testa timeout)
 *   STUB_SUCCESS_DELIVERY — disposition em `data` no caso de sucesso
 *   STUB_SUCCESS_RETRY    — `data.disposition.retry` no caso de sucesso
 */

import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const TOOL_NAMES = [
  'desktop_snapshot',
  'desktop_find',
  'desktop_screenshot',
  'desktop_get',
  'desktop_is',
  'desktop_click',
  'desktop_double_click',
  'desktop_triple_click',
  'desktop_right_click',
  'desktop_type',
  'desktop_set_value',
  'desktop_clear',
  'desktop_focus',
  'desktop_select',
  'desktop_toggle',
  'desktop_check',
  'desktop_uncheck',
  'desktop_expand',
  'desktop_collapse',
  'desktop_scroll',
  'desktop_scroll_to',
  'desktop_press',
  'desktop_key_down',
  'desktop_key_up',
  'desktop_hover',
  'desktop_drag',
  'desktop_mouse_move',
  'desktop_mouse_click',
  'desktop_mouse_down',
  'desktop_mouse_up',
  'desktop_mouse_wheel',
  'desktop_launch',
  'desktop_close_app',
  'desktop_list_windows',
  'desktop_list_displays',
  'desktop_list_apps',
  'desktop_focus_window',
  'desktop_resize_window',
  'desktop_move_window',
  'desktop_minimize',
  'desktop_maximize',
  'desktop_restore',
  'desktop_list_surfaces',
  'desktop_open_system_surface',
  'desktop_list_notifications',
  'desktop_dismiss_notification',
  'desktop_dismiss_all_notifications',
  'desktop_notification_action',
  'desktop_clipboard_get',
  'desktop_clipboard_set',
  'desktop_clipboard_clear',
  'desktop_wait',
  'desktop_status',
  'desktop_permissions',
  'desktop_version',
  'desktop_batch',
  'desktop_skills_list',
  'desktop_skills_get',
  'desktop_skills_path',
  'desktop_session_start',
  'desktop_session_end',
  'desktop_session_list',
  'desktop_session_gc',
  'desktop_cursor_overlay_enable',
  'desktop_cursor_overlay_disable',
  'desktop_trace_show',
  'desktop_trace_export',
];

const CALL_LOG = process.env.STUB_CALL_LOG;
const FAIL_TOOL = process.env.STUB_FAIL_TOOL;
const DELIVERY = process.env.STUB_DELIVERY || 'delivery_uncertain';
const RETRY = process.env.STUB_RETRY ?? 'safe';
const FAIL_TIMES = process.env.STUB_FAIL_TIMES ? Number(process.env.STUB_FAIL_TIMES) : Infinity;
const REJECT_TOOL = process.env.STUB_REJECT_TOOL;
const HANG_TOOL = process.env.STUB_HANG_TOOL;
const SUCCESS_DELIVERY = process.env.STUB_SUCCESS_DELIVERY;
const SUCCESS_RETRY = process.env.STUB_SUCCESS_RETRY;

let failCount = 0;

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  write({ jsonrpc: '2.0', id, result });
}

function logCall(entry) {
  if (!CALL_LOG) return;
  try {
    appendFileSync(CALL_LOG, `${JSON.stringify(entry)}\n`);
  } catch {
    // Log é best-effort.
  }
}

function toolDefinitions() {
  return TOOL_NAMES.map((name) => ({
    name,
    description: `agent-desktop ${name.replace('desktop_', '')}: stub tool`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: true },
  }));
}

/**
 * Resposta de tool MCP, no formato do upstream real: o mesmo envelope em
 * `content[].text` e em `structuredContent`.
 */
function toolResult(envelope) {
  return {
    _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'agent-desktop', version: '1.2.0' } },
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
    isError: false,
    resultType: 'complete',
    structuredContent: envelope,
  };
}

/** Recusa antes da execução: texto simples, sem envelope JSON. */
function rejectedResult(message) {
  return {
    content: [{ type: 'text', text: message }],
    isError: false,
    resultType: 'complete',
  };
}

function handleToolCall(message) {
  const name = message.params?.name;
  const args = message.params?.arguments ?? {};

  logCall({ tool: name, args, at: Date.now() });

  if (HANG_TOOL && name === HANG_TOOL) {
    // Nunca responde — o cliente deve aplicar timeout.
    return;
  }

  if (REJECT_TOOL && name === REJECT_TOOL) {
    respond(message.id, rejectedResult(`call rejected before execution: ${name}`));
    return;
  }

  if (FAIL_TOOL && name === FAIL_TOOL && failCount < FAIL_TIMES) {
    failCount += 1;
    respond(
      message.id,
      toolResult({
        version: '2.6',
        command: name.replace('desktop_', ''),
        ok: false,
        error: {
          code: 'STUB_FAILURE',
          message: `stub failure for ${name}`,
          disposition: { delivery: DELIVERY, retry: RETRY },
          recovery: 'observe the current state and retry',
          details: { failCount },
        },
      })
    );
    return;
  }

  const data = {
    tool: name,
    args,
    echo: 'stub-data',
  };

  if (SUCCESS_DELIVERY) {
    data.disposition = { delivery: SUCCESS_DELIVERY, retry: SUCCESS_RETRY ?? 'safe' };
  }

  respond(
    message.id,
    toolResult({
      version: '2.6',
      command: name.replace('desktop_', ''),
      ok: true,
      data,
    })
  );
}

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }

  if (!message || typeof message.method !== 'string') return; // resposta do cliente

  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        protocolVersion: message.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'agent-desktop', version: '1.2.0' },
      });
      break;

    case 'notifications/initialized':
      break;

    case 'tools/list':
      respond(message.id, { tools: toolDefinitions() });
      break;

    case 'tools/call':
      handleToolCall(message);
      break;

    case 'ping':
      respond(message.id, {});
      break;

    default:
      if (message.id !== undefined) {
        respond(message.id, {});
      }
      break;
  }
});

rl.on('close', () => {
  process.exit(0);
});
