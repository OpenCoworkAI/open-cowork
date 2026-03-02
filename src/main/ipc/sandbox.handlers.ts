import { ipcMain } from 'electron';
import { getSandboxAdapter } from '../sandbox/sandbox-adapter';
import { WSLBridge } from '../sandbox/wsl-bridge';
import { LimaBridge } from '../sandbox/lima-bridge';
import { getSandboxBootstrap } from '../sandbox/sandbox-bootstrap';
import { logError } from '../utils/logger';
import type { HandlerDependencies } from './types';

export function registerSandboxHandlers(deps: HandlerDependencies) {
  ipcMain.handle('sandbox.getStatus', async () => {
    try {
      const adapter = getSandboxAdapter();
      const platform = process.platform;

      if (platform === 'win32') {
        const wslStatus = await WSLBridge.checkWSLStatus();
        return {
          platform: 'win32',
          mode: adapter.initialized ? adapter.mode : 'none',
          initialized: adapter.initialized,
          wsl: wslStatus,
          lima: null,
        };
      } else if (platform === 'darwin') {
        const limaStatus = await LimaBridge.checkLimaStatus();
        return {
          platform: 'darwin',
          mode: adapter.initialized ? adapter.mode : 'native',
          initialized: adapter.initialized,
          wsl: null,
          lima: limaStatus,
        };
      } else {
        return {
          platform,
          mode: adapter.initialized ? adapter.mode : 'native',
          initialized: adapter.initialized,
          wsl: null,
          lima: null,
        };
      }
    } catch (error) {
      logError('[Sandbox] Error getting status:', error);
      return {
        platform: process.platform,
        mode: 'none',
        initialized: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // WSL IPC handlers (Windows)
  ipcMain.handle('sandbox.checkWSL', async () => {
    try {
      return await WSLBridge.checkWSLStatus();
    } catch (error) {
      logError('[Sandbox] Error checking WSL:', error);
      return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('sandbox.installNodeInWSL', async (_event, distro: string) => {
    try {
      return await WSLBridge.installNodeInWSL(distro);
    } catch (error) {
      logError('[Sandbox] Error installing Node.js:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.installPythonInWSL', async (_event, distro: string) => {
    try {
      return await WSLBridge.installPythonInWSL(distro);
    } catch (error) {
      logError('[Sandbox] Error installing Python:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.installClaudeCodeInWSL', async (_event, distro: string) => {
    try {
      return await WSLBridge.installClaudeCodeInWSL(distro);
    } catch (error) {
      logError('[Sandbox] Error installing claude-code:', error);
      return false;
    }
  });

  // Lima IPC handlers (macOS)
  ipcMain.handle('sandbox.checkLima', async () => {
    try {
      return await LimaBridge.checkLimaStatus();
    } catch (error) {
      logError('[Sandbox] Error checking Lima:', error);
      return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('sandbox.createLimaInstance', async () => {
    try {
      return await LimaBridge.createLimaInstance();
    } catch (error) {
      logError('[Sandbox] Error creating Lima instance:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.startLimaInstance', async () => {
    try {
      return await LimaBridge.startLimaInstance();
    } catch (error) {
      logError('[Sandbox] Error starting Lima instance:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.stopLimaInstance', async () => {
    try {
      return await LimaBridge.stopLimaInstance();
    } catch (error) {
      logError('[Sandbox] Error stopping Lima instance:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.installNodeInLima', async () => {
    try {
      return await LimaBridge.installNodeInLima();
    } catch (error) {
      logError('[Sandbox] Error installing Node.js in Lima:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.installPythonInLima', async () => {
    try {
      return await LimaBridge.installPythonInLima();
    } catch (error) {
      logError('[Sandbox] Error installing Python in Lima:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.installClaudeCodeInLima', async () => {
    try {
      return await LimaBridge.installClaudeCodeInLima();
    } catch (error) {
      logError('[Sandbox] Error installing claude-code in Lima:', error);
      return false;
    }
  });

  // Retry handlers
  ipcMain.handle('sandbox.retryLimaSetup', async () => {
    if (process.platform !== 'darwin') {
      return { success: false, error: 'Lima is only available on macOS' };
    }

    try {
      const bootstrap = getSandboxBootstrap();
      bootstrap.setProgressCallback((progress) => {
        deps.sendToRenderer({
          type: 'sandbox.progress',
          payload: progress,
        });
      });

      try {
        await LimaBridge.stopLimaInstance();
      } catch (error) {
        logError('[Sandbox] Error stopping Lima before retry:', error);
      }

      bootstrap.reset();
      const result = await bootstrap.bootstrap();
      const success = !result.error;
      return { success, result, error: result.error };
    } catch (error) {
      logError('[Sandbox] Error retrying Lima setup:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('sandbox.retrySetup', async () => {
    try {
      const bootstrap = getSandboxBootstrap();
      bootstrap.setProgressCallback((progress) => {
        deps.sendToRenderer({
          type: 'sandbox.progress',
          payload: progress,
        });
      });

      bootstrap.reset();
      const result = await bootstrap.bootstrap();
      const success = !result.error;
      return { success, result, error: result.error };
    } catch (error) {
      logError('[Sandbox] Error retrying setup:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
