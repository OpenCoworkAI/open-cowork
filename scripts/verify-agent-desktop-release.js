#!/usr/bin/env node
/**
 * Verificador de provenance do release oficial do `agent-desktop`.
 *
 * ## O que ele garante
 *
 * Para cada plataforma, **três** coisas precisam concordar:
 *
 * 1. o **digest fixado no código** (`PINNED_RELEASE`);
 * 2. o **digest publicado** pelo upstream no `checksums.txt` da release;
 * 3. o **digest do byte** do asset realmente baixado.
 *
 * Quando os três coincidem, o binário que o app instala em runtime é
 * exatamente o binário que o upstream publicou — e o digest no código não
 * envelheceu. Quando qualquer um diverge, o script **falha fechado**: é
 * sinal de release adulterada **ou** de digest desatualizado, e ambos
 * exigem atenção humana.
 *
 * ## Por que o script lê o manifesto do código
 *
 * O manifesto vive em `src/main/desktop/agent-desktop-release-manifest.ts`
 * (módulo **puro**, sem imports). O script o transpila com o `typescript`
 * — dependência **declarada** no `package.json` — e avalia o resultado.
 * Duplicar os digests aqui seria o caminho mais curto para um digest
 * envelhecer silenciosamente: duas listas, uma delas desatualizada, e
 * ninguém notando.
 *
 * ## Uso
 *
 * ```bash
 * # todas as plataformas (baixa ~6 assets)
 * node scripts/verify-agent-desktop-release.js
 *
 * # uma plataforma específica
 * node scripts/verify-agent-desktop-release.js --platform win32-x64
 *
 * # só compara o manifesto com o checksums.txt publicado (sem baixar assets)
 * node scripts/verify-agent-desktop-release.js --manifest-only
 *
 * # inclui verificação de attestation Sigstore (requer o CLI `gh`)
 * node scripts/verify-agent-desktop-release.js --platform darwin-arm64 --attest
 * ```
 *
 * ## Exit codes
 *
 * | Código | Significado |
 * |---|---|
 * | `0` | tudo verificado e coincidente |
 * | `1` | divergência encontrada (falha fechada) |
 * | `2` | erro de uso / ambiente (ex.: `gh` ausente com `--attest`) |
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const MANIFEST_SOURCE_PATH = path.join(
  REPO_ROOT,
  'src',
  'main',
  'desktop',
  'agent-desktop-release-manifest.ts'
);

/**
 * Lê o manifesto real do código-fonte.
 *
 * Transpila o módulo puro com `typescript` e avalia o CommonJS resultante.
 * Sem imports no módulo, o `require` gerado é vazio — nada além do runtime
 * do Node é necessário.
 *
 * @returns {{repo: string, version: string, baseUrl: string, pinned: Record<string, {target: string, assetName: string, sha256: string}>, parseChecksums: (content: string) => Map<string, string>}}
 */
function loadManifest() {
  let ts;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ts = require('typescript');
  } catch {
    throw new UsageError(
      'o pacote "typescript" nao esta instalado (rode `npm ci` antes). ' +
        'Ele e uma dependencia declarada e e o que permite ler o manifesto real do codigo.'
    );
  }

  if (!fs.existsSync(MANIFEST_SOURCE_PATH)) {
    throw new UsageError(`manifesto nao encontrado: ${MANIFEST_SOURCE_PATH}`);
  }

  const source = fs.readFileSync(MANIFEST_SOURCE_PATH, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: MANIFEST_SOURCE_PATH,
  });

  const moduleExports = {};
  // eslint-disable-next-line no-new-func
  const factory = new Function('exports', 'module', 'require', outputText);
  factory(moduleExports, { exports: moduleExports }, require);

  const { AGENT_DESKTOP_RELEASE_REPO, AGENT_DESKTOP_PINNED_VERSION, AGENT_DESKTOP_RELEASE_BASE_URL, PINNED_RELEASE, parseChecksums } =
    moduleExports;

  if (!PINNED_RELEASE || typeof parseChecksums !== 'function') {
    throw new UsageError('o manifesto transpilado nao exportou os campos esperados');
  }

  return {
    repo: AGENT_DESKTOP_RELEASE_REPO,
    version: AGENT_DESKTOP_PINNED_VERSION,
    baseUrl: AGENT_DESKTOP_RELEASE_BASE_URL,
    pinned: PINNED_RELEASE,
    parseChecksums,
  };
}

/** Erro de uso/ambiente — exit code 2 (não é uma divergência de provenance). */
class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Divergência de provenance — exit code 1 (falha fechada). */
class ProvenanceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProvenanceError';
  }
}

/**
 * Calcula o SHA-256 de um buffer em hexadecimal.
 *
 * @param {Buffer} data
 * @returns {string}
 */
function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Baixa uma URL e devolve o corpo como Buffer.
 *
 * Segue redirecionamentos (o GitHub Releases redireciona para o CDN) e falha
 * fechado em status != 2xx.
 *
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<Buffer>}
 */
async function download(url, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'open-cowork-agent-desktop-verifier' },
    });
    if (!response.ok) {
      throw new ProvenanceError(`download falhou (HTTP ${response.status}) para ${url}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof ProvenanceError) throw error;
    throw new ProvenanceError(`download falhou para ${url}: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verifica a assinatura Sigstore de um arquivo com o CLI `gh`.
 *
 * O `gh` fala com a API de attestations do GitHub e com o log de transparencia
 * do Rekor. Publico nao exige token.
 *
 * @param {string} filePath
 * @param {string} repo
 */
function verifyAttestation(filePath, repo) {
  try {
    execFileSync('gh', ['attestation', 'verify', filePath, '--repo', repo], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString().trim() : '';
    throw new ProvenanceError(
      `attestation Sigstore invalida para ${path.basename(filePath)}` +
        (stderr ? `: ${stderr.split('\n').slice(0, 4).join(' | ')}` : '')
    );
  }
}

/**
 * Compara o digest de um asset com o digest fixado no manifesto.
 *
 * @param {string} label
 * @param {string} actual
 * @param {string} expected
 */
function assertDigest(label, actual, expected) {
  if (actual !== expected) {
    throw new ProvenanceError(
      `digest divergente em ${label}: obtido ${actual}, esperado ${expected}. ` +
        'O asset foi adulterado OU o digest fixado no codigo envelheceu — ' +
        'atualize PINNED_RELEASE com o valor publicado na release.'
    );
  }
}

/**
 * Verifica uma plataforma inteira: baixa o asset, compara com o digest fixado
 * e com o digest publicado no `checksums.txt`.
 *
 * @param {object} options
 * @param {string} options.key
 * @param {{target: string, assetName: string, sha256: string}} options.asset
 * @param {string} options.baseUrl
 * @param {Map<string,string>} options.published
 * @param {boolean} [options.attest]
 * @param {string} [options.repo]
 * @returns {Promise<{key: string, sha256: string, bytes: number}>}
 */
async function verifyPlatform(options) {
  const { key, asset, baseUrl, published, attest, repo } = options;

  const publishedDigest = published.get(asset.assetName);
  if (!publishedDigest) {
    throw new ProvenanceError(
      `o checksums.txt publicado nao contem o asset ${asset.assetName} ` +
        `(plataforma ${key}). O upstream pode ter renomeado o asset.`
    );
  }
  assertDigest(`checksums.txt publicado (${key})`, publishedDigest, asset.sha256);

  const url = `${baseUrl}/${asset.assetName}`;
  const data = await download(url);
  const actual = sha256Hex(data);

  assertDigest(`asset baixado (${key})`, actual, asset.sha256);

  if (attest) {
    verifyAttestationFile(data, asset.assetName, repo);
  }

  return { key, sha256: actual, bytes: data.length };
}

/**
 * Verifica a assinatura de um buffer já baixado.
 *
 * `gh attestation verify` trabalha sobre um arquivo, então o buffer vai para
 * um arquivo temporário que é removido no final.
 *
 * @param {Buffer} data
 * @param {string} assetName
 * @param {string} repo
 */
function verifyAttestationFile(data, assetName, repo) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-desktop-attest-'));
  const filePath = path.join(tmpDir, assetName);
  try {
    fs.writeFileSync(filePath, data);
    verifyAttestation(filePath, repo);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Verifica **todas** as plataformas do manifesto contra o `checksums.txt`
 * publicado — sem baixar os assets.
 *
 * É o gate barato: detecta digest envelhecido em segundos.
 *
 * @param {object} manifest
 * @param {Map<string,string>} published
 * @returns {{key: string, sha256: string}[]}
 */
function verifyManifestOnly(manifest, published) {
  const results = [];
  for (const [key, asset] of Object.entries(manifest.pinned)) {
    const publishedDigest = published.get(asset.assetName);
    if (!publishedDigest) {
      throw new ProvenanceError(
        `o checksums.txt publicado nao contem o asset ${asset.assetName} (plataforma ${key})`
      );
    }
    assertDigest(`checksums.txt publicado (${key})`, publishedDigest, asset.sha256);
    results.push({ key, sha256: asset.sha256 });
  }
  return results;
}

/**
 * Parse dos argumentos de linha de comando.
 *
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const options = {
    platforms: [],
    manifestOnly: false,
    attest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--platform' || arg === '-p') {
      const value = argv[index + 1];
      if (!value) throw new UsageError('--platform exige um valor');
      options.platforms.push(value);
      index += 1;
    } else if (arg.startsWith('--platform=')) {
      options.platforms.push(arg.slice('--platform='.length));
    } else if (arg === '--manifest-only') {
      options.manifestOnly = true;
    } else if (arg === '--attest') {
      options.attest = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new UsageError(`argumento desconhecido: ${arg}`);
    }
  }

  return options;
}

const USAGE = `Verificador de provenance do release do agent-desktop.

Uso:
  node scripts/verify-agent-desktop-release.js [opcoes]

Opcoes:
  -p, --platform <chave>   Verifica so a plataforma informada (repetivel).
                           Chaves: win32-x64, win32-arm64, darwin-x64,
                                  darwin-arm64, linux-x64, linux-arm64
      --manifest-only       Compara o manifesto com o checksums.txt publicado,
                           sem baixar os assets.
      --attest              Tambem verifica a assinatura Sigstore (requer o
                           CLI gh).
  -h, --help               Mostra esta ajuda.
`;

async function main(argv) {
  const options = parseArgs(argv);

  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const manifest = loadManifest();

  const unknown = options.platforms.filter((key) => !manifest.pinned[key]);
  if (unknown.length > 0) {
    throw new UsageError(
      `plataforma(s) desconhecida(s): ${unknown.join(', ')}. ` +
        `Disponiveis: ${Object.keys(manifest.pinned).join(', ')}`
    );
  }

  if (options.attest) {
    try {
      execFileSync('gh', ['--version'], { stdio: 'ignore' });
    } catch {
      throw new UsageError('--attest exige o CLI `gh` instalado (nao encontrado no PATH)');
    }
  }

  const checksumsUrl = `${manifest.baseUrl}/checksums.txt`;
  process.stdout.write(`checksums.txt: ${checksumsUrl}\n`);
  const published = manifest.parseChecksums((await download(checksumsUrl)).toString('utf8'));
  process.stdout.write(`  ${published.size} entradas publicadas\n`);

  if (options.manifestOnly) {
    const results = verifyManifestOnly(manifest, published);
    for (const result of results) {
      process.stdout.write(`  OK  ${result.key}  ${result.sha256}\n`);
    }
    process.stdout.write(`manifesto consistente com o upstream (${results.length} plataformas)\n`);
    return 0;
  }

  const keys = options.platforms.length > 0 ? options.platforms : Object.keys(manifest.pinned);
  const failures = [];

  for (const key of keys) {
    const asset = manifest.pinned[key];
    try {
      const result = await verifyPlatform({
        key,
        asset,
        baseUrl: manifest.baseUrl,
        published,
        attest: options.attest,
        repo: manifest.repo,
      });
      process.stdout.write(
        `  OK  ${key.padEnd(14)} ${result.sha256}  ${(result.bytes / 1024 / 1024).toFixed(1)} MB` +
          (options.attest ? '  (attestation ok)' : '') +
          '\n'
      );
    } catch (error) {
      failures.push({ key, error });
      process.stderr.write(`  ERRO ${key.padEnd(14)} ${error.message}\n`);
    }
  }

  if (failures.length > 0) {
    throw new ProvenanceError(
      `${failures.length} de ${keys.length} plataforma(s) falharam: ${failures
        .map((failure) => failure.key)
        .join(', ')}`
    );
  }

  process.stdout.write(
    `provenance verificada: ${keys.length} plataforma(s) — codigo == upstream == bytes\n`
  );
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      if (error instanceof UsageError) {
        process.stderr.write(`erro de uso: ${error.message}\n\n${USAGE}`);
        process.exitCode = 2;
        return;
      }
      process.stderr.write(`falha de provenance: ${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  UsageError,
  ProvenanceError,
  loadManifest,
  parseArgs,
  sha256Hex,
  assertDigest,
  verifyManifestOnly,
  verifyPlatform,
  verifyAttestation,
  USAGE,
};
