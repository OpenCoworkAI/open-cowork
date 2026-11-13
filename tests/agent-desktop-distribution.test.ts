import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import {
  AGENT_DESKTOP_PINNED_VERSION,
  AgentDesktopDistributionError,
  agentDesktopAssetUrl,
  agentDesktopInstallDirectory,
  extractTarGz,
  installAgentDesktopBinary,
  parseChecksums,
  readAgentDesktopInstallMetadata,
  resolveAgentDesktopReleaseAsset,
  safeArchivePath,
  sha256Hex,
  type AgentDesktopFetch,
} from '../src/main/desktop/agent-desktop-distribution';

/**
 * Constrói uma entrada tar ustar (512 bytes de header + payload com padding).
 *
 * Mantido à mão de propósito: o teste não deve depender da mesma biblioteca
 * que valida, senão um bug de layout passaria despercebido.
 */
function tarHeader(name: string, size: number, mode = 0o755, typeFlag = '0'): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write(mode.toString(8).padStart(7, '0') + ' ', 100, 8, 'utf8');
  header.write('0000000 ', 108, 8, 'utf8');
  header.write('0000000 ', 116, 8, 'utf8');
  header.write(size.toString(8).padStart(11, '0') + ' ', 124, 12, 'utf8');
  header.write('00000000000 ', 136, 12, 'utf8');
  header.write('        ', 148, 8, 'utf8'); // checksum placeholder
  header.write(typeFlag, 156, 1, 'utf8');
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');

  // Checksum: soma dos bytes do header com o campo de checksum preenchido
  // por espaços.
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');

  return header;
}

function tarEntry(name: string, content: Buffer | string, mode = 0o755): Buffer {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([tarHeader(name, data.length, mode), data, padding]);
}

function tarGz(entries: Buffer[]): Buffer {
  const tar = Buffer.concat([...entries, Buffer.alloc(1024)]); // dois blocos vazios = fim
  return zlib.gzipSync(tar);
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-desktop-dist-'));
}

describe('agent-desktop distribution', () => {
  describe('resolveAgentDesktopReleaseAsset', () => {
    it('resolve as plataformas publicadas pelo upstream', () => {
      const win = resolveAgentDesktopReleaseAsset('win32', 'x64');
      expect(win?.target).toBe('x86_64-pc-windows-msvc');
      expect(win?.assetName).toBe('agent-desktop-v1.2.0-x86_64-pc-windows-msvc.tar.gz');

      const linux = resolveAgentDesktopReleaseAsset('linux', 'x64');
      expect(linux?.target).toBe('x86_64-unknown-linux-gnu');

      const mac = resolveAgentDesktopReleaseAsset('darwin', 'arm64');
      expect(mac?.target).toBe('aarch64-apple-darwin');
    });

    it('devolve undefined para plataforma sem build oficial', () => {
      expect(resolveAgentDesktopReleaseAsset('freebsd', 'x64')).toBeUndefined();
      expect(resolveAgentDesktopReleaseAsset('win32', 'ia32')).toBeUndefined();
    });

    it('fixa a versão e o digest de cada asset', () => {
      const win = resolveAgentDesktopReleaseAsset('win32', 'x64');
      expect(AGENT_DESKTOP_PINNED_VERSION).toBe('1.2.0');
      expect(win?.sha256).toBe(
        'a4199f741a441cedd349bf56c5eba01783b1261258b498efeb7ec9945220c3e8'
      );
    });

    it('monta a URL da release oficial', () => {
      const win = resolveAgentDesktopReleaseAsset('win32', 'x64');
      expect(agentDesktopAssetUrl(win!)).toBe(
        'https://github.com/vercel-labs/agent-desktop/releases/download/v1.2.0/agent-desktop-v1.2.0-x86_64-pc-windows-msvc.tar.gz'
      );
    });
  });

  describe('sha256Hex', () => {
    it('calcula o digest conhecido de "abc"', () => {
      expect(sha256Hex(Buffer.from('abc', 'utf8'))).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
      );
    });
  });

  describe('parseChecksums', () => {
    it('tolera quebras de linha mistas (LF e CRLF no mesmo arquivo)', () => {
      const digestA = 'a'.repeat(64);
      const digestB = 'b'.repeat(64);
      const content =
        `${digestA}  agent-desktop-v1.2.0-x86_64-pc-windows-msvc.tar.gz\r\n` +
        `${digestB}  agent-desktop-v1.2.0-x86_64-unknown-linux-gnu.tar.gz\n`;

      const checksums = parseChecksums(content);
      expect(checksums.get('agent-desktop-v1.2.0-x86_64-pc-windows-msvc.tar.gz')).toBe(digestA);
      expect(checksums.get('agent-desktop-v1.2.0-x86_64-unknown-linux-gnu.tar.gz')).toBe(digestB);
    });

    it('não deixa o \\r contaminar o nome do arquivo', () => {
      const digest = 'c'.repeat(64);
      const checksums = parseChecksums(`${digest}  asset.tar.gz\r\n`);
      expect(checksums.has('asset.tar.gz')).toBe(true);
      expect(checksums.has('asset.tar.gz\r')).toBe(false);
    });

    it('ignora linhas malformadas', () => {
      const checksums = parseChecksums('not a checksum\nzz  file.tar.gz\n');
      expect(checksums.size).toBe(0);
    });
  });

  describe('safeArchivePath', () => {
    it('normaliza caminhos relativos', () => {
      expect(safeArchivePath('./agent-desktop')).toBe('agent-desktop');
      expect(safeArchivePath('dir/sub/agent-desktop')).toBe('dir/sub/agent-desktop');
    });

    it('rejeita path traversal', () => {
      expect(() => safeArchivePath('../evil')).toThrow(AgentDesktopDistributionError);
      expect(() => safeArchivePath('a/../../evil')).toThrow(/path traversal/);
    });

    it('rejeita caminhos absolutos', () => {
      expect(() => safeArchivePath('/etc/passwd')).toThrow(/absolute path/);
      expect(() => safeArchivePath('C:\\Windows\\system32')).toThrow(/absolute path/);
    });
  });

  describe('extractTarGz', () => {
    it('extrai arquivos flat preservando o bit de execução', () => {
      const dir = tempDir();
      const archive = tarGz([
        tarEntry('agent-desktop', 'BINARY'),
        tarEntry('agent-desktop-macos-helper', 'HELPER'),
      ]);

      const result = extractTarGz(archive, dir);

      expect(result.files.sort()).toEqual([
        'agent-desktop',
        'agent-desktop-macos-helper',
      ]);
      expect(fs.readFileSync(path.join(dir, 'agent-desktop'), 'utf8')).toBe('BINARY');
      expect(fs.readFileSync(path.join(dir, 'agent-desktop-macos-helper'), 'utf8')).toBe('HELPER');
      // No Windows o chmod não tem efeito — só verificamos fora dele.
      if (process.platform !== 'win32') {
        expect(fs.statSync(path.join(dir, 'agent-desktop')).mode & 0o111).toBeGreaterThan(0);
      }
    });

    it('recusa archive com path traversal antes de escrever em disco', () => {
      const dir = tempDir();
      const archive = tarGz([tarEntry('../evil', 'PWNED')]);

      expect(() => extractTarGz(archive, dir)).toThrow(/path traversal/);
      expect(fs.existsSync(path.join(path.dirname(dir), 'evil'))).toBe(false);
    });

    it('recusa archive corrompido (não-gzip)', () => {
      const dir = tempDir();
      expect(() => extractTarGz(Buffer.from('nao é gzip'), dir)).toThrow(/decompress/i);
    });
  });

  describe('installAgentDesktopBinary', () => {
    function fetchReturning(payload: Buffer): AgentDesktopFetch {
      return vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => payload.buffer.slice(
          payload.byteOffset,
          payload.byteOffset + payload.byteLength
        ) as ArrayBuffer,
      })) as unknown as AgentDesktopFetch;
    }

    it('recusa plataforma sem build oficial sem tocar a rede', async () => {
      const fetchImpl = vi.fn();
      const userDataPath = tempDir();

      await expect(
        installAgentDesktopBinary({
          platform: 'freebsd',
          arch: 'x64',
          userDataPath,
          fetchImpl: fetchImpl as unknown as AgentDesktopFetch,
        })
      ).rejects.toMatchObject({ code: 'unsupported-platform' });

      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('recusa payload cujo digest não bate com o fixado', async () => {
      const userDataPath = tempDir();
      const bogus = tarGz([tarEntry('agent-desktop.exe', 'NAO E O BINARIO')]);

      await expect(
        installAgentDesktopBinary({
          platform: 'win32',
          arch: 'x64',
          userDataPath,
          fetchImpl: fetchReturning(bogus),
        })
      ).rejects.toMatchObject({ code: 'checksum-mismatch' });

      // Nada foi instalado.
      expect(fs.existsSync(agentDesktopInstallDirectory(userDataPath, 'win32', 'x64'))).toBe(false);
    });

    it('propaga erro de HTTP como código explícito', async () => {
      const userDataPath = tempDir();
      const fetchImpl = vi.fn(async () => ({
        ok: false,
        status: 404,
        arrayBuffer: async () => new ArrayBuffer(0),
      })) as unknown as AgentDesktopFetch;

      await expect(
        installAgentDesktopBinary({
          platform: 'win32',
          arch: 'x64',
          userDataPath,
          fetchImpl: fetchImpl as unknown as AgentDesktopFetch,
        })
      ).rejects.toMatchObject({ code: 'http' });
    });

    it('instala o payload inteiro (executável + helper) e grava os metadados', async () => {
      const userDataPath = tempDir();
      const asset = resolveAgentDesktopReleaseAsset('darwin', 'arm64')!;
      const payload = tarGz([
        tarEntry('agent-desktop', 'BINARY'),
        tarEntry('agent-desktop-macos-helper', 'HELPER'),
      ]);

      const result = await installAgentDesktopBinary({
        platform: 'darwin',
        arch: 'arm64',
        userDataPath,
        // Seam de teste: o digest esperado é o do payload sintético. Em
        // produção o asset vem do manifest fixado.
        asset: { ...asset, sha256: sha256Hex(payload) },
        fetchImpl: fetchReturning(payload),
        now: () => new Date('2026-11-10T12:00:00.000Z'),
      });

      expect(result.installed).toBe(true);
      expect(result.alreadyInstalled).toBeUndefined();

      const installDir = agentDesktopInstallDirectory(userDataPath, 'darwin', 'arm64');
      // O helper precisa viajar junto do executável.
      expect(fs.existsSync(path.join(installDir, 'agent-desktop'))).toBe(true);
      expect(fs.existsSync(path.join(installDir, 'agent-desktop-macos-helper'))).toBe(true);

      const metadata = readAgentDesktopInstallMetadata(userDataPath, 'darwin', 'arm64');
      expect(metadata?.version).toBe(AGENT_DESKTOP_PINNED_VERSION);
      expect(metadata?.assetSha256).toBe(sha256Hex(payload));
      expect(metadata?.platformDir).toBe('darwin-arm64');
      expect(metadata?.installedAt).toBe('2026-11-10T12:00:00.000Z');
    });

    it('não reinstala quando a versão fixada já está presente', async () => {
      const userDataPath = tempDir();
      const asset = resolveAgentDesktopReleaseAsset('linux', 'x64')!;
      const payload = tarGz([
        tarEntry('agent-desktop', 'BINARY'),
        tarEntry('agent-desktop-linux-clipboard-owner', 'CLIP'),
      ]);

      const first = await installAgentDesktopBinary({
        platform: 'linux',
        arch: 'x64',
        userDataPath,
        asset: { ...asset, sha256: sha256Hex(payload) },
        fetchImpl: fetchReturning(payload),
      });
      expect(first.alreadyInstalled).toBeUndefined();

      const fetchImpl = vi.fn();
      const second = await installAgentDesktopBinary({
        platform: 'linux',
        arch: 'x64',
        userDataPath,
        asset: { ...asset, sha256: sha256Hex(payload) },
        fetchImpl: fetchImpl as unknown as AgentDesktopFetch,
      });

      expect(second.alreadyInstalled).toBe(true);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('substitui uma instalação anterior sem deixar binário parcial', async () => {
      const userDataPath = tempDir();
      const asset = resolveAgentDesktopReleaseAsset('win32', 'x64')!;
      const payload = tarGz([tarEntry('agent-desktop.exe', 'NOVO BINARIO')]);

      const result = await installAgentDesktopBinary({
        platform: 'win32',
        arch: 'x64',
        userDataPath,
        asset: { ...asset, sha256: sha256Hex(payload) },
        fetchImpl: fetchReturning(payload),
      });

      const installDir = agentDesktopInstallDirectory(userDataPath, 'win32', 'x64');
      expect(fs.readFileSync(path.join(installDir, 'agent-desktop.exe'), 'utf8')).toBe(
        'NOVO BINARIO'
      );
      expect(result.binaryPath).toBe(path.join(installDir, 'agent-desktop.exe'));

      // Nenhum resíduo de staging/backup na plataforma.
      const platformRoot = path.dirname(installDir);
      const leftovers = fs.readdirSync(platformRoot).filter((entry) =>
        entry.startsWith('.staging-') || entry.startsWith('.backup-')
      );
      expect(leftovers).toEqual([]);
    });
  });
});
