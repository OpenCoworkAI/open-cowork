import { app, dialog, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(window: BrowserWindow): void {
  mainWindow = window;
}

export function initAutoUpdater(): void {
  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'A new version has been downloaded. The application will restart to apply the update.',
      buttons: ['Restart']
    }).then(() => {
      app.removeAllListeners('window-all-closed');
      
      if (mainWindow) {
        mainWindow.removeAllListeners('close');
        mainWindow.close();
      }
      
      setTimeout(() => {
        autoUpdater.quitAndInstall(false, true);
      }, 1000);
    });
  });

  autoUpdater.on('before-quit-for-update', () => {
    if (mainWindow) {
      mainWindow.removeAllListeners('close');
    }
  });
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdatesAndNotify();
}
