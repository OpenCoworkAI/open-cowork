import { ipcMain, dialog } from 'electron';
import { vmManager } from '../vm/vm-manager';
import { getVMBootstrap } from '../vm/vm-bootstrap';
import { getVMHealthMonitor } from '../vm/vm-health-monitor';
import { getVMGuestProvisioner } from '../vm/vm-guest-provisioner';
import { logError } from '../utils/logger';
import type { VMResourceConfig } from '../vm/types';
import type { HandlerDependencies } from './types';

export function registerVMHandlers(deps: HandlerDependencies) {
  ipcMain.handle('vm.checkBackend', async () => {
    try {
      return await vmManager.initialize();
    } catch (error) {
      logError('[VM] Error checking backend:', error);
      return { type: 'virtualbox', available: false, error: String(error) };
    }
  });

  ipcMain.handle('vm.listVMs', async () => {
    try {
      return await vmManager.listVMs();
    } catch (error) {
      logError('[VM] Error listing VMs:', error);
      return [];
    }
  });

  ipcMain.handle('vm.getVMStatus', async (_event, vmId: string) => {
    try {
      return await vmManager.getVMStatus(vmId);
    } catch (error) {
      logError('[VM] Error getting VM status:', error);
      return null;
    }
  });

  ipcMain.handle('vm.getVMConfig', (_event, vmId: string) => {
    try {
      return vmManager.getVMConfig(vmId);
    } catch (error) {
      logError('[VM] Error getting VM config:', error);
      return null;
    }
  });

  ipcMain.handle('vm.createVM', async (_event, params: { name: string; osImageId: string; resources: VMResourceConfig }) => {
    try {
      return await vmManager.createVM(params.name, params.osImageId, params.resources);
    } catch (error) {
      logError('[VM] Error creating VM:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.startVM', async (_event, vmId: string) => {
    try {
      return await vmManager.startVM(vmId);
    } catch (error) {
      logError('[VM] Error starting VM:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.stopVM', async (_event, vmId: string) => {
    try {
      return await vmManager.stopVM(vmId);
    } catch (error) {
      logError('[VM] Error stopping VM:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.forceStopVM', async (_event, vmId: string) => {
    try {
      return await vmManager.forceStopVM(vmId);
    } catch (error) {
      logError('[VM] Error force stopping VM:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.pauseVM', async (_event, vmId: string) => {
    try {
      return await vmManager.pauseVM(vmId);
    } catch (error) {
      logError('[VM] Error pausing VM:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.resumeVM', async (_event, vmId: string) => {
    try {
      return await vmManager.resumeVM(vmId);
    } catch (error) {
      logError('[VM] Error resuming VM:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.deleteVM', async (_event, vmId: string) => {
    try {
      return await vmManager.deleteVM(vmId);
    } catch (error) {
      logError('[VM] Error deleting VM:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.openDisplay', async (_event, vmId: string) => {
    try {
      return await vmManager.openDisplay(vmId);
    } catch (error) {
      logError('[VM] Error opening display:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.modifyVM', async (_event, vmId: string, resources: Partial<VMResourceConfig>) => {
    try {
      return await vmManager.modifyVM(vmId, resources);
    } catch (error) {
      logError('[VM] Error modifying VM:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Image management
  ipcMain.handle('vm.getAvailableImages', () => {
    try {
      return vmManager.getAvailableImages();
    } catch (error) {
      logError('[VM] Error getting available images:', error);
      return [];
    }
  });

  ipcMain.handle('vm.getDownloadedImages', () => {
    try {
      return vmManager.getDownloadedImages();
    } catch (error) {
      logError('[VM] Error getting downloaded images:', error);
      return [];
    }
  });

  ipcMain.handle('vm.downloadImage', async (_event, imageId: string) => {
    try {
      const filePath = await vmManager.downloadImage(imageId, (progress) => {
        deps.sendToRenderer({
          type: 'vm.downloadProgress' as any,
          payload: progress,
        });
      });
      return { success: true, path: filePath };
    } catch (error) {
      logError('[VM] Error downloading image:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.cancelDownload', () => {
    try {
      vmManager.cancelImageDownload();
      return { success: true };
    } catch (error) {
      logError('[VM] Error cancelling download:', error);
      return { success: false };
    }
  });

  ipcMain.handle('vm.deleteImage', (_event, imageId: string) => {
    try {
      return vmManager.deleteImage(imageId);
    } catch (error) {
      logError('[VM] Error deleting image:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.importISO', async () => {
    try {
      const mainWindow = deps.getMainWindow();
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Import ISO Image',
        filters: [
          { name: 'ISO Images', extensions: ['iso'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });
      if (result.canceled || result.filePaths.length === 0) return null;

      const filePath = result.filePaths[0];
      const fileName = filePath.split(/[\\/]/).pop() || 'Custom ISO';
      const image = vmManager.importISO(filePath, fileName);
      return image;
    } catch (error) {
      logError('[VM] Error importing ISO:', error);
      return null;
    }
  });

  // VNC + Computer Use
  ipcMain.handle('vm.startWithVNC', async (_event, vmId: string) => {
    try {
      return await vmManager.startWithVNC(vmId);
    } catch (error) {
      logError('[VM] Error starting VM with VNC:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.stopWithVNC', async (_event, vmId: string) => {
    try {
      return await vmManager.stopWithVNC(vmId);
    } catch (error) {
      logError('[VM] Error stopping VM with VNC:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.getVNCUrl', (_event, vmId: string) => {
    try {
      return vmManager.getVNCWebSocketUrl(vmId);
    } catch (error) {
      logError('[VM] Error getting VNC URL:', error);
      return null;
    }
  });

  ipcMain.handle('vm.enableComputerUse', (_event, vmId: string, enabled: boolean) => {
    try {
      vmManager.setComputerUseEnabled(vmId, enabled);
      return { success: true };
    } catch (error) {
      logError('[VM] Error toggling computer use:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.isComputerUseEnabled', (_event, vmId: string) => {
    return vmManager.isComputerUseEnabled(vmId);
  });

  ipcMain.handle('vm.executeComputerUse', async (_event, vmId: string, action: unknown) => {
    try {
      return await vmManager.executeComputerUse(vmId, action);
    } catch (error) {
      logError('[VM] Error executing computer use:', error);
      return { type: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Health Monitor + Bootstrap
  ipcMain.handle('vm.getHealthSummary', () => {
    try {
      return getVMHealthMonitor().getHealthSummary();
    } catch (error) {
      logError('[VM] Error getting health summary:', error);
      return [];
    }
  });

  ipcMain.handle('vm.setAutoRestart', (_event, vmId: string, enabled: boolean) => {
    try {
      getVMHealthMonitor().setAutoRestart(vmId, enabled);
      return { success: true };
    } catch (error) {
      logError('[VM] Error setting auto-restart:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.notifyBootstrapCreated', (_event, vmId: string) => {
    try {
      getVMBootstrap().notifyVMCreated(vmId);
      return { success: true };
    } catch (error) {
      logError('[VM] Error notifying bootstrap:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Guest Provisioning
  ipcMain.handle('vm.provisionGuest', async (_event, vmId: string) => {
    try {
      const provisioner = getVMGuestProvisioner();
      provisioner.setProgressCallback((progress) => {
        deps.sendToRenderer({
          type: 'vm.provisionProgress' as any,
          payload: progress,
        });
      });
      if (vmManager.getVBoxBackend()) {
        provisioner.setVBoxBackend(vmManager.getVBoxBackend()!);
      }
      return await vmManager.provisionGuest(vmId);
    } catch (error) {
      logError('[VM] Error provisioning guest:', error);
      return { vmId, phase: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.getProvisionStatus', (_event, vmId: string) => {
    try {
      return vmManager.getProvisionStatus(vmId);
    } catch (error) {
      logError('[VM] Error getting provision status:', error);
      return null;
    }
  });

  ipcMain.handle('vm.isProvisioned', (_event, vmId: string) => {
    return vmManager.isVMProvisioned(vmId);
  });

  ipcMain.handle('vm.connectGuestNavi', async (_event, vmId: string) => {
    try {
      const connected = await vmManager.connectGuestNavi(vmId);
      return { success: connected };
    } catch (error) {
      logError('[VM] Error connecting to guest Navi:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.notifyOSInstallComplete', (_event, vmId: string) => {
    try {
      vmManager.notifyOSInstallComplete(vmId);
      return { success: true };
    } catch (error) {
      logError('[VM] Error notifying OS install complete:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
