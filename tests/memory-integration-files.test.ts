import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readProjectFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('memory integration wiring', () => {
  it('registers the memory extension in the main process and exposes IPC handlers', () => {
    const mainIndex = readProjectFile('src/main/index.ts');
    expect(mainIndex).toContain('new MemoryExtension(memoryService)');
    expect(mainIndex).toContain("ipcMain.handle('memory.getOverview'");
    expect(mainIndex).toContain("'memory.search'");
    expect(mainIndex).toContain("'memory.listFiles'");
    expect(mainIndex).toContain("'memory.inspectSession'");
    expect(mainIndex).toContain("ipcMain.handle('memory.setEnabled'");
  });

  it('injects runtime plugin skill paths and extension hooks into the agent runner', () => {
    const runner = readProjectFile('src/main/claude/agent-runner.ts');
    const memoryExtension = readProjectFile('src/main/memory/memory-extension.ts');
    expect(runner).toContain('resolveSkillPaths(session.id)');
    expect(runner).toContain("path.join(plugin.runtimePath, 'skills')");
    expect(runner).toContain('this.extensionManager.beforeSessionRun');
    expect(runner).toContain('skillsSignature');
    expect(memoryExtension).not.toContain('customTools: this.memoryService.getTools()');
  });

  it('adds a dedicated Memory settings tab and preload bridge', () => {
    const settingsPanel = readProjectFile('src/renderer/components/SettingsPanel.tsx');
    const preload = readProjectFile('src/preload/index.ts');
    const memorySettings = readProjectFile('src/renderer/components/settings/SettingsMemory.tsx');

    expect(settingsPanel).toContain("id: 'memory'");
    expect(settingsPanel).toContain('<SettingsMemory />');
    expect(preload).toContain('memory: {');
    expect(preload).toContain("ipcRenderer.invoke('memory.search'");
    expect(preload).toContain("ipcRenderer.invoke('memory.listFiles')");
    expect(memorySettings).toContain("window.electronAPI.memory.search");
    expect(memorySettings).toContain("window.electronAPI.memory.readFile");
    expect(memorySettings).toContain("window.electronAPI.memory.inspectSession");
    expect(memorySettings).toContain("window.electronAPI.memory.rebuildWorkspace");
  });

  it('defaults new sessions to the global memory toggle', () => {
    const sessionManager = readProjectFile('src/main/session/session-manager.ts');
    expect(sessionManager).toContain("configStore.get('memoryEnabled') !== false");
    expect(sessionManager).toContain('memoryEnabled?: boolean');
    expect(sessionManager).toContain('afterSessionRun');
  });
});
