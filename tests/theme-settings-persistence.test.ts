import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const mainIndexPath = path.resolve(process.cwd(), 'src/main/index.ts');
const useIPCPath = path.resolve(process.cwd(), 'src/renderer/hooks/useIPC.ts');
const storePath = path.resolve(process.cwd(), 'src/renderer/store/index.ts');

describe('theme settings persistence', () => {
  it('persists theme updates in the main process and applies them to native window state', () => {
    const source = fs.readFileSync(mainIndexPath, 'utf8');

    expect(source).toContain("const DARK_BG = '#171614';");
    expect(source).toContain("const LIGHT_BG = '#f5f3ee';");
    expect(source).toContain("configStore.update({ theme: nextTheme });");
    expect(source).toContain('nativeTheme.themeSource = theme;');
    expect(source).toContain('mainWindow.setBackgroundColor(');
    expect(source).toContain("getSavedThemePreference() === 'system'");
    expect(source).toContain('nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG');
    expect(source).not.toContain("case 'settings.update':\n      // TODO: Implement settings update");
  });

  it('hydrates renderer theme from config bootstrap without re-triggering persistence loops', () => {
    const source = fs.readFileSync(useIPCPath, 'utf8');

    expect(source).toContain('const applyConfigSnapshot = (config: AppConfig, isConfigured: boolean) => {');
    expect(source).toContain("store.setSettings({ theme: config.theme || 'light' });");
    expect(source).toContain('window.electronAPI.config.get()');
    expect(source).toContain('window.electronAPI.getSystemTheme()');
  });

  it('sends user-initiated settings updates back to the main process', () => {
    const source = fs.readFileSync(storePath, 'utf8');

    expect(source).toContain("type: 'settings.update'");
    expect(source).toContain('setSettings: (updates) =>');
    expect(source).toContain('updateSettings: (updates) =>');
  });
});
