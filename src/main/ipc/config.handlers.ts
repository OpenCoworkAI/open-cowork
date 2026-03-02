import { ipcMain } from 'electron';
import { configStore, PROVIDER_PRESETS, type AppConfig } from '../config/config-store';
import { testApiConnection } from '../config/api-tester';
import { log, logError } from '../utils/logger';
import type { ApiTestInput, ApiTestResult } from '../../renderer/types';
import type { HandlerDependencies } from './types';

export function registerConfigHandlers(deps: HandlerDependencies) {
  ipcMain.handle('config.get', () => {
    return configStore.getAll();
  });

  ipcMain.handle('config.getPresets', () => {
    return PROVIDER_PRESETS;
  });

  ipcMain.handle('config.save', (_event, newConfig: Partial<AppConfig>) => {
    log('[Config] Saving config:', { ...newConfig, apiKey: newConfig.apiKey ? '***' : '' });

    configStore.update(newConfig);

    if (newConfig.apiKey) {
      configStore.set('isConfigured', true);
    }

    configStore.applyToEnv();

    const sessionManager = deps.getSessionManager();
    if (sessionManager) {
      sessionManager.reloadConfig();
      log('[Config] Session manager config reloaded');
    }

    const isConfigured = configStore.isConfigured();
    const updatedConfig = configStore.getAll();
    deps.sendToRenderer({
      type: 'config.status',
      payload: {
        isConfigured,
        config: isConfigured ? updatedConfig : null,
      },
    });
    log('[Config] Notified renderer of config update, isConfigured:', isConfigured);

    return { success: true, config: updatedConfig };
  });

  ipcMain.handle('config.isConfigured', () => {
    return configStore.isConfigured();
  });

  ipcMain.handle('config.test', async (_event, payload: ApiTestInput): Promise<ApiTestResult> => {
    try {
      return await testApiConnection(payload);
    } catch (error) {
      logError('[Config] API test failed:', error);
      return {
        ok: false,
        errorType: 'unknown',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('onboarding.getWorkEnvironment', () => {
    return configStore.get('workEnvironment');
  });

  ipcMain.handle('onboarding.setWorkEnvironment', (_event, env: 'real-machine' | 'vm') => {
    configStore.set('workEnvironment', env);
    return { success: true };
  });
}
