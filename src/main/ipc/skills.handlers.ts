import { ipcMain } from 'electron';
import { logWarn, logError } from '../utils/logger';
import type { HandlerDependencies } from './types';

export function registerSkillsHandlers(deps: HandlerDependencies) {
  // Skills API handlers
  ipcMain.handle('skills.getAll', async () => {
    try {
      const skillsManager = deps.getSkillsManager();
      if (!skillsManager) {
        logError('[Skills] SkillsManager not initialized');
        return [];
      }
      return skillsManager.listSkills();
    } catch (error) {
      logError('[Skills] Error getting skills:', error);
      return [];
    }
  });

  ipcMain.handle('skills.install', async (_event, skillPath: string) => {
    try {
      const skillsManager = deps.getSkillsManager();
      if (!skillsManager) throw new Error('SkillsManager not initialized');
      const skill = await skillsManager.installSkill(skillPath);
      return { success: true, skill };
    } catch (error) {
      logError('[Skills] Error installing skill:', error);
      throw error;
    }
  });

  ipcMain.handle('skills.delete', async (_event, skillId: string) => {
    try {
      const skillsManager = deps.getSkillsManager();
      if (!skillsManager) throw new Error('SkillsManager not initialized');
      await skillsManager.uninstallSkill(skillId);
      return { success: true };
    } catch (error) {
      logError('[Skills] Error deleting skill:', error);
      throw error;
    }
  });

  ipcMain.handle('skills.setEnabled', async (_event, skillId: string, enabled: boolean) => {
    try {
      const skillsManager = deps.getSkillsManager();
      if (!skillsManager) throw new Error('SkillsManager not initialized');
      skillsManager.setSkillEnabled(skillId, enabled);
      return { success: true };
    } catch (error) {
      logError('[Skills] Error toggling skill:', error);
      throw error;
    }
  });

  ipcMain.handle('skills.validate', async (_event, skillPath: string) => {
    try {
      const skillsManager = deps.getSkillsManager();
      if (!skillsManager) return { valid: false, errors: ['SkillsManager not initialized'] };
      return await skillsManager.validateSkillFolder(skillPath);
    } catch (error) {
      logError('[Skills] Error validating skill:', error);
      return { valid: false, errors: ['Validation failed'] };
    }
  });

  // Plugin handlers
  ipcMain.handle('plugins.listCatalog', async (_event, options?: { installableOnly?: boolean }) => {
    try {
      const pluginRuntimeService = deps.getPluginRuntimeService();
      if (!pluginRuntimeService) throw new Error('PluginRuntimeService not initialized');
      return await pluginRuntimeService.listCatalog(options);
    } catch (error) {
      logError('[Plugins] Error listing catalog:', error);
      throw error;
    }
  });

  ipcMain.handle('plugins.listInstalled', async () => {
    try {
      const pluginRuntimeService = deps.getPluginRuntimeService();
      if (!pluginRuntimeService) throw new Error('PluginRuntimeService not initialized');
      return pluginRuntimeService.listInstalled();
    } catch (error) {
      logError('[Plugins] Error listing installed plugins:', error);
      throw error;
    }
  });

  ipcMain.handle('plugins.install', async (_event, pluginName: string) => {
    try {
      const pluginRuntimeService = deps.getPluginRuntimeService();
      if (!pluginRuntimeService) throw new Error('PluginRuntimeService not initialized');
      return await pluginRuntimeService.install(pluginName);
    } catch (error) {
      logError('[Plugins] Error installing plugin:', error);
      throw error;
    }
  });

  ipcMain.handle('plugins.setEnabled', async (_event, pluginId: string, enabled: boolean) => {
    try {
      const pluginRuntimeService = deps.getPluginRuntimeService();
      if (!pluginRuntimeService) throw new Error('PluginRuntimeService not initialized');
      return await pluginRuntimeService.setEnabled(pluginId, enabled);
    } catch (error) {
      logError('[Plugins] Error toggling plugin:', error);
      throw error;
    }
  });

  ipcMain.handle(
    'plugins.setComponentEnabled',
    async (_event, pluginId: string, component: 'skills' | 'commands' | 'agents' | 'hooks' | 'mcp', enabled: boolean) => {
      try {
        const pluginRuntimeService = deps.getPluginRuntimeService();
        if (!pluginRuntimeService) throw new Error('PluginRuntimeService not initialized');
        return await pluginRuntimeService.setComponentEnabled(pluginId, component, enabled);
      } catch (error) {
        logError('[Plugins] Error toggling plugin component:', error);
        throw error;
      }
    }
  );

  ipcMain.handle('plugins.uninstall', async (_event, pluginId: string) => {
    try {
      const pluginRuntimeService = deps.getPluginRuntimeService();
      if (!pluginRuntimeService) throw new Error('PluginRuntimeService not initialized');
      return await pluginRuntimeService.uninstall(pluginId);
    } catch (error) {
      logError('[Plugins] Error uninstalling plugin:', error);
      throw error;
    }
  });

  // Deprecated handlers (backwards compatibility)
  ipcMain.handle('skills.listPlugins', async (_event, installableOnly?: boolean) => {
    try {
      logWarn('[Skills] skills.listPlugins is deprecated. Use plugins.listCatalog instead.');
      const pluginRuntimeService = deps.getPluginRuntimeService();
      if (!pluginRuntimeService) throw new Error('PluginRuntimeService not initialized');
      const plugins = await pluginRuntimeService.listCatalog({ installableOnly: installableOnly === true });
      return plugins.map((plugin) => ({
        ...plugin,
        skillCount: plugin.componentCounts.skills,
        hasSkills: plugin.componentCounts.skills > 0,
      }));
    } catch (error) {
      logError('[Skills] Error listing plugins:', error);
      throw error;
    }
  });

  ipcMain.handle('skills.installPlugin', async (_event, pluginName: string) => {
    try {
      logWarn('[Skills] skills.installPlugin is deprecated. Use plugins.install instead.');
      const pluginRuntimeService = deps.getPluginRuntimeService();
      if (!pluginRuntimeService) throw new Error('PluginRuntimeService not initialized');
      const result = await pluginRuntimeService.install(pluginName);
      return {
        pluginName: result.plugin.name,
        installedSkills: result.installedSkills,
        skippedSkills: [],
        errors: result.warnings,
      };
    } catch (error) {
      logError('[Skills] Error installing plugin:', error);
      throw error;
    }
  });
}
