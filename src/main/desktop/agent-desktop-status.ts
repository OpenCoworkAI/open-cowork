/**
 * Status do agent-desktop para a tela de Configurações.
 *
 * Não sobe servidor MCP: a checagem de permissão é feita pelo comando CLI
 * avulso `agent-desktop permissions`, que devolve o mesmo envelope v2.6 das
 * tools. Isso mantém a tela de Settings responsiva (sem processo filho MCP
 * por consulta) e sem acoplar a UI ao ciclo de vida do cliente.
 *
 * Princípio: **falha fechada e declarada**. Quando o comando falha ou o
 * envelope é malformado, o status carrega `error` e **nenhuma** permissão é
 * reportada — nunca "parecer" que a permissão está garantida.
 */

/** Estado de uma permissão do SO (acessibilidade, automação, screen recording). */
export interface AgentDesktopPermissionState {
  /** `granted` | `denied` | `not_required` | `unknown` (ou outro valor do upstream). */
  state: string;
  [key: string]: unknown;
}

/** Permissões do SO, agrupadas pelo nome que o upstream usa. */
export interface AgentDesktopPermissions {
  accessibility?: AgentDesktopPermissionState;
  automation?: AgentDesktopPermissionState;
  screen_recording?: AgentDesktopPermissionState;
  [key: string]: AgentDesktopPermissionState | undefined;
}

/** Modo de acesso ao desktop — espelha `DesktopAccessMode` do config-store. */
export type AgentDesktopAccessMode = 'off' | 'mcp' | 'mcp+skill' | 'native';

export interface AgentDesktopStatus {
  /** Modo configurado no momento da consulta. */
  mode: AgentDesktopAccessMode;
  /** `process.platform` ('win32' | 'darwin' | 'linux'). */
  platform: string;
  /** O binário do agent-desktop foi encontrado? */
  binaryFound: boolean;
  /** Caminho do binário, quando encontrado. */
  binaryPath?: string;
  /** Versão do binário, quando conhecida. */
  version?: string;
  /** Permissões do SO — ausentes quando a checagem falhou. */
  permissions?: AgentDesktopPermissions;
  /** Mensagem de erro da checagem, se houve. */
  error?: string;
}

/**
 * Executa um comando e devolve a stdout.
 * Injetável para que os testes não dependam do binário real.
 */
export type AgentDesktopStatusExec = (
  command: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string }>;

export interface ReadAgentDesktopStatusOptions {
  /** Caminho do binário — ausente quando não foi encontrado. */
  binaryPath?: string;
  /** Modo configurado. */
  mode: AgentDesktopAccessMode;
  /** Plataforma do host. */
  platform: string;
  /** Versão conhecida do binário (evita um segundo spawn). */
  version?: string;
  /** Exec injetável (testes). */
  exec?: AgentDesktopStatusExec;
  /** Timeout da checagem, em ms. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;

/** Executa o binário via `execFile` (Promises), sem shell. */
export const defaultStatusExec: AgentDesktopStatusExec = (command, args) =>
  new Promise((resolve, reject) => {
    // Import tardio para manter o módulo livre de dependências de plataforma
    // nos testes (que nunca exercitam o caminho real).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFile } = require('node:child_process') as typeof import('node:child_process');
    execFile(
      command,
      args,
      {
        timeout: DEFAULT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });

/**
 * Extrai as permissões de um envelope v2.6.
 *
 * Tolera envelope com chaves a mais/menos. Devolve `undefined` quando o
 * envelope não tem a forma esperada — quem chama decide como degradar.
 */
export function parsePermissionsEnvelope(raw: string): AgentDesktopPermissions | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== 'object') return undefined;
  const envelope = parsed as {
    ok?: unknown;
    data?: { permissions?: unknown };
    error?: { message?: unknown };
  };

  if (envelope.ok === false) {
    const message =
      typeof envelope.error?.message === 'string' ? envelope.error.message : 'unknown error';
    throw new Error(message);
  }

  const permissions = envelope.data?.permissions;
  if (!permissions || typeof permissions !== 'object') return undefined;

  const result: AgentDesktopPermissions = {};
  for (const [key, value] of Object.entries(permissions as Record<string, unknown>)) {
    if (value && typeof value === 'object') {
      const state = (value as { state?: unknown }).state;
      result[key] = {
        ...(value as Record<string, unknown>),
        state: typeof state === 'string' ? state : 'unknown',
      };
    }
  }
  return result;
}

/**
 * Lê o status do agent-desktop (binário + permissões do SO).
 *
 * Nunca lança: qualquer falha vira `error` no status devolvido.
 */
export async function readAgentDesktopStatus(
  options: ReadAgentDesktopStatusOptions
): Promise<AgentDesktopStatus> {
  const { binaryPath, mode, platform, version } = options;

  if (!binaryPath) {
    return { mode, platform, binaryFound: false };
  }

  const exec = options.exec ?? defaultStatusExec;
  const base: AgentDesktopStatus = {
    mode,
    platform,
    binaryFound: true,
    binaryPath,
    ...(version ? { version } : {}),
  };

  try {
    const { stdout } = await exec(binaryPath, ['permissions']);
    const permissions = parsePermissionsEnvelope(stdout);

    if (!permissions) {
      return {
        ...base,
        error: 'agent-desktop returned an unexpected payload for `permissions`.',
      };
    }

    return { ...base, permissions };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, error: message };
  }
}
