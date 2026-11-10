/**
 * Distribuição sob demanda do binário `agent-desktop`.
 *
 * ## Por que este módulo existe
 *
 * Até a Fase 2, o binário do `agent-desktop` **não chegava ao usuário**: só
 * funcionava via `OPEN_COWORK_AGENT_DESKTOP_PATH` (dev/testes) ou instalação
 * manual. Este módulo implementa a peça que falta — obter o binário
 * **oficial** de forma verificável.
 *
 * ## Modelo de confiança
 *
 * O asset vem do GitHub Releases do upstream (`vercel-labs/agent-desktop`), mas
 * a verificação **não** depende do `checksums.txt` baixado em runtime: o
 * SHA-256 esperado está **fixado em código** (`PINNED_RELEASE`), extraído do
 * `checksums.txt` publicado na release v1.2.0. Isso fecha o circuito:
 *
 * - o digest esperado não vem da mesma rede que o artefato (evita TOCTOU);
 * - um asset adulterado falha **antes** de ser extraído;
 * - a versão é fixada, então "instalar" é reprodutível.
 *
 * Os digests abaixo foram conferidos **byte a byte** contra os archives reais
 * baixados da release (não apenas copiados do `checksums.txt`).
 *
 * ## Layout do archive
 *
 * Os archives publicados pelo `cargo` são **flat** — os arquivos estão na raiz,
 * sem diretório top-level. E o payload **não** é um único arquivo:
 *
 * | Plataforma | Arquivos no archive                                     |
 * |------------|---------------------------------------------------------|
 * | Windows    | `agent-desktop.exe`                                      |
 * | macOS      | `agent-desktop` + `agent-desktop-macos-helper`           |
 * | Linux      | `agent-desktop` + `agent-desktop-linux-clipboard-owner`  |
 *
 * Os helpers são procurados pelo upstream **no mesmo diretório** do
 * executável — por isso a instalação move o *payload inteiro* (diretório do
 * executável), não só o executável.
 *
 * O `checksums.txt` do upstream tem **quebras de linha mistas** (LF e CRLF na
 * mesma linha) — um parser ingênuo casa o `\r` no nome do arquivo. O parser
 * abaixo normaliza explicitamente.
 *
 * ## Extração
 *
 * O `.tar.gz` é extraído por um leitor **mínimo de tar** em vez de
 * `tar`/`adm-zip`: o `tar` do `node_modules` é apenas uma dependência
 * transitiva (overrides), não uma dependência declarada — depender dele seria
 * uma *phantom dependency*. O leitor cobre o subconjunto ustar que o `cargo`
 * produz (regular files, diretórios, symlinks e cabeçalhos estendidos GNU/PAX),
 * e **rejeita path traversal** (`..`, caminhos absolutos) — falha fechada.
 *
 * ## Módulo puro
 *
 * Sem Electron: `fetch` é injetável e o `exec` (para ler a versão do binário
 * instalado) também. Isso permite testar o fluxo inteiro sem rede e sem
 * spawnar processos.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { agentDesktopExecutableName, agentDesktopPlatformDir } from './agent-desktop-paths';
import {
  AGENT_DESKTOP_PINNED_VERSION,
  AGENT_DESKTOP_RELEASE_BASE_URL,
  AGENT_DESKTOP_RELEASE_REPO,
  PINNED_RELEASE,
  parseChecksums,
  type AgentDesktopReleaseAsset,
} from './agent-desktop-release-manifest';

/**
 * O manifesto e o parser vivem em `agent-desktop-release-manifest.ts` (módulo
 * **puro**, sem imports) para que o CI consiga ler o **mesmo** manifesto sem
 * duplicá-lo. Reexportados aqui para preservar a superfície pública.
 */
export {
  AGENT_DESKTOP_PINNED_VERSION,
  AGENT_DESKTOP_RELEASE_BASE_URL,
  AGENT_DESKTOP_RELEASE_REPO,
  PINNED_RELEASE,
  parseChecksums,
  type AgentDesktopReleaseAsset,
};

/** Motivo pelo qual a distribuição não pôde acontecer. */
export type AgentDesktopDistributionErrorCode =
  | 'unsupported-platform'
  | 'network'
  | 'http'
  | 'checksum-mismatch'
  | 'archive-invalid'
  | 'executable-missing'
  | 'write-failed';

export class AgentDesktopDistributionError extends Error {
  readonly code: AgentDesktopDistributionErrorCode;

  constructor(code: AgentDesktopDistributionErrorCode, message: string) {
    super(message);
    this.name = 'AgentDesktopDistributionError';
    this.code = code;
  }
}

/**
 * Devolve o asset oficial para a plataforma, ou `undefined` quando o upstream
 * não publica build para ela (falha explícita, não silenciosa).
 */
export function resolveAgentDesktopReleaseAsset(
  platform: NodeJS.Platform,
  arch: string
): AgentDesktopReleaseAsset | undefined {
  const key = agentDesktopPlatformDir(platform, arch);
  const asset = PINNED_RELEASE[key];
  return asset ? { ...asset } : undefined;
}

/** URL absoluta do asset. */
export function agentDesktopAssetUrl(asset: AgentDesktopReleaseAsset): string {
  return `${AGENT_DESKTOP_RELEASE_BASE_URL}/${asset.assetName}`;
}

/**
 * Calcula o SHA-256 de um buffer.
 *
 * Usado para verificar o asset baixado contra o digest **fixado em código**.
 */
export function sha256Hex(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Resultado da extração de um `.tar.gz`.
 */
export interface AgentDesktopArchiveContents {
  /** Caminhos relativos extraídos (separados por `/`). */
  files: string[];
  /** Diretórios criados. */
  directories: string[];
}

/** Cabeçalho de uma entrada tar (ustar/GNU). */
interface TarHeader {
  name: string;
  size: number;
  typeFlag: string;
  mode: number;
}

const TAR_BLOCK_SIZE = 512;

function readTarString(block: Buffer, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.toString('utf8', 0, end === -1 ? slice.length : end);
}

function readTarOctal(block: Buffer, offset: number, length: number): number {
  const raw = readTarString(block, offset, length).trim();
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readTarHeader(block: Buffer): TarHeader {
  return {
    name: readTarString(block, 0, 100),
    mode: readTarOctal(block, 100, 8),
    size: readTarOctal(block, 124, 12),
    typeFlag: String.fromCharCode(block[156]),
  };
}

/**
 * Normaliza um caminho interno de tar e rejeita path traversal.
 *
 * Falha **fechada**: um archive com `../` ou caminho absoluto é recusado
 * inteiro, não "sanitizado" — sanitizar abriria espaço para divergência
 * entre o que foi verificado e o que foi escrito em disco.
 */
export function safeArchivePath(entryName: string): string {
  const normalized = entryName.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized) {
    throw new AgentDesktopDistributionError('archive-invalid', 'empty path in archive');
  }
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new AgentDesktopDistributionError(
      'archive-invalid',
      `absolute path in archive is not allowed: ${entryName}`
    );
  }
  const parts = normalized.split('/').filter((part) => part && part !== '.');
  if (parts.some((part) => part === '..')) {
    throw new AgentDesktopDistributionError(
      'archive-invalid',
      `path traversal in archive is not allowed: ${entryName}`
    );
  }
  if (parts.length === 0) {
    throw new AgentDesktopDistributionError(
      'archive-invalid',
      `invalid path in archive: ${entryName}`
    );
  }
  return parts.join('/');
}

/**
 * Extrai um `.tar.gz` em memória para um diretório.
 *
 * Cobre o subconjunto que o `cargo` produz: arquivos regulares, diretórios,
 * symlinks e o cabeçalho estendido GNU (`L`) / PAX (`x`) de nome longo.
 * Entradas desconhecidas (device, fifo) são ignoradas.
 */
export function extractTarGz(archive: Buffer, targetDir: string): AgentDesktopArchiveContents {
  let tar: Buffer;
  try {
    tar = zlib.gunzipSync(archive);
  } catch (error) {
    throw new AgentDesktopDistributionError(
      'archive-invalid',
      `failed to decompress archive: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const files: string[] = [];
  const directories: string[] = [];
  let offset = 0;
  let pendingLongName: string | undefined;

  while (offset + TAR_BLOCK_SIZE <= tar.length) {
    const block = tar.subarray(offset, offset + TAR_BLOCK_SIZE);
    offset += TAR_BLOCK_SIZE;

    // Bloco vazio = fim do archive.
    let empty = true;
    for (let index = 0; index < block.length; index += 1) {
      if (block[index] !== 0) {
        empty = false;
        break;
      }
    }
    if (empty) break;

    const header = readTarHeader(block);
    const dataStart = offset;
    const dataEnd = dataStart + header.size;
    const paddedEnd = dataStart + Math.ceil(header.size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    if (dataEnd > tar.length) {
      throw new AgentDesktopDistributionError('archive-invalid', 'truncated archive');
    }
    const data = tar.subarray(dataStart, dataEnd);
    offset = paddedEnd;

    // Cabeçalho estendido GNU: o nome real vem na entrada seguinte.
    if (header.typeFlag === 'L') {
      pendingLongName = data.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    // PAX extended header: contém o atributo `path=`.
    if (header.typeFlag === 'x' || header.typeFlag === 'g') {
      const text = data.toString('utf8');
      const match = /\d+\s+path=([^\n]*)\n/.exec(text);
      if (match) pendingLongName = match[1];
      continue;
    }

    const rawName = pendingLongName ?? header.name;
    pendingLongName = undefined;

    // Symlinks e entradas especiais são ignorados: o payload oficial do
    // upstream não depende de symlink, e materializar um link permitiria
    // apontar para fora do diretório de instalação.
    if (header.typeFlag !== '0' && header.typeFlag !== '\0' && header.typeFlag !== '5') {
      continue;
    }

    const relativePath = safeArchivePath(rawName);
    const destination = path.join(targetDir, ...relativePath.split('/'));

    if (header.typeFlag === '5') {
      fs.mkdirSync(destination, { recursive: true });
      directories.push(relativePath);
      continue;
    }

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, data);
    // Preserva o bit de execução quando o archive o declara.
    const executable = (header.mode & 0o111) !== 0;
    fs.chmodSync(destination, executable ? 0o755 : 0o644);
    files.push(relativePath);
  }

  return { files, directories };
}

/**
 * Metadados do binário instalado sob demanda.
 *
 * Ficam ao lado do binário (`.install.json`) para que a origem do binário
 * seja **declarada** — nunca implícita.
 */
export interface AgentDesktopInstallMetadata {
  /** Versão distribuída (ex.: `1.2.0`). */
  version: string;
  /** SHA-256 do asset baixado (igual ao digest fixado). */
  assetSha256: string;
  /** Nome do asset na release. */
  assetName: string;
  /** `platform-arch` (ex.: `win32-x64`). */
  platformDir: string;
  /** ISO timestamp da instalação. */
  installedAt: string;
}

/** Nome do arquivo de metadados dentro do diretório do binário. */
export const AGENT_DESKTOP_INSTALL_METADATA_FILE = '.install.json';

/**
 * Caminho do diretório de cache da distribuição.
 *
 * Alinhado com o candidato `user-data-cache` de `agent-desktop-paths.ts`.
 */
export function agentDesktopInstallDirectory(
  userDataPath: string,
  platform: NodeJS.Platform,
  arch: string
): string {
  const platformDir = agentDesktopPlatformDir(platform, arch);
  return path.join(userDataPath, 'tools', 'agent-desktop', platformDir, 'bin');
}

/** Lê os metadados de instalação (ausentes = instalação manual/desconhecida). */
export function readAgentDesktopInstallMetadata(
  userDataPath: string,
  platform: NodeJS.Platform,
  arch: string
): AgentDesktopInstallMetadata | undefined {
  const file = path.join(
    agentDesktopInstallDirectory(userDataPath, platform, arch),
    AGENT_DESKTOP_INSTALL_METADATA_FILE
  );
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as AgentDesktopInstallMetadata;
    if (!parsed || typeof parsed.version !== 'string') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Estado da distribuição sob demanda, para exibição na UI.
 *
 * Distingue o binário **verificável** (instalado pela app, digest conferido)
 * do binário **não verificável** (PATH do usuário, override por env ou
 * instalação manual). Sem essa distinção, o usuário não tem como saber o
 * nível de confiança do executável que tem acesso ao seu desktop.
 */
export interface AgentDesktopInstallSummary {
  /** `installed` | `manual` | `available` | `unavailable`. */
  state: 'installed' | 'manual' | 'available' | 'unavailable';
  /** Versão oficial disponível para download (quando há). */
  availableVersion?: string;
  /** Há build oficial para esta plataforma? */
  installable: boolean;
  /** SHA-256 do asset instalado (só quando a procedência é verificável). */
  assetSha256?: string;
  /** Versão efetivamente instalada (só quando a procedência é verificável). */
  installedVersion?: string;
}

/**
 * Calcula o estado da distribuição.
 *
 * `binarySource` vem da resolução de caminhos (`agent-desktop-paths.ts`):
 * `user-data-cache` significa que o binário foi instalado pela app (e então
 * tem metadados com digest); os demais significam origem não verificável.
 */
export function describeAgentDesktopInstallState(options: {
  platform: NodeJS.Platform;
  arch: string;
  userDataPath: string;
  /** Origem da resolução do binário. */
  binarySource?: 'env-override' | 'bundled' | 'user-data-cache' | 'path' | 'not-found';
}): AgentDesktopInstallSummary {
  const asset = resolveAgentDesktopReleaseAsset(options.platform, options.arch);
  const installable = Boolean(asset);

  if (options.binarySource === 'user-data-cache') {
    const metadata = readAgentDesktopInstallMetadata(
      options.userDataPath,
      options.platform,
      options.arch
    );
    if (metadata) {
      return {
        state: 'installed',
        installable,
        availableVersion: AGENT_DESKTOP_PINNED_VERSION,
        assetSha256: metadata.assetSha256,
        installedVersion: metadata.version,
      };
    }
    // Binário no cache sem metadados: origem duvidosa — trata como manual.
    return { state: 'manual', installable, availableVersion: AGENT_DESKTOP_PINNED_VERSION };
  }

  if (options.binarySource && options.binarySource !== 'not-found') {
    // Binário vindo do PATH, do env ou embutido: existe, mas a procedência
    // não foi verificada por esta app.
    return { state: 'manual', installable, availableVersion: AGENT_DESKTOP_PINNED_VERSION };
  }

  if (installable) {
    return { state: 'available', installable, availableVersion: AGENT_DESKTOP_PINNED_VERSION };
  }

  return { state: 'unavailable', installable: false };
}

/** `fetch` injetável (testes não dependem de rede). */
export type AgentDesktopFetch = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Opções da instalação sob demanda. */
export interface InstallAgentDesktopOptions {
  platform: NodeJS.Platform;
  arch: string;
  /** `app.getPath('userData')`. */
  userDataPath: string;
  /**
   * Asset a instalar.
   *
   * Quando ausente, resolve o asset **fixado** no manifest para
   * (platform, arch) — esse é o caminho de produção e a âncora de confiança.
   * Existe como *seam* de teste (para exercitar o caminho feliz com um
   * payload sintético sem baixar a release); a produção nunca o passa.
   */
  asset?: AgentDesktopReleaseAsset;
  /** `fetch` injetável (padrão: global). */
  fetchImpl?: AgentDesktopFetch;
  /** Timeout do download, em ms. */
  timeoutMs?: number;
  /** Timestamp da instalação (injetável para testes determinísticos). */
  now?: () => Date;
}

/** Resultado da instalação sob demanda. */
export interface InstallAgentDesktopResult {
  /** Instalação concluída (ou o binário já estava na versão fixada). */
  installed: boolean;
  /** Caminho absoluto do executável instalado. */
  binaryPath?: string;
  /** Metadados gravados. */
  metadata?: AgentDesktopInstallMetadata;
  /** `true` quando o binário já estava instalado na mesma versão. */
  alreadyInstalled?: boolean;
}

/**
 * Instala o binário oficial do `agent-desktop` sob demanda.
 *
 * Fluxo: download → verificação de SHA-256 (digest **fixado em código**) →
 * extração → publicação atômica no cache.
 *
 * A publicação é atômica: o payload é extraído num diretório temporário e
 * então movido para o destino final. Se a instalação anterior existia, ela é
 * renomeada para um backup e só removida **depois** que a nova entrou no
 * lugar — assim uma falha no meio **não** deixa um binário parcial (que seria
 * executado como se fosse válido) nem apaga o binário que funcionava.
 */
export async function installAgentDesktopBinary(
  options: InstallAgentDesktopOptions
): Promise<InstallAgentDesktopResult> {
  const { platform, arch, userDataPath } = options;
  const platformDir = agentDesktopPlatformDir(platform, arch);
  const asset = options.asset ?? resolveAgentDesktopReleaseAsset(platform, arch);

  if (!asset) {
    throw new AgentDesktopDistributionError(
      'unsupported-platform',
      `agent-desktop ${AGENT_DESKTOP_PINNED_VERSION} has no official build for ${platformDir}.`
    );
  }

  const installDir = agentDesktopInstallDirectory(userDataPath, platform, arch);
  const executableName = agentDesktopExecutableName(platform);
  const existingMetadata = readAgentDesktopInstallMetadata(userDataPath, platform, arch);
  const existingBinary = path.join(installDir, executableName);

  // Já instalado na versão fixada? Não rebaixa.
  if (
    existingMetadata?.version === AGENT_DESKTOP_PINNED_VERSION &&
    fs.existsSync(existingBinary)
  ) {
    return {
      installed: true,
      binaryPath: existingBinary,
      metadata: existingMetadata,
      alreadyInstalled: true,
    };
  }

  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as AgentDesktopFetch | undefined);
  if (!fetchImpl) {
    throw new AgentDesktopDistributionError(
      'network',
      'global fetch is unavailable in this runtime — cannot download agent-desktop.'
    );
  }

  const url = agentDesktopAssetUrl(asset);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let payload: Buffer;
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new AgentDesktopDistributionError(
        'http',
        `failed to download agent-desktop from ${url} (HTTP ${response.status}).`
      );
    }
    payload = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof AgentDesktopDistributionError) throw error;
    throw new AgentDesktopDistributionError(
      'network',
      `failed to download agent-desktop from ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } finally {
    clearTimeout(timer);
  }

  // Verificação contra o digest **fixado em código** — não contra o
  // `checksums.txt` baixado em runtime (evita TOCTOU).
  const actualDigest = sha256Hex(payload);
  if (actualDigest !== asset.sha256) {
    throw new AgentDesktopDistributionError(
      'checksum-mismatch',
      `checksum mismatch for ${asset.assetName}: expected ${asset.sha256}, got ${actualDigest}.`
    );
  }

  // Extração num diretório temporário **ao lado** do destino (mesmo volume →
  // `rename` é atômico).
  const platformRoot = path.dirname(installDir);
  fs.mkdirSync(platformRoot, { recursive: true });
  const stagingDir = path.join(platformRoot, `.staging-${platformDir}-${process.pid}-${Date.now()}`);
  const backupDir = path.join(platformRoot, `.backup-${platformDir}-${process.pid}-${Date.now()}`);

  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    const extracted = extractTarGz(payload, stagingDir);

    // O executável pode estar na raiz (layout flat do upstream) ou em um
    // subdiretório; em ambos os casos o que importa é o **diretório** dele,
    // porque os helpers são procurados no mesmo lugar.
    const executableRelative = extracted.files.find(
      (file) => path.posix.basename(file) === executableName
    );
    if (!executableRelative) {
      throw new AgentDesktopDistributionError(
        'executable-missing',
        `archive ${asset.assetName} does not contain ${executableName}.`
      );
    }

    const payloadDir = path.join(stagingDir, ...path.posix.dirname(executableRelative).split('/'));

    // Publicação atômica: backup do destino antigo → novo payload no lugar →
    // remoção do backup.
    const hadPrevious = fs.existsSync(installDir);
    if (hadPrevious) {
      fs.rmSync(backupDir, { recursive: true, force: true });
      fs.renameSync(installDir, backupDir);
    }

    try {
      fs.renameSync(payloadDir, installDir);
    } catch (error) {
      // Restaura a instalação anterior — o usuário nunca fica sem binário
      // por causa de uma atualização que falhou.
      if (hadPrevious && !fs.existsSync(installDir)) {
        fs.renameSync(backupDir, installDir);
      }
      throw error;
    }

    fs.rmSync(backupDir, { recursive: true, force: true });

    const finalBinary = path.join(installDir, executableName);
    fs.chmodSync(finalBinary, 0o755);

    const metadata: AgentDesktopInstallMetadata = {
      version: AGENT_DESKTOP_PINNED_VERSION,
      assetSha256: asset.sha256,
      assetName: asset.assetName,
      platformDir,
      installedAt: (options.now?.() ?? new Date()).toISOString(),
    };

    fs.writeFileSync(
      path.join(installDir, AGENT_DESKTOP_INSTALL_METADATA_FILE),
      `${JSON.stringify(metadata, null, 2)}\n`,
      'utf8'
    );

    return { installed: true, binaryPath: finalBinary, metadata };
  } catch (error) {
    if (error instanceof AgentDesktopDistributionError) throw error;
    throw new AgentDesktopDistributionError(
      'write-failed',
      `failed to install agent-desktop: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}
