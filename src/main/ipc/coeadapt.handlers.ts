import { ipcMain } from 'electron';
import { configStore } from '../config/config-store';
import { deviceTokenStore } from '../credentials/device-token-store';
import { log, logError } from '../utils/logger';
import type { HandlerDependencies } from './types';

export function registerCoeadaptHandlers(_deps: HandlerDependencies) {
  ipcMain.handle('coeadapt.getConfig', () => {
    return {
      clerkPublishableKey: configStore.get('clerkPublishableKey'),
      coeadaptApiUrl: configStore.get('coeadaptApiUrl'),
      isConnected: !!configStore.get('clerkPublishableKey'),
    };
  });

  ipcMain.handle('coeadapt.saveConfig', (_event, config: { clerkPublishableKey?: string; coeadaptApiUrl?: string }) => {
    try {
      if (config.clerkPublishableKey !== undefined) {
        configStore.set('clerkPublishableKey', config.clerkPublishableKey);
      }
      if (config.coeadaptApiUrl !== undefined) {
        configStore.set('coeadaptApiUrl', config.coeadaptApiUrl);
      }
      log('[Coeadapt] Config saved');
      return { success: true };
    } catch (error) {
      logError('[Coeadapt] Error saving config:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('coeadapt.deviceToken.get', () => {
    try {
      return {
        hasToken: deviceTokenStore.hasValidToken(),
        metadata: deviceTokenStore.getMetadata(),
      };
    } catch (error) {
      logError('[Coeadapt] Error getting device token:', error);
      return { hasToken: false, metadata: null };
    }
  });

  ipcMain.handle('coeadapt.deviceToken.generate', async (_event, clerkJwt: string) => {
    try {
      const apiUrl = configStore.get('coeadaptApiUrl') || 'https://api.coeadapt.com';
      return await deviceTokenStore.generateAndStore(clerkJwt, apiUrl);
    } catch (error) {
      logError('[Coeadapt] Error generating device token:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('coeadapt.deviceToken.verify', async () => {
    try {
      const apiUrl = configStore.get('coeadaptApiUrl') || 'https://api.coeadapt.com';
      return await deviceTokenStore.verify(apiUrl);
    } catch (error) {
      logError('[Coeadapt] Error verifying device token:', error);
      return { valid: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('coeadapt.deviceToken.clear', () => {
    deviceTokenStore.clear();
    return { success: true };
  });

  ipcMain.handle('coeadapt.deviceToken.getRaw', () => {
    return deviceTokenStore.getToken();
  });
}
