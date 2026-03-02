import { ipcMain } from 'electron';
import { remoteManager } from '../remote/remote-manager';
import { remoteConfigStore } from '../remote/remote-config-store';
import { logError } from '../utils/logger';
import type { GatewayConfig, ChannelType } from '../remote/types';
import type { HandlerDependencies } from './types';

export function registerRemoteHandlers(_deps: HandlerDependencies) {
  ipcMain.handle('remote.getConfig', () => {
    try {
      return remoteConfigStore.getAll();
    } catch (error) {
      logError('[Remote] Error getting config:', error);
      return null;
    }
  });

  ipcMain.handle('remote.getStatus', () => {
    try {
      return remoteManager.getStatus();
    } catch (error) {
      logError('[Remote] Error getting status:', error);
      return { running: false, channels: [], activeSessions: 0, pendingPairings: 0 };
    }
  });

  ipcMain.handle('remote.setEnabled', async (_event, enabled: boolean) => {
    try {
      remoteConfigStore.setEnabled(enabled);

      if (enabled) {
        await remoteManager.start();
      } else {
        await remoteManager.stop();
      }

      return { success: true };
    } catch (error) {
      logError('[Remote] Error setting enabled:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('remote.updateGatewayConfig', async (_event, config: Partial<GatewayConfig>) => {
    try {
      await remoteManager.updateGatewayConfig(config);
      return { success: true };
    } catch (error) {
      logError('[Remote] Error updating gateway config:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('remote.getPairedUsers', () => {
    try {
      return remoteManager.getPairedUsers();
    } catch (error) {
      logError('[Remote] Error getting paired users:', error);
      return [];
    }
  });

  ipcMain.handle('remote.getPendingPairings', () => {
    try {
      return remoteManager.getPendingPairings();
    } catch (error) {
      logError('[Remote] Error getting pending pairings:', error);
      return [];
    }
  });

  ipcMain.handle('remote.approvePairing', (_event, channelType: ChannelType, userId: string) => {
    try {
      const success = remoteManager.approvePairing(channelType, userId);
      return { success };
    } catch (error) {
      logError('[Remote] Error approving pairing:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('remote.revokePairing', (_event, channelType: ChannelType, userId: string) => {
    try {
      const success = remoteManager.revokePairing(channelType, userId);
      return { success };
    } catch (error) {
      logError('[Remote] Error revoking pairing:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('remote.getRemoteSessions', () => {
    try {
      return remoteManager.getRemoteSessions();
    } catch (error) {
      logError('[Remote] Error getting remote sessions:', error);
      return [];
    }
  });

  ipcMain.handle('remote.clearRemoteSession', (_event, sessionId: string) => {
    try {
      const success = remoteManager.clearRemoteSession(sessionId);
      return { success };
    } catch (error) {
      logError('[Remote] Error clearing remote session:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('remote.getTunnelStatus', () => {
    try {
      return remoteManager.getTunnelStatus();
    } catch (error) {
      logError('[Remote] Error getting tunnel status:', error);
      return { connected: false, url: null, provider: 'none' };
    }
  });

  ipcMain.handle('remote.restart', async () => {
    try {
      await remoteManager.restart();
      return { success: true };
    } catch (error) {
      logError('[Remote] Error restarting:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
