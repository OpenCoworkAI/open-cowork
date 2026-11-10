/**
 * Manifesto do release oficial do `agent-desktop` — **fonte única de verdade**.
 *
 * ## Por que este módulo é separado
 *
 * Este arquivo é **puro**: não importa nada. Isso é deliberado — o script de
 * CI (`scripts/verify-agent-desktop-release.js`) precisa ler o **mesmo**
 * manifesto que o app usa em runtime, e a forma menos frágil de fazer isso
 * sem duplicar dados é transpilar este módulo com o `typescript` (dependência
 * **declarada**) e avaliar o resultado.
 *
 * Se o manifesto vivesse dentro de `agent-desktop-distribution.ts`, o script
 * teria que arrastar as dependências do módulo inteiro (crypto, fs, zlib) ou
 * duplicar o manifesto — e duplicar é exatamente como um digest fixado
 * envelhece silenciosamente.
 *
 * ## Por que o digest é fixado em código
 *
 * O asset vem do GitHub Releases do upstream (`vercel-labs/agent-desktop`),
 * mas a verificação **não** depende do `checksums.txt` baixado em runtime: o
 * SHA-256 esperado está **fixado aqui**, extraído do `checksums.txt` publicado
 * na release v1.2.0. Isso fecha o circuito:
 *
 * - o digest esperado não vem da mesma rede que o artefato (evita TOCTOU);
 * - um asset adulterado falha **antes** de ser extraído;
 * - a versão é fixada, então "instalar" é reprodutível.
 *
 * Os digests abaixo foram conferidos **byte a byte** contra os archives reais
 * baixados da release (não apenas copiados do `checksums.txt`) e revalidados
 * contra o `checksums.txt` oficial publicado.
 *
 * ## Quando este manifesto envelhece
 *
 * Quando o upstream publicar uma release nova, estes digests ficam **errados**
 * e a instalação falha **fechada** (digest mismatch) — é o comportamento
 * desejado. A atualização é feita pelo CI (matriz multi-OS) e por um commit
 * explícito, nunca por um fetch silencioso.
 */

/** Repositório upstream que publica as releases. */
export const AGENT_DESKTOP_RELEASE_REPO = 'vercel-labs/agent-desktop';

/** Versão distribuída por esta fase. Fixada — "instalar" é reprodutível. */
export const AGENT_DESKTOP_PINNED_VERSION = '1.2.0';

/** Base de download das releases. */
export const AGENT_DESKTOP_RELEASE_BASE_URL = `https://github.com/${AGENT_DESKTOP_RELEASE_REPO}/releases/download/v${AGENT_DESKTOP_PINNED_VERSION}`;

/**
 * Asset oficial por plataforma, com o SHA-256 **fixado em código**.
 *
 * Os digests vieram do `checksums.txt` publicado na release v1.2.0 do upstream
 * e foram reconferidos contra os arquivos reais. Apenas a variante **CLI** é
 * distribuída: os assets `-ffi-` (que carregam a camada nativa) ficam de fora
 * até a Fase 5.
 */
export interface AgentDesktopReleaseAsset {
  /** Target triple do Rust (usado no nome do asset). */
  target: string;
  /** Nome do arquivo do asset. */
  assetName: string;
  /** SHA-256 do asset (fixado — não vem da rede em runtime). */
  sha256: string;
}

export const PINNED_RELEASE: Readonly<Record<string, AgentDesktopReleaseAsset>> = Object.freeze({
  'win32-x64': {
    target: 'x86_64-pc-windows-msvc',
    assetName: 'agent-desktop-v1.2.0-x86_64-pc-windows-msvc.tar.gz',
    sha256: 'a4199f741a441cedd349bf56c5eba01783b1261258b498efeb7ec9945220c3e8',
  },
  'win32-arm64': {
    target: 'aarch64-pc-windows-msvc',
    assetName: 'agent-desktop-v1.2.0-aarch64-pc-windows-msvc.tar.gz',
    sha256: 'd6d8643310c2c13eace2261444d9e4c0d16ca09581f38500983104903604caa6',
  },
  'darwin-arm64': {
    target: 'aarch64-apple-darwin',
    assetName: 'agent-desktop-v1.2.0-aarch64-apple-darwin.tar.gz',
    sha256: '219813428bb1ad8decae172faed05c5964a2415170df402e2786ccfa6452ba82',
  },
  'darwin-x64': {
    target: 'x86_64-apple-darwin',
    assetName: 'agent-desktop-v1.2.0-x86_64-apple-darwin.tar.gz',
    sha256: 'd9dc50226f28d7fc86a2f5b0945f0c206dff6c31e418907749f493b6f9e773e6',
  },
  'linux-x64': {
    target: 'x86_64-unknown-linux-gnu',
    assetName: 'agent-desktop-v1.2.0-x86_64-unknown-linux-gnu.tar.gz',
    sha256: '591ae7f4a38479dc045df97e27447c0c8b530441730ab6b990e27c813162af44',
  },
  'linux-arm64': {
    target: 'aarch64-unknown-linux-gnu',
    assetName: 'agent-desktop-v1.2.0-aarch64-unknown-linux-gnu.tar.gz',
    sha256: '68e8ebbb4f80e44485d2f1cf972943a38ee43108e2e0ce56bdfa641fd1599f68',
  },
});

/**
 * Parser do `checksums.txt` do upstream.
 *
 * Tolera **quebras de linha mistas** (o arquivo publicado tem LF e CRLF na
 * mesma linha) e ignora linhas malformadas.
 */
export function parseChecksums(content: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const rawLine of content.split(/\r\n|\n|\r/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
    if (!match) continue;
    result.set(match[2].trim(), match[1].toLowerCase());
  }
  return result;
}
