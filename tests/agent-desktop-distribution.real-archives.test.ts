import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  extractTarGz,
  resolveAgentDesktopReleaseAsset,
  sha256Hex,
} from '../src/main/desktop/agent-desktop-distribution';

/**
 * Validação do extrator contra os archives REAIS da release v1.2.0.
 *
 * Não faz parte da suíte hermética (os arquivos vivem no disco local do
 * ambiente de análise), mas é a prova de que o parser case com o layout real
 * publicado pelo upstream — e não só com o tar sintético do teste unitário.
 */
const REAL_ARCHIVES: {
  file: string;
  platform: NodeJS.Platform;
  arch: string;
  expected: string[];
}[] = [
  {
    file: 'C:/Users/nislei/AppData/Local/Temp/agent-desktop-f4/win-x64.tar.gz',
    platform: 'win32',
    arch: 'x64',
    expected: ['agent-desktop.exe'],
  },
  {
    file: 'C:/Users/nislei/AppData/Local/Temp/open-cowork-upstream-review/mac-arm64.tar.gz',
    platform: 'darwin',
    arch: 'arm64',
    expected: ['agent-desktop', 'agent-desktop-macos-helper'],
  },
  {
    file: 'C:/Users/nislei/AppData/Local/Temp/open-cowork-agent-desktop-spike/artifacts/linux-x64.tar.gz',
    platform: 'linux',
    arch: 'x64',
    expected: ['agent-desktop', 'agent-desktop-linux-clipboard-owner'],
  },
];

describe('agent-desktop distribution — archives reais', () => {
  for (const archive of REAL_ARCHIVES) {
    const exists = fs.existsSync(archive.file);

    it.skipIf(!exists)(
      `extrai ${archive.file.split('/').pop()} com o layout esperado`,
      () => {
        const payload = fs.readFileSync(archive.file);
        const asset = resolveAgentDesktopReleaseAsset(archive.platform, archive.arch)!;

        // O digest do arquivo real bate com o manifest fixado em código?
        expect(sha256Hex(payload)).toBe(asset.sha256);

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-desktop-real-'));
        const result = extractTarGz(payload, dir);

        expect(result.files.sort()).toEqual([...archive.expected].sort());

        // Todos os arquivos extraídos existem em disco e não estão vazios.
        for (const file of result.files) {
          const extracted = path.join(dir, ...file.split('/'));
          expect(fs.existsSync(extracted)).toBe(true);
          expect(fs.statSync(extracted).size).toBeGreaterThan(0);
        }
      }
    );
  }
});
