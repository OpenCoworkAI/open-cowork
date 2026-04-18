import { ipcMain, dialog, BrowserWindow } from 'electron';

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:select-default-directory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    });
    
    if (canceled || filePaths.length === 0) {
      return null;
    }
    
    return filePaths[0];
  });
}
