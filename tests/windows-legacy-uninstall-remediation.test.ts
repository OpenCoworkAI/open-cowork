import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('windows legacy uninstall remediation', () => {
  it('uses a custom NSIS include with actionable recovery guidance', () => {
    const builderConfig = fs.readFileSync(
      path.resolve(process.cwd(), 'electron-builder.yml'),
      'utf8'
    );
    const installerInclude = fs.readFileSync(
      path.resolve(process.cwd(), 'resources/installer.nsh'),
      'utf8'
    );

    expect(builderConfig).toContain('afterAllArtifactBuild: ./scripts/compress-dmg.js');
    expect(builderConfig).toContain('beforeBuild: ./scripts/stage-mcp-resources.js');
    expect(builderConfig).toContain('afterPack: ./scripts/after-pack.js');
    expect(builderConfig).toContain('include: installer.nsh');
    expect(installerInclude).toContain('!macro customUnInstallCheck');
    expect(installerInclude).toContain('Open-Cowork-Legacy-Cleanup.cmd');
    expect(installerInclude).toContain('$LOCALAPPDATA\\Programs\\Open Cowork');
  });

  it('embeds and launches the cleanup helper from the installer when uninstall recovery is needed', () => {
    const installerInclude = fs.readFileSync(
      path.resolve(process.cwd(), 'resources/installer.nsh'),
      'utf8'
    );

    expect(installerInclude).toContain('Var OpenCoworkCleanupDir');
    expect(installerInclude).toContain('$TEMP\\Open-Cowork-Legacy-Cleanup');
    expect(installerInclude).toContain(
      '${BUILD_RESOURCES_DIR}\\windows\\Open-Cowork-Legacy-Cleanup.cmd'
    );
    expect(installerInclude).toContain('ExecShell "open" "$OpenCoworkCleanupCmd"');
  });

  it('publishes legacy cleanup helpers with Windows build artifacts', () => {
    const ciWorkflow = fs.readFileSync(
      path.resolve(process.cwd(), '.github/workflows/ci.yml'),
      'utf8'
    );
    const releaseWorkflow = fs.readFileSync(
      path.resolve(process.cwd(), '.github/workflows/release.yml'),
      'utf8'
    );

    expect(ciWorkflow).toContain('release/*.exe');
    expect(ciWorkflow).toContain('release/*.cmd');
    expect(ciWorkflow).toContain('release/*.ps1');
    expect(releaseWorkflow).toContain('release/*.exe');
    expect(releaseWorkflow).toContain('release/*.cmd');
    expect(releaseWorkflow).toContain('release/*.ps1');
  });

  it('self-elevates the cleanup script when machine-wide leftovers are detected', () => {
    const cleanupScript = fs.readFileSync(
      path.resolve(process.cwd(), 'resources/windows/Open-Cowork-Legacy-Cleanup.ps1'),
      'utf8'
    );

    expect(cleanupScript).toContain('function Test-IsAdministrator');
    expect(cleanupScript).toContain('function Test-CleanupRequiresAdministrator');
    expect(cleanupScript).toContain(
      'Administrative cleanup is required for machine-wide leftovers. Requesting elevation...'
    );
    expect(cleanupScript).toContain('Start-Process -FilePath "powershell.exe"');
    expect(cleanupScript).toContain('-Verb RunAs');
  });

  it('closes long-lived resources during quit cleanup', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/main/index.ts'), 'utf8');

    expect(source).toContain('closeDatabase();');
    expect(source).toContain('closeLogFile();');
    expect(source).toContain('stopNavServer();');
    expect(source).toContain(
      "await withTimeout(remoteManager.stop(), 5000, 'Remote control shutdown');"
    );
    expect(source).toContain("await withTimeout(mcpManager.shutdown(), 5000, 'MCP shutdown');");
  });
});
