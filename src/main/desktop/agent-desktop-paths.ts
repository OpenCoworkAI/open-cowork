/**
 * Resolução do binário do agent-desktop.
 *
 * Ordem de resolução (decisão D9 — híbrida):
 *  1. **Override explícito** — env `OPEN_COWORK_AGENT_DESKTOP_PATH` (dev/testes).
 *  2. **Embutido** — `resources/tools/agent-desktop/<platform>-<arch>/bin/agent-desktop[.exe]`
 *     (mesma convenção do `agent-runner.ts:271` para as tools nativas).
 *  3. **Cache local** — `<userData>/tools/agent-desktop/<platform>-<arch>/bin/...`
 *     (destino do download sob demanda da F4).
 *  4. **PATH do usuário** — último recurso, para instalações via npm/Homebrew.
 *
 * O módulo é **puro** (sem Electron) para poder ser testado isoladamente.
 */

import path from 'node:path';
import fs from 'node:fs';

export const AGENT_DESKTOP_PATH_ENV = 'OPEN_COWORK_AGENT_DESKTOP_PATH';

export type AgentDesktopPlatform = NodeJS.Platform;
export type AgentDesktopArch = string;

export interface AgentDesktopPathContext {
  /** `process.resourcesPath` quando empacotado (undefined em dev). */
  resourcesPath?: string;
  /** `app.getPath('userData')`. */
  userDataPath?: string;
  platform?: AgentDesktopPlatform;
  arch?: AgentDesktopArch;
  /** `process.env` (ou um dublê em testes). */
  env?: NodeJS.ProcessEnv;
  /** Se o binário existe no caminho candidato (dublê em testes). */
  fileExists?: (candidate: string) => boolean;
}

export interface AgentDesktopBinaryResolution {
  /** Caminho absoluto do executável, quando resolvido. */
  binaryPath?: string;
  /** Origem da resolução. */
  source: 'env-override' | 'bundled' | 'user-data-cache' | 'path' | 'not-found';
  /** Todos os candidatos avaliados (para diagnóstico). */
  candidates: string[];
}

/** Nome do executável por plataforma. */
export function agentDesktopExecutableName(platform: AgentDesktopPlatform): string {
  return platform === 'win32' ? 'agent-desktop.exe' : 'agent-desktop';
}

/** Identificador de plataforma/arch usado no layout de recursos. */
export function agentDesktopPlatformDir(
  platform: AgentDesktopPlatform,
  arch: AgentDesktopArch
): string {
  return `${platform}-${arch}`;
}

/**
 * Monta a lista de candidatos, na ordem de prioridade.
 */
export function buildAgentDesktopCandidates(
  context: AgentDesktopPathContext
): { candidates: string[]; sources: AgentDesktopBinaryResolution['source'][] } {
  const platform = context.platform ?? process.platform;
  const arch = context.arch ?? process.arch;
  const env = context.env ?? process.env;
  const executable = agentDesktopExecutableName(platform);
  const platformDir = agentDesktopPlatformDir(platform, arch);

  const candidates: string[] = [];
  const sources: AgentDesktopBinaryResolution['source'][] = [];

  const override = env[AGENT_DESKTOP_PATH_ENV];
  if (override && override.trim()) {
    candidates.push(path.resolve(override.trim()));
    sources.push('env-override');
  }

  if (context.resourcesPath) {
    candidates.push(
      path.join(context.resourcesPath, 'tools', 'agent-desktop', platformDir, 'bin', executable)
    );
    sources.push('bundled');
  }

  if (context.userDataPath) {
    candidates.push(
      path.join(context.userDataPath, 'tools', 'agent-desktop', platformDir, 'bin', executable)
    );
    sources.push('user-data-cache');
  }

  return { candidates, sources };
}

/**
 * Resolve o binário do agent-desktop.
 *
 * `source: 'path'` é retornado quando o executável é encontrado no PATH do
 * usuário (instalação via npm/Homebrew).
 */
export function resolveAgentDesktopBinary(
  context: AgentDesktopPathContext = {}
): AgentDesktopBinaryResolution {
  const platform = context.platform ?? process.platform;
  const env = context.env ?? process.env;
  const fileExists = context.fileExists ?? defaultFileExists;

  const { candidates, sources } = buildAgentDesktopCandidates(context);

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (fileExists(candidate)) {
      return { binaryPath: candidate, source: sources[index], candidates };
    }
  }

  // PATH do usuário: varredura manual (sem `which`/`where`, que spawnariam
  // processos e não funcionam igual no Windows).
  const executable = agentDesktopExecutableName(platform);
  const pathValue = env.PATH ?? env.Path ?? '';
  const separator = platform === 'win32' ? ';' : ':';
  for (const dir of pathValue.split(separator)) {
    if (!dir.trim()) continue;
    const candidate = path.join(dir.trim(), executable);
    if (fileExists(candidate)) {
      return {
        binaryPath: candidate,
        source: 'path',
        candidates: [...candidates, candidate],
      };
    }
  }

  return { candidates, source: 'not-found' };
}

function defaultFileExists(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}
