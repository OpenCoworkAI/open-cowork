/**
 * Gerenciador do agent-desktop no processo main.
 *
 * Mantém **um cliente MCP por sessão de agente** — o upstream fixa a identidade
 * (`--session`, `--agent-id`) no start do servidor, então duas sessões simultâneas
 * exigem dois processos filhos distintos.
 *
 * O binário roda no **host** (fora do sandbox de VM): AX/UIA/AT-SPI exigem o bus
 * de acessibilidade e o display da sessão gráfica do usuário; uma VM não enxerga
 * nem opera o desktop do host (decisão D8, ver `SPIKE-EMPACOTAMENTO-AGENT-DESKTOP.md`).
 */

import path from 'node:path';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';

import {
  AgentDesktopClient,
  type AgentDesktopClientOptions,
} from './agent-desktop-client';
import { resolveAgentDesktopBinary, type AgentDesktopPathContext } from './agent-desktop-paths';
import { buildAgentDesktopTools, type AgentDesktopToolsOptions } from './agent-desktop-tools';
import { log, logError, logWarn } from '../utils/logger';

export interface AgentDesktopManagerOptions {
  /** Contexto de resolução do binário. */
  pathContext?: AgentDesktopPathContext;
  /** Sobrescreve a criação do cliente (testes). */
  createClient?: (options: AgentDesktopClientOptions) => AgentDesktopClient;
  /** Timeout por chamada, em ms. */
  callTimeoutMs?: number;
  /** Modo headed (cursor overlay / input físico). */
  headed?: boolean;
}

export interface AgentDesktopSessionTools {
  tools: ToolDefinition[];
  client: AgentDesktopClient;
}

export class AgentDesktopManager {
  private readonly clients = new Map<string, AgentDesktopClient>();
  private readonly options: AgentDesktopManagerOptions;

  constructor(options: AgentDesktopManagerOptions = {}) {
    this.options = options;
  }

  /** Quantidade de sessões com cliente ativo. */
  get activeSessionCount(): number {
    return this.clients.size;
  }

  /**
   * Devolve (criando se necessário) o cliente da sessão.
   * O cliente é reutilizado entre turnos da mesma sessão.
   */
  async getSessionClient(sessionId: string, agentId?: string): Promise<AgentDesktopClient> {
    const existing = this.clients.get(sessionId);
    if (existing && existing.isReady()) return existing;

    const binaryPath = this.resolveBinaryPath();
    if (!binaryPath) {
      throw new Error(
        'agent-desktop binary not found. Set OPEN_COWORK_AGENT_DESKTOP_PATH or install ' +
          'the binary under resources/tools/agent-desktop/<platform>-<arch>/bin/.'
      );
    }

    const client = (this.options.createClient ?? ((options) => new AgentDesktopClient(options)))({
      command: binaryPath,
      env: this.buildChildEnv(),
      cwd: this.options.pathContext?.userDataPath,
      callTimeoutMs: this.options.callTimeoutMs,
      headed: this.options.headed,
      sessionId,
      agentId,
    });

    await client.start();
    this.clients.set(sessionId, client);
    return client;
  }

  /**
   * Constrói as tools agregadas para uma sessão.
   * Falha de conexão é **declarada** (não silenciosa): o chamador decide se
   * degrada para o GUI Operate visual.
   */
  async buildToolsForSession(
    sessionId: string,
    agentId: string | undefined,
    onBeforeExecute?: AgentDesktopToolsOptions['onBeforeExecute']
  ): Promise<AgentDesktopSessionTools> {
    const client = await this.getSessionClient(sessionId, agentId);
    const tools = buildAgentDesktopTools({ client, onBeforeExecute });
    return { tools, client };
  }

  /** Fecha o cliente da sessão. */
  async closeSession(sessionId: string): Promise<void> {
    const client = this.clients.get(sessionId);
    if (!client) return;
    this.clients.delete(sessionId);
    await client.close();
  }

  /** Fecha todos os clientes (shutdown do app). */
  async closeAll(): Promise<void> {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(
      clients.map(async (client) => {
        try {
          await client.close();
        } catch (error) {
          logError('[AgentDesktopManager] Failed to close client', error);
        }
      })
    );
  }

  private resolveBinaryPath(): string | undefined {
    const resolution = resolveAgentDesktopBinary(this.options.pathContext ?? {});
    if (resolution.binaryPath) {
      log(
        `[AgentDesktopManager] agent-desktop resolved from ${resolution.source}: ${resolution.binaryPath}`
      );
      return resolution.binaryPath;
    }

    logWarn(
      '[AgentDesktopManager] agent-desktop binary not found. Candidates tried:',
      resolution.candidates
    );
    return undefined;
  }

  /**
   * Ambiente do processo filho.
   * `AGENT_DESKTOP_HOME` fica sob `userData` para não sujar o home do usuário.
   */
  private buildChildEnv(): Record<string, string> | undefined {
    const userDataPath = this.options.pathContext?.userDataPath;
    if (!userDataPath) return undefined;

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') env[key] = value;
    }

    env.AGENT_DESKTOP_HOME = path.join(userDataPath, 'agent-desktop');
    return env;
  }
}
