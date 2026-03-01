import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const settingsPanelPath = path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx');
const settingsPanelContent = readFileSync(settingsPanelPath, 'utf8');

describe('SettingsPanel skills plugin browse entry', () => {
  it('unit: renders browse plugins action', () => {
    expect(settingsPanelContent).toContain("t('skills.browsePlugins')");
  });

  it('smoke: includes plugin list modal title i18n key', () => {
    expect(settingsPanelContent).toContain("t('skills.pluginListTitle')");
  });

  it('functional: includes plugin install action i18n key', () => {
    expect(settingsPanelContent).toContain("t('skills.pluginInstall')");
  });

  it('functional: uses plugins API for catalog and management', () => {
    expect(settingsPanelContent).toContain('window.electronAPI.plugins.listCatalog');
    expect(settingsPanelContent).toContain('window.electronAPI.plugins.listInstalled');
    expect(settingsPanelContent).toContain('window.electronAPI.plugins.setComponentEnabled');
    expect(settingsPanelContent).toContain("t('skills.pluginManageUninstall')");
  });
});
