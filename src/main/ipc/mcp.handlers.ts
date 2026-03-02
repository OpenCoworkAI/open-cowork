import { ipcMain } from 'electron';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import { log, logError } from '../utils/logger';
import type { MCPServerConfig } from '../mcp/mcp-manager';
import type { HandlerDependencies } from './types';

export function registerMCPHandlers(deps: HandlerDependencies) {
  ipcMain.handle('mcp.getServers', () => {
    try {
      return mcpConfigStore.getServers();
    } catch (error) {
      logError('[MCP] Error getting servers:', error);
      return [];
    }
  });

  ipcMain.handle('mcp.getServer', (_event, serverId: string) => {
    try {
      return mcpConfigStore.getServer(serverId);
    } catch (error) {
      logError('[MCP] Error getting server:', error);
      return null;
    }
  });

  ipcMain.handle('mcp.saveServer', async (_event, config: MCPServerConfig) => {
    mcpConfigStore.saveServer(config);
    const sessionManager = deps.getSessionManager();
    if (sessionManager) {
      const mcpManager = sessionManager.getMCPManager();
      try {
        await mcpManager.updateServer(config);
        log(`[MCP] Server ${config.name} updated successfully`);
      } catch (err) {
        logError('[MCP] Failed to update server:', err);
      }
    }
    return { success: true };
  });

  ipcMain.handle('mcp.deleteServer', async (_event, serverId: string) => {
    mcpConfigStore.deleteServer(serverId);
    const sessionManager = deps.getSessionManager();
    if (sessionManager) {
      const mcpManager = sessionManager.getMCPManager();
      try {
        await mcpManager.removeServer(serverId);
        log(`[MCP] Server ${serverId} removed successfully`);
      } catch (err) {
        logError('[MCP] Failed to remove server:', err);
      }
    }
    return { success: true };
  });

  ipcMain.handle('mcp.getTools', () => {
    try {
      const sessionManager = deps.getSessionManager();
      if (!sessionManager) return [];
      return sessionManager.getMCPManager().getTools();
    } catch (error) {
      logError('[MCP] Error getting tools:', error);
      return [];
    }
  });

  ipcMain.handle('mcp.getServerStatus', () => {
    try {
      const sessionManager = deps.getSessionManager();
      if (!sessionManager) return [];
      return sessionManager.getMCPManager().getServerStatus();
    } catch (error) {
      logError('[MCP] Error getting server status:', error);
      return [];
    }
  });

  ipcMain.handle('mcp.getPresets', () => {
    try {
      return mcpConfigStore.getPresets();
    } catch (error) {
      logError('[MCP] Error getting presets:', error);
      return {};
    }
  });
}
