import { ipcMain } from 'electron';
import { credentialsStore, type UserCredential } from '../credentials/credentials-store';
import { logError } from '../utils/logger';
import type { HandlerDependencies } from './types';

export function registerCredentialsHandlers(_deps: HandlerDependencies) {
  ipcMain.handle('credentials.getAll', () => {
    try {
      return credentialsStore.getAllSafe();
    } catch (error) {
      logError('[Credentials] Error getting credentials:', error);
      return [];
    }
  });

  ipcMain.handle('credentials.getById', (_event, id: string) => {
    try {
      return credentialsStore.getById(id);
    } catch (error) {
      logError('[Credentials] Error getting credential:', error);
      return undefined;
    }
  });

  ipcMain.handle('credentials.getByType', (_event, type: UserCredential['type']) => {
    try {
      return credentialsStore.getByType(type);
    } catch (error) {
      logError('[Credentials] Error getting credentials by type:', error);
      return [];
    }
  });

  ipcMain.handle('credentials.getByService', (_event, service: string) => {
    try {
      return credentialsStore.getByService(service);
    } catch (error) {
      logError('[Credentials] Error getting credentials by service:', error);
      return [];
    }
  });

  ipcMain.handle('credentials.save', (_event, credential: Omit<UserCredential, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      return credentialsStore.save(credential);
    } catch (error) {
      logError('[Credentials] Error saving credential:', error);
      throw error;
    }
  });

  ipcMain.handle('credentials.update', (_event, id: string, updates: Partial<Omit<UserCredential, 'id' | 'createdAt' | 'updatedAt'>>) => {
    try {
      return credentialsStore.update(id, updates);
    } catch (error) {
      logError('[Credentials] Error updating credential:', error);
      throw error;
    }
  });

  ipcMain.handle('credentials.delete', (_event, id: string) => {
    try {
      return credentialsStore.delete(id);
    } catch (error) {
      logError('[Credentials] Error deleting credential:', error);
      return false;
    }
  });
}
