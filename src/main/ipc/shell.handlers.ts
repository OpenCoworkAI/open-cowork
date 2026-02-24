import { app, ipcMain, dialog, shell } from 'electron';
import type { HandlerDependencies } from './types';

export function registerShellHandlers(deps: HandlerDependencies) {
  ipcMain.handle('get-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('shell.openExternal', async (_event, url: string) => {
    if (!url) return false;
    return shell.openExternal(url);
  });

  ipcMain.handle('shell.showItemInFolder', async (_event, filePath: string) => {
    if (!filePath) return false;
    return shell.showItemInFolder(filePath);
  });

  ipcMain.handle('dialog.selectFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Select Files',
    });

    if (result.canceled) return [];
    return result.filePaths;
  });

  // Window control
  ipcMain.on('window.minimize', () => {
    deps.getMainWindow()?.minimize();
  });

  ipcMain.on('window.maximize', () => {
    const win = deps.getMainWindow();
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.on('window.close', () => {
    deps.getMainWindow()?.close();
  });
}
