#!/usr/bin/env node
/**
 * Stub do servidor MCP do agent-desktop, para testes de contrato.
 *
 * Reproduz o **envelope** do upstream (JSON v2.6) e o catálogo de tools
 * `desktop_*`, mas sem tocar no desktop real.
 *
 * Protocolo MCP sobre stdio = JSON-RPC 2.0, uma mensagem por linha.
 *
 * Comportamento controlado por variáveis de ambiente:
 *   STUB_CALL_LOG   — arquivo onde cada `tools/call` é appendido (JSONL)
 *   STUB_FAIL_TOOL  — nome da tool que devolve envelope de erro
 *   STUB_DELIVERY   — estado de entrega do erro (default: delivery_uncertain)
 *   STUB_RETRY      — "true" para o upstream declarar retry seguro
 *   STUB_FAIL_TIMES — quantas vezes a tool falha antes de sucesso (default: ∞)
 *   STUB_HANG_TOOL  — tool que nunca responde (testa timeout)
 */

import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const TOOL_NAMES = [
  // observe
  'desktop_snapshot',
  'desktop_find',
  'desktop_screenshot',
  'desktop_get',
  'desktop_is',
  'desktop_list_surfaces',
  'desktop_skills',
  'desktop_open_system_surface',
  // act
  'desktop_click',
  'desktop_double_click',
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
  'desktop_batch',
  // wait
  'desktop_wait',
  // app
  'desktop_launch',
  'desktop_close_app',
  'desktop_list_apps',
  // window
  'desktop_list_windows',
  'desktop_focus_window',
  'desktop_resize_window',
  'desktop_move_window',
  'desktop_minimize',
  'desktop_maximize',
  'desktop_restore',
  'desktop_list_displays',
  // clipboard
  'desktop_clipboard_get',
  'desktop_clipboard_set',
  'desktop_clipboard_clear',
  // notifications
  'desktop_list_notifications',
  'desktop_dismiss_notification',
  'desktop_dismiss_all_notifications',
  'desktop_notification_action',
  // status
  'desktop_status',
  'desktop_permissions',
  'desktop_version',
  'desktop_session',
  'desktop_trace',
  'desktop_cursor_overlay',
];

const CALL_LOG = process.env.STUB_CALL_LOG;
const FAIL_TOOL = process.env.STUB_FAIL_TOOL;
const DELIVERY = process.env.STUB_DELIVERY || 'delivery_uncertain';
const RETRY = process.env.STUB_RETRY === 'true';
const FAIL_TIMES = process.env.STUB_FAIL_TIMES ? Number(process.env.STUB_FAIL_TIMES) : Infinity;
const HANG_TOOL = process.env.STUB_HANG_TOOL;

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
    description: `Stub tool ${name}`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: true },
  }));
}

function handleToolCall(message) {
  const name = message.params?.name;
  const args = message.params?.arguments ?? {};

  logCall({ tool: name, args, at: Date.now() });

  if (HANG_TOOL && name === HANG_TOOL) {
    // Nunca responde — o cliente deve aplicar timeout.
    return;
  }

  if (FAIL_TOOL && name === FAIL_TOOL && failCount < FAIL_TIMES) {
    failCount += 1;
    const envelope = {
      version: '2.6',
      ok: false,
      error: {
        code: 'STUB_FAILURE',
        message: `stub failure for ${name}`,
        disposition: { delivery: DELIVERY, retry: RETRY },
        recovery: 'observe the current state and retry',
        details: { failCount },
      },
    };
    respond(message.id, {
      content: [{ type: 'text', text: JSON.stringify(envelope) }],
      isError: false,
    });
    return;
  }

  const envelope = {
    version: '2.6',
    ok: true,
    data: {
      tool: name,
      args,
      echo: 'stub-data',
    },
  };
  respond(message.id, {
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
    isError: false,
  });
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
      // Ecoa a versão pedida — negociação sempre aceita pelo cliente.
      respond(message.id, {
        protocolVersion: message.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'agent-desktop-stub', version: '1.2.0' },
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
