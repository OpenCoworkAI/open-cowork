import { ipcMain } from 'electron';
import { shell } from 'electron';
import { dockerManager } from '../docker/docker-manager';
import { dockerConfigStore } from '../docker/docker-config-store';
import { log, logError } from '../utils/logger';
import type { CareerBoxConfig } from '../docker/types';
import type { HandlerDependencies } from './types';

export function registerCareerBoxHandlers(deps: HandlerDependencies) {
  ipcMain.handle('careerbox.checkDocker', async () => {
    try {
      return await dockerManager.checkDocker();
    } catch (error) {
      logError('[CareerBox] Error checking Docker:', error);
      return { available: false };
    }
  });

  ipcMain.handle('careerbox.getStatus', async () => {
    try {
      const config = dockerConfigStore.getAll();
      return await dockerManager.getContainerStatus(config.containerName);
    } catch (error) {
      logError('[CareerBox] Error getting status:', error);
      return { name: '', id: '', status: 'not_found', image: '' };
    }
  });

  ipcMain.handle('careerbox.pullImage', async () => {
    try {
      const config = dockerConfigStore.getAll();

      const exists = await dockerManager.imageExists(config.imageName);
      if (exists) {
        log('[CareerBox] Image already exists, re-pulling for updates...');
      }

      await dockerManager.pullImage(config.imageName, (progress) => {
        deps.sendToRenderer({
          type: 'careerbox.pullProgress' as any,
          payload: progress,
        });
      });

      log('[CareerBox] Image pulled successfully:', config.imageName);
    } catch (error) {
      logError('[CareerBox] Error pulling image:', error);
      throw error;
    }
  });

  ipcMain.handle('careerbox.createContainer', async () => {
    try {
      const config = dockerConfigStore.getAll();
      log('[CareerBox] Creating container:', config.containerName);
      return await dockerManager.createContainer(config);
    } catch (error) {
      logError('[CareerBox] Error creating container:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('careerbox.startContainer', async () => {
    try {
      const config = dockerConfigStore.getAll();
      log('[CareerBox] Starting container:', config.containerName);
      return await dockerManager.startContainer(config.containerName);
    } catch (error) {
      logError('[CareerBox] Error starting container:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('careerbox.stopContainer', async () => {
    try {
      const config = dockerConfigStore.getAll();
      log('[CareerBox] Stopping container:', config.containerName);
      return await dockerManager.stopContainer(config.containerName);
    } catch (error) {
      logError('[CareerBox] Error stopping container:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('careerbox.removeContainer', async () => {
    try {
      const config = dockerConfigStore.getAll();
      log('[CareerBox] Removing container:', config.containerName);
      return await dockerManager.removeContainer(config.containerName);
    } catch (error) {
      logError('[CareerBox] Error removing container:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('careerbox.openWorkspace', async () => {
    try {
      const config = dockerConfigStore.getAll();
      await shell.openExternal(`https://localhost:${config.port}`);
    } catch (error) {
      logError('[CareerBox] Error opening workspace:', error);
    }
  });

  ipcMain.handle('careerbox.checkHealth', async () => {
    try {
      const config = dockerConfigStore.getAll();
      return await dockerManager.checkHealth(config.port);
    } catch (error) {
      logError('[CareerBox] Error checking health:', error);
      return { healthy: false };
    }
  });

  ipcMain.handle('careerbox.getConfig', () => {
    try {
      return dockerConfigStore.getAll();
    } catch (error) {
      logError('[CareerBox] Error getting config:', error);
      return null;
    }
  });

  ipcMain.handle('careerbox.saveConfig', (_event, config: Partial<CareerBoxConfig>) => {
    try {
      dockerConfigStore.update(config);
      log('[CareerBox] Config saved:', config);
      return { success: true };
    } catch (error) {
      logError('[CareerBox] Error saving config:', error);
      return { success: false };
    }
  });
}
