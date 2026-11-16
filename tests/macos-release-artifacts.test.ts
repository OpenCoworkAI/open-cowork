import fs from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('macOS DMG packaging', () => {
  it('creates architecture-labelled artifacts from Intel and Apple Silicon builder outputs', async () => {
    const command = vi.fn();
    const filesystem = {
      readdirSync: () => ['mac', 'mac-arm64', 'win-unpacked'],
      existsSync: (entry: string) => !entry.endsWith('Applications'),
      symlinkSync: vi.fn(),
      statSync: () => ({ size: 1024 }),
    };
    const module = { exports: {} };
    const source = fs.readFileSync(path.resolve('scripts/compress-dmg.js'), 'utf8');
    runInNewContext(source, {
      module,
      process: { platform: 'darwin', cwd: () => '/repo' },
      console: { log: vi.fn() },
      require: (name: string) => {
        if (name === 'fs') return filesystem;
        if (name === 'path') return path.posix;
        if (name === 'child_process') return { execSync: command };
        return { version: '3.3.1' };
      },
    });
    const packageDmgs = module.exports as (build: unknown) => Promise<string[]>;
    const outputs = await packageDmgs({ outDir: '/release', configuration: {} });
    expect([...outputs]).toEqual([
      '/release/Open Cowork-3.3.1-mac-x64.dmg',
      '/release/Open Cowork-3.3.1-mac-arm64.dmg',
    ]);
    expect(command).toHaveBeenCalledTimes(2);
    expect(command.mock.calls[0][0]).toContain('-srcfolder "/release/mac"');
    expect(command.mock.calls[1][0]).toContain('-srcfolder "/release/mac-arm64"');
  });
});
