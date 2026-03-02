import { app, ipcMain, dialog, shell } from 'electron';
import * as fs from 'fs';
import {
  log,
  logWarn,
  logError,
  getLogFilePath,
  getLogsDirectory,
  getAllLogFiles,
  closeLogFile,
  setDevLogsEnabled,
  isDevLogsEnabled,
} from '../utils/logger';
import { configStore } from '../config/config-store';
import type { HandlerDependencies } from './types';

export function registerLogsHandlers(deps: HandlerDependencies) {
  ipcMain.handle('logs.getPath', () => {
    try {
      return getLogFilePath();
    } catch (error) {
      logError('[Logs] Error getting log path:', error);
      return null;
    }
  });

  ipcMain.handle('logs.getDirectory', () => {
    try {
      return getLogsDirectory();
    } catch (error) {
      logError('[Logs] Error getting logs directory:', error);
      return null;
    }
  });

  ipcMain.handle('logs.getAll', () => {
    try {
      return getAllLogFiles();
    } catch (error) {
      logError('[Logs] Error getting all log files:', error);
      return [];
    }
  });

  ipcMain.handle('logs.export', async () => {
    try {
      const logFiles = getAllLogFiles();

      if (logFiles.length === 0) {
        return { success: false, error: 'No log files found' };
      }

      const mainWindow = deps.getMainWindow();
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export Logs',
        defaultPath: `coeadapt-logs-${new Date().toISOString().split('T')[0]}.zip`,
        filters: [
          { name: 'ZIP Archive', extensions: ['zip'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'User cancelled' };
      }

      const archiver = await import('archiver');
      const output = fs.createWriteStream(result.filePath);
      const archive = archiver.default('zip', { zlib: { level: 9 } });

      return new Promise((resolve) => {
        output.on('close', () => {
          log('[Logs] Exported logs to:', result.filePath);
          resolve({
            success: true,
            path: result.filePath,
            size: archive.pointer(),
          });
        });

        archive.on('error', (err: Error) => {
          logError('[Logs] Error creating archive:', err);
          resolve({ success: false, error: err.message });
        });

        archive.pipe(output);

        for (const logFile of logFiles) {
          archive.file(logFile.path, { name: logFile.name });
        }

        const systemInfo = {
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          electronVersion: process.versions.electron,
          appVersion: app.getVersion(),
          exportDate: new Date().toISOString(),
          logFiles: logFiles.map((f) => ({
            name: f.name,
            size: f.size,
            modified: f.mtime,
          })),
        };
        archive.append(JSON.stringify(systemInfo, null, 2), { name: 'system-info.json' });

        archive.finalize();
      });
    } catch (error) {
      logError('[Logs] Error exporting logs:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.open', async () => {
    try {
      const logsDir = getLogsDirectory();
      await shell.openPath(logsDir);
      return { success: true };
    } catch (error) {
      logError('[Logs] Error opening logs directory:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.clear', async () => {
    try {
      const logFiles = getAllLogFiles();

      closeLogFile();

      for (const logFile of logFiles) {
        try {
          fs.unlinkSync(logFile.path);
          log('[Logs] Deleted log file:', logFile.name);
        } catch (err) {
          logError('[Logs] Failed to delete log file:', logFile.name, err);
        }
      }

      log('[Logs] Log files cleared and reinitialized');

      return { success: true, deletedCount: logFiles.length };
    } catch (error) {
      logError('[Logs] Error clearing logs:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.setEnabled', async (_event, enabled: boolean) => {
    try {
      setDevLogsEnabled(enabled);
      configStore.set('enableDevLogs', enabled);
      log('[Logs] Developer logs', enabled ? 'enabled' : 'disabled');
      return { success: true, enabled };
    } catch (error) {
      logError('[Logs] Error setting dev logs enabled:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.isEnabled', () => {
    try {
      return { success: true, enabled: isDevLogsEnabled() };
    } catch (error) {
      logError('[Logs] Error getting dev logs enabled:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.write', (_event, level: 'info' | 'warn' | 'error', args: any[]) => {
    try {
      if (level === 'warn') {
        logWarn(...args);
      } else if (level === 'error') {
        logError(...args);
      } else {
        log(...args);
      }
      return { success: true };
    } catch (error) {
      console.error('[Logs] Error writing log:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
