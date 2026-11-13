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
import {
  materializeAgentDesktopSkills,
  readAgentDesktopVersion,
  type AgentDesktopSkillExec,
  type AgentDesktopSkillMaterialization,
} from './agent-desktop-skill';
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
  /** `execFile` injetado na materialização da skill (testes). */
  skillExec?: AgentDesktopSkillExec;
}

export interface AgentDesktopSessionTools {
  tools: ToolDefinition[];
  client: AgentDesktopClient;
}

export class AgentDesktopManager {
  private readonly clients = new Map<string, AgentDesktopClient>();
  /**
   * Clientes **em início**, por sessão.
   *
   * Sem esta guarda, duas chamadas concorrentes para a mesma sessão criavam
   * dois clientes — dois processos filhos com o **mesmo** `--session` (o
   * upstream fixa a identidade no start), disputando o estado da sessão, e o
   * primeiro ficava órfão no Map (nunca fechado por `closeSession`/`closeAll`).
   */
  private readonly starting = new Map<string, Promise<AgentDesktopClient>>();
  private readonly options: AgentDesktopManagerOptions;
  /** Materializações em andamento, por versão do binário. */
  private readonly skillMaterializations = new Map<
    string,
    Promise<AgentDesktopSkillMaterialization>
  >();
  /**
   * Versão do binário em uso.
   *
   * Cacheada porque o binário é resolvido no startup (empacotado ou baixado
   * sob demanda) e não muda durante a sessão — evita um spawn por turno.
   */
  private skillVersion?: Promise<string>;

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

    // Uma criação já em andamento para a mesma sessão é compartilhada —
    // nunca dois processos para o mesmo `--session`.
    const pending = this.starting.get(sessionId);
    if (pending) return pending;

    const creation = this.createSessionClient(sessionId, agentId).finally(() => {
      this.starting.delete(sessionId);
    });

    this.starting.set(sessionId, creation);
    return creation;
  }

  /**
   * Cria e inicia o cliente de uma sessão.
   *
   * Em falha de `start()`, o cliente é **fechado**: ele ainda não está no Map,
   * então `closeSession`/`closeAll` não o alcançariam — e o `start()` pode ter
   * deixado um processo filho vivo (ex.: o connect funcionou mas `tools/list`
   * falhou).
   */
  private async createSessionClient(
    sessionId: string,
    agentId?: string
  ): Promise<AgentDesktopClient> {
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

    try {
      await client.start();
    } catch (error) {
      try {
        await client.close();
      } catch (closeError) {
        logError(
          '[AgentDesktopManager] Failed to close client after failed start:',
          closeError
        );
      }
      throw error;
    }

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

  /**
   * Materializa a **camada de skill** do agent-desktop.
   *
   * As skills são extraídas do **binário** (não do servidor MCP): elas existem
   * mesmo se o MCP falhar e não acoplam ao ciclo de vida do cliente. O cache é
   * versionado (`<userData>/agent-desktop/skills/<versão>`), então uma
   * atualização do binário invalida o materializado automaticamente.
   *
   * Devolve `null` quando não há binário ou userData — a degradação é
   * **declarada** no log, nunca silenciosa.
   */
  async ensureSkillsMaterialized(): Promise<AgentDesktopSkillMaterialization | null> {
    const userDataPath = this.options.pathContext?.userDataPath;
    if (!userDataPath) {
      logWarn(
        '[AgentDesktopManager] userData path unavailable — skipping desktop skill materialization'
      );
      return null;
    }

    const binaryPath = this.resolveBinaryPath();
    if (!binaryPath) return null;

    const targetRoot = path.join(userDataPath, 'agent-desktop', 'skills');

    try {
      if (!this.skillVersion) {
        this.skillVersion = readAgentDesktopVersion(binaryPath, this.options.skillExec).catch(
          (error) => {
            // Não envenena o cache: uma falha transitória pode ser tentada de novo.
            this.skillVersion = undefined;
            throw error;
          }
        );
      }
      const version = await this.skillVersion;

      const existing = this.skillMaterializations.get(version);
      if (existing) return existing;

      const pending = materializeAgentDesktopSkills({
        binaryPath,
        targetRoot,
        version,
        exec: this.options.skillExec,
      }).catch((error) => {
        // Não envenena o cache: uma falha transitória pode ser tentada de novo.
        this.skillMaterializations.delete(version);
        throw error;
      });
      this.skillMaterializations.set(version, pending);

      const result = await pending;
      log(
        `[AgentDesktopManager] Desktop skill materialized at ${result.directory} ` +
          `(version ${result.version}, cached: ${result.cached}, ` +
          `skills: ${result.skills.map((skill) => skill.name).join(', ')})`
      );
      return result;
    } catch (error) {
      logError('[AgentDesktopManager] Failed to materialize desktop skill', error);
      return null;
    }
  }

  /** Fecha o cliente da sessão. */
  async closeSession(sessionId: string): Promise<void> {
    // Um cliente ainda em início precisa ser fechado assim que ficar pronto.
    const pending = this.starting.get(sessionId);
    if (pending) {
      this.starting.delete(sessionId);
      try {
        const client = await pending;
        this.clients.delete(sessionId);
        await client.close();
      } catch {
        // O start falhou — o cliente já foi fechado em `createSessionClient`.
      }
      return;
    }

    const client = this.clients.get(sessionId);
    if (!client) return;
    this.clients.delete(sessionId);
    await client.close();
  }

  /** Fecha todos os clientes (shutdown do app). */
  async closeAll(): Promise<void> {
    const pending = [...this.starting.entries()];
    this.starting.clear();

    const clients = [...this.clients.values()];
    this.clients.clear();

    await Promise.all([
      ...clients.map(async (client) => {
        try {
          await client.close();
        } catch (error) {
          logError('[AgentDesktopManager] Failed to close client', error);
        }
      }),
      // Clientes que ainda estavam starting: fecha ao ficarem prontos.
      ...pending.map(async ([sessionId, creation]) => {
        try {
          const client = await creation;
          this.clients.delete(sessionId);
          await client.close();
        } catch {
          // O start falhou — já foi fechado em `createSessionClient`.
        }
      }),
    ]);
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
