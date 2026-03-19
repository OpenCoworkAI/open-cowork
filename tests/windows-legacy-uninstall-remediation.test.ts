import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('windows legacy uninstall remediation', () => {
  it('uses a custom NSIS include with actionable recovery guidance', () => {
    const builderConfig = fs.readFileSync(path.resolve(process.cwd(), 'electron-builder.yml'), 'utf8');
    const installerInclude = fs.readFileSync(path.resolve(process.cwd(), 'resources/installer.nsh'), 'utf8');

    expect(builderConfig).toContain('include: installer.nsh');
    expect(installerInclude).toContain('!macro customUnInstallCheck');
    expect(installerInclude).toContain('Open-Cowork-Legacy-Cleanup.cmd');
    expect(installerInclude).toContain('$LOCALAPPDATA\\Programs\\Open Cowork');
  });

  it('closes long-lived resources during quit cleanup', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/main/index.ts'), 'utf8');

    expect(source).toContain('closeDatabase();');
    expect(source).toContain('closeLogFile();');
    expect(source).toContain('stopNavServer();');
    expect(source).toContain("await withTimeout(remoteManager.stop(), 5000, 'Remote control shutdown');");
  });
});
