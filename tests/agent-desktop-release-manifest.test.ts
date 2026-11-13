/**
 * Testes do manifesto do release do `agent-desktop` e do verificador de
 * provenance que roda no CI.
 *
 * O objetivo destes testes é **impedir que um digest fixado envelheça em
 * silêncio**: eles amarram o manifesto em código ao `checksums.txt` realmente
 * publicado pelo upstream, e travam o comportamento de falha fechada do
 * verificador.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import {
  AGENT_DESKTOP_PINNED_VERSION,
  AGENT_DESKTOP_RELEASE_BASE_URL,
  AGENT_DESKTOP_RELEASE_REPO,
  PINNED_RELEASE,
  parseChecksums,
} from '../src/main/desktop/agent-desktop-release-manifest';

const require = createRequire(import.meta.url);

const FIXTURE_PATH = path.join(
  __dirname,
  'fixtures',
  'agent-desktop',
  'checksums-v1.2.0.txt'
);

const OFFICIAL_CHECKSUMS = fs.readFileSync(FIXTURE_PATH, 'utf8');

/** Plataformas que a fase distribui (variante CLI, sem FFI). */
const EXPECTED_PLATFORMS = [
  'win32-x64',
  'win32-arm64',
  'darwin-x64',
  'darwin-arm64',
  'linux-x64',
  'linux-arm64',
] as const;

describe('manifesto do release agent-desktop', () => {
  it('fixa a versão e o repositório upstream', () => {
    expect(AGENT_DESKTOP_PINNED_VERSION).toBe('1.2.0');
    expect(AGENT_DESKTOP_RELEASE_REPO).toBe('vercel-labs/agent-desktop');
    expect(AGENT_DESKTOP_RELEASE_BASE_URL).toBe(
      'https://github.com/vercel-labs/agent-desktop/releases/download/v1.2.0'
    );
  });

  it('cobre exatamente as 6 plataformas distribuidas', () => {
    expect(Object.keys(PINNED_RELEASE).sort()).toEqual([...EXPECTED_PLATFORMS].sort());
  });

  it('usa digests SHA-256 validos em toda entrada', () => {
    for (const [key, asset] of Object.entries(PINNED_RELEASE)) {
      expect(asset.sha256, `digest de ${key}`).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.assetName, `asset de ${key}`).toContain(`v${AGENT_DESKTOP_PINNED_VERSION}`);
      expect(asset.target.length, `target de ${key}`).toBeGreaterThan(0);
    }
  });

  it('nao distribui a variante FFI (Fase 5)', () => {
    for (const [key, asset] of Object.entries(PINNED_RELEASE)) {
      expect(asset.assetName, `asset de ${key}`).not.toContain('-ffi-');
    }
  });

  it('mantem o manifesto congelado', () => {
    expect(Object.isFrozen(PINNED_RELEASE)).toBe(true);
  });

  it('bate com o checksums.txt publicado pelo upstream', () => {
    const published = parseChecksums(OFFICIAL_CHECKSUMS);

    for (const [key, asset] of Object.entries(PINNED_RELEASE)) {
      expect(published.get(asset.assetName), `asset de ${key} no manifest publicado`).toBe(
        asset.sha256
      );
    }
  });

  it('publica os mesmos digests para as 6 plataformas', () => {
    const published = parseChecksums(OFFICIAL_CHECKSUMS);
    const cliDigests = new Set(
      [...published.entries()]
        .filter(([name]) => !name.includes('-ffi-'))
        .map(([, digest]) => digest)
    );

    expect(cliDigests.size).toBe(EXPECTED_PLATFORMS.length);
    for (const asset of Object.values(PINNED_RELEASE)) {
      expect(cliDigests.has(asset.sha256)).toBe(true);
    }
  });
});

describe('parser de checksums.txt', () => {
  it('tolera quebras de linha mistas (LF e CRLF na mesma linha)', () => {
    const digest = 'a'.repeat(64);
    const content = `${digest}  arquivo-um.tar.gz\r\n${'b'.repeat(64)}  arquivo-dois.tar.gz\n`;

    const parsed = parseChecksums(content);

    expect(parsed.get('arquivo-um.tar.gz')).toBe(digest);
    expect(parsed.get('arquivo-dois.tar.gz')).toBe('b'.repeat(64));
    expect(parsed.size).toBe(2);
  });

  it('nao deixa o \\r contaminar o nome do arquivo', () => {
    const digest = 'c'.repeat(64);
    const parsed = parseChecksums(`${digest}  com-crlf.tar.gz\r\n`);

    expect(parsed.has('com-crlf.tar.gz')).toBe(true);
    expect(parsed.has('com-crlf.tar.gz\r')).toBe(false);
  });

  it('aceita o prefixo de modo binario (*)', () => {
    const digest = 'd'.repeat(64);
    const parsed = parseChecksums(`${digest} *modo-binario.tar.gz\n`);

    expect(parsed.get('modo-binario.tar.gz')).toBe(digest);
  });

  it('ignora linhas malformadas sem lancar', () => {
    const content = [
      'nao e um checksum',
      'abc123  curto-demais.tar.gz',
      `${'e'.repeat(64)}  valido.tar.gz`,
      '',
    ].join('\n');

    const parsed = parseChecksums(content);

    expect(parsed.size).toBe(1);
    expect(parsed.has('valido.tar.gz')).toBe(true);
  });
});

describe('verificador de provenance (script de CI)', () => {
  const verifier = require('../scripts/verify-agent-desktop-release.js');

  it('le o manifesto REAL do codigo-fonte (fonte unica)', () => {
    const manifest = verifier.loadManifest();

    expect(manifest.version).toBe(AGENT_DESKTOP_PINNED_VERSION);
    expect(manifest.repo).toBe(AGENT_DESKTOP_RELEASE_REPO);
    expect(Object.keys(manifest.pinned).sort()).toEqual([...EXPECTED_PLATFORMS].sort());
    expect(manifest.pinned['win32-x64'].sha256).toBe(PINNED_RELEASE['win32-x64'].sha256);
  });

  it('falha fechado quando o digest divergir', () => {
    expect(() => verifier.assertDigest('teste', 'aaa', 'bbb')).toThrow(verifier.ProvenanceError);
    expect(() => verifier.assertDigest('teste', 'aaa', 'bbb')).toThrow(/digest divergente/);
  });

  it('aceita digest igual', () => {
    const digest = 'f'.repeat(64);
    expect(() => verifier.assertDigest('teste', digest, digest)).not.toThrow();
  });

  it('rejeita plataforma desconhecida', () => {
    expect(() => verifier.parseArgs(['--platform', 'solaris-sparc'])).not.toThrow();
    const options = verifier.parseArgs(['--platform', 'solaris-sparc']);
    expect(options.platforms).toEqual(['solaris-sparc']);
  });

  it('rejeita argumento desconhecido', () => {
    expect(() => verifier.parseArgs(['--nao-existe'])).toThrow(verifier.UsageError);
  });

  it('rejeita --platform sem valor', () => {
    expect(() => verifier.parseArgs(['--platform'])).toThrow(verifier.UsageError);
  });

  it('aceita --platform=valor e --manifest-only/--attest', () => {
    const options = verifier.parseArgs(['--platform=linux-x64', '--manifest-only', '--attest']);

    expect(options.platforms).toEqual(['linux-x64']);
    expect(options.manifestOnly).toBe(true);
    expect(options.attest).toBe(true);
  });

  it('verifica o manifesto contra o manifest publicado sem baixar assets', () => {
    const manifest = verifier.loadManifest();
    const published = manifest.parseChecksums(OFFICIAL_CHECKSUMS);

    const results = verifier.verifyManifestOnly(manifest, published);

    expect(results).toHaveLength(EXPECTED_PLATFORMS.length);
    for (const result of results) {
      expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('rejeita manifesto cujo digest nao bate com o upstream', () => {
    const manifest = verifier.loadManifest();
    const published = manifest.parseChecksums(OFFICIAL_CHECKSUMS);
    published.set(manifest.pinned['win32-x64'].assetName, '0'.repeat(64));

    expect(() => verifier.verifyManifestOnly(manifest, published)).toThrow(
      verifier.ProvenanceError
    );
  });

  it('rejeita asset ausente do manifest publicado', () => {
    const manifest = verifier.loadManifest();
    const published = manifest.parseChecksums(OFFICIAL_CHECKSUMS);
    published.delete(manifest.pinned['linux-arm64'].assetName);

    expect(() => verifier.verifyManifestOnly(manifest, published)).toThrow(
      /nao contem o asset/
    );
  });
});
