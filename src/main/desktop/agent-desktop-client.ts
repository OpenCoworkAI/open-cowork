/**
 * Cliente MCP do agent-desktop — **uma instância por sessão de agente**.
 *
 * Por que não usar o `MCPManager` global?
 *  - O `MCPManager` é um singleton por processo (`session-manager.ts:130`), mas o
 *    upstream fixa os globais de identidade (`--session`, `--agent-id`) **no
 *    start do servidor** (`src/mcp/mod.rs:243-259`). Um servidor MCP global não
 *    consegue representar dois subagentes simultâneos.
 *  - O `MCPManager` também reexecuta chamadas após timeout de forma
 *    indiscriminada (`mcp-manager.ts:1619-1625`) — o achado C4. Para ações
 *    irreversíveis isso pode **duplicar** a ação.
 *
 * Aqui cada sessão tem o seu próprio processo filho, o `disposition` do upstream
 * decide o retry (só `not_delivered` é repetível) e nada é re-executado
 * automaticamente quando a entrega é incerta.
 */

import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import {
  buildOperationCatalog,
  parseDisposition,
  parseEnvelope,
  type AgentDesktopDelivery,
  type AgentDesktopOperation,
} from './agent-desktop-catalog';
import { recordMcpToolAttempt } from '../mcp/mcp-metrics';
import { log, logError, logWarn } from '../utils/logger';

export const AGENT_DESKTOP_SERVER_NAME = 'agent-desktop';

export interface AgentDesktopClientOptions {
  /** Executável do agent-desktop. */
  command: string;
  /** Argumentos adicionais (ex.: `--session`, `--agent-id` já resolvidos). */
  args?: string[];
  /** Ambiente do processo filho. */
  env?: Record<string, string>;
  /** Diretório de trabalho do processo filho. */
  cwd?: string;
  /** Timeout por chamada, em ms. */
  callTimeoutMs?: number;
  /** Timeout para o handshake de conexão, em ms. */
  connectTimeoutMs?: number;
  /** Modo headed (cursor overlay / input físico). */
  headed?: boolean;
  /** Identificador da sessão do agente (propagado ao upstream). */
  sessionId?: string;
  /** Identificador do agente (propagado ao upstream). */
  agentId?: string;
}

export interface AgentDesktopCallResult {
  /** A chamada foi aceita e o envelope indica sucesso. */
  ok: boolean;
  /** Estado de entrega conforme o upstream. */
  delivery: AgentDesktopDelivery;
  /** Código de erro do upstream (quando `ok === false`). */
  code?: string;
  /** Mensagem de erro (quando `ok === false`). */
  message?: string;
  /** Orientação de recuperação (ex.: re-snapshot). */
  recovery?: string;
  /** Payload de dados (quando `ok === true`). */
  data?: unknown;
  /** Detalhes estruturados do erro. */
  details?: unknown;
  /** Versão do envelope. */
  envelopeVersion?: string;
  /** A chamada foi repetida automaticamente? */
  retried: boolean;
}

const DEFAULT_CALL_TIMEOUT_MS = 120_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

export class AgentDesktopClient {
  private readonly options: Required<
    Pick<
      AgentDesktopClientOptions,
      'command' | 'callTimeoutMs' | 'connectTimeoutMs'
    >
  > &
    AgentDesktopClientOptions;

  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private operations: AgentDesktopOperation[] = [];
  private started = false;
  private closed = false;

  constructor(options: AgentDesktopClientOptions) {
    this.options = {
      ...options,
      callTimeoutMs: options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    };
  }

  /** Operações disponíveis (derivadas de `tools/list`). */
  getOperations(): readonly AgentDesktopOperation[] {
    return this.operations;
  }

  /** O cliente está pronto para chamadas? */
  isReady(): boolean {
    return this.started && !this.closed;
  }

  /**
   * Conecta ao servidor MCP e carrega o catálogo de operações.
   * Idempotente — chamar de novo não reconecta.
   */
  async start(): Promise<void> {
    if (this.started) return;
    if (this.closed) throw new Error('AgentDesktopClient already closed');

    const args = this.buildArgs();
    const transport = new StdioClientTransport({
      command: this.options.command,
      args,
      env: this.options.env,
      cwd: this.options.cwd,
      // 'pipe' para que o stderr do filho não contamine a UI do Electron;
      // o conteúdo é logado com truncamento.
      stderr: 'pipe',
    });

    const client = new Client(
      { name: 'open-cowork', version: '0.1.0' },
      { capabilities: {} }
    );

    try {
      await withTimeout(client.connect(transport), this.options.connectTimeoutMs, 'connect');
    } catch (error) {
      await safeClose(client);
      await safeClose(transport);
      throw error;
    }

    this.client = client;
    this.transport = transport;

    const tools = await client.listTools();
    this.operations = buildOperationCatalog((tools.tools ?? []).map((tool) => tool.name));

    this.started = true;
    log(
      `[AgentDesktopClient] Connected. session=${this.options.sessionId ?? '(none)'} ` +
        `agent=${this.options.agentId ?? '(none)'} operations=${this.operations.length}`
    );
  }

  /**
   * Executa uma operação e devolve o resultado normalizado.
   *
   * Política de retry: só repete quando o upstream declara
   * `delivery === 'not_delivered'` — único estado em que repetir não pode
   * duplicar uma ação já executada. `delivery_uncertain` NUNCA é repetido.
   */
  async call(
    operation: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<AgentDesktopCallResult> {
    const client = this.client;
    if (!client || !this.started) {
      throw new Error('AgentDesktopClient is not connected');
    }

    const upstreamTool = this.resolveUpstreamTool(operation);
    const callId = randomUUID();
    let attempt = 0;
    let retried = false;

    for (;;) {
      attempt += 1;
      const startedAt = Date.now();

      try {
        const raw = await withTimeout(
          client.callTool(
            { name: upstreamTool, arguments: args },
            { timeout: this.options.callTimeoutMs }
          ),
          this.options.callTimeoutMs + 5_000,
          `tools/call ${upstreamTool}`,
          signal
        );

        const durationMs = Date.now() - startedAt;
        const envelope = parseEnvelope(raw);
        const disposition = envelope?.error?.disposition
          ? parseDisposition(envelope.error.disposition)
          : { delivery: 'delivered_verified' as AgentDesktopDelivery, retry: false };

        recordMcpToolAttempt({
          callId,
          tool: upstreamTool,
          server: AGENT_DESKTOP_SERVER_NAME,
          attempt,
          durationMs,
          outcome: envelope && envelope.ok === false ? 'error' : 'ok',
          errorKind: envelope && envelope.ok === false ? 'structured_error' : undefined,
        });

        if (envelope && envelope.ok === false) {
          const result: AgentDesktopCallResult = {
            ok: false,
            delivery: disposition.delivery,
            code: envelope.error?.code,
            message: envelope.error?.message,
            recovery: envelope.error?.recovery,
            details: envelope.error?.details,
            envelopeVersion: envelope.version,
            retried,
          };

          // Único retry permitido: entrega comprovadamente não realizada.
          if (disposition.retry && disposition.delivery === 'not_delivered' && attempt === 1) {
            retried = true;
            logWarn(
              `[AgentDesktopClient] not_delivered on ${upstreamTool} — retrying once ` +
                `(action was provably not delivered)`
            );
            continue;
          }

          return result;
        }

        return {
          ok: true,
          delivery: disposition.delivery,
          data: envelope?.data,
          envelopeVersion: envelope?.version,
          retried,
        };
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const errorKind = classifyTransportError(error);
        recordMcpToolAttempt({
          callId,
          tool: upstreamTool,
          server: AGENT_DESKTOP_SERVER_NAME,
          attempt,
          durationMs,
          outcome: 'error',
          errorKind,
        });

        // Erro de transporte: a ação pode ou não ter sido executada.
        // Fail-safe → `delivery_uncertain`, sem retry automático.
        logError(`[AgentDesktopClient] tool call failed: ${upstreamTool}`, error);
        return {
          ok: false,
          delivery: 'delivery_uncertain',
          code: errorKind,
          message: error instanceof Error ? error.message : String(error),
          retried,
        };
      }
    }
  }

  /** Encerra o processo filho e libera os recursos. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.started = false;
    await safeClose(this.client);
    await safeClose(this.transport);
    this.client = null;
    this.transport = null;
  }

  private resolveUpstreamTool(operation: string): string {
    const known = this.operations.find((op) => op.operation === operation);
    if (known) return known.upstreamTool;

    // Operação desconhecida: aceita o nome upstream completo como fallback.
    if (operation.startsWith('desktop_')) return operation;

    throw new Error(`Unknown agent-desktop operation: ${operation}`);
  }

  private buildArgs(): string[] {
    const args = ['mcp'];

    if (this.options.sessionId) {
      args.push('--session', this.options.sessionId);
    }
    if (this.options.agentId) {
      args.push('--agent-id', this.options.agentId);
    }
    if (this.options.headed) {
      args.push('--headed');
    }

    return [...(this.options.args ?? []), ...args];
  }
}

/** Classifica erro de transporte (sem dados do usuário). */
function classifyTransportError(error: unknown): 'timeout' | 'not_connected' | 'connection_closed' | 'unknown' {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed? ?out|timeout/i.test(message)) return 'timeout';
  if (/not connected|ECONNREFUSED|ENOENT/i.test(message)) return 'not_connected';
  if (/closed|EPIPE|ECONNRESET/i.test(message)) return 'connection_closed';
  return 'unknown';
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`agent-desktop ${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
  });

  try {
    if (signal) {
      if (signal.aborted) throw new Error('agent-desktop call aborted');
      const abortPromise = new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new Error('agent-desktop call aborted')),
          { once: true }
        );
      });
      return await Promise.race([promise, timeoutPromise, abortPromise]);
    }
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function safeClose(closeable: { close?: () => Promise<void> } | null): Promise<void> {
  if (!closeable || typeof closeable.close !== 'function') return;
  try {
    await closeable.close();
  } catch {
    // Encerramento best-effort: o processo filho é órfão em caso de falha.
  }
}
