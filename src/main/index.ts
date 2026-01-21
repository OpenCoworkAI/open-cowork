import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { join, resolve } from 'path';
import { config } from 'dotenv';
import { initDatabase } from './db/database';
import { SessionManager } from './session/session-manager';
import { SkillsManager } from './skills/skills-manager';
import { configStore, PROVIDER_PRESETS, type AppConfig } from './config/config-store';
import { mcpConfigStore } from './mcp/mcp-config-store';
import { credentialsStore, type UserCredential } from './credentials/credentials-store';
import { getSandboxAdapter, shutdownSandbox } from './sandbox/sandbox-adapter';
import { SandboxSync } from './sandbox/sandbox-sync';
import { WSLBridge } from './sandbox/wsl-bridge';
import { LimaBridge } from './sandbox/lima-bridge';
import { getSandboxBootstrap } from './sandbox/sandbox-bootstrap';
import type { MCPServerConfig } from './mcp/mcp-manager';
import type { ClientEvent, ServerEvent } from '../renderer/types';
import { log, logWarn, logError } from './utils/logger';

// Load .env file from project root (for development)
const envPath = resolve(__dirname, '../../.env');
log('[dotenv] Loading from:', envPath);
const dotenvResult = config({ path: envPath });
if (dotenvResult.error) {
  logWarn('[dotenv] Failed to load .env:', dotenvResult.error.message);
} else {
  log('[dotenv] Loaded successfully');
}

// Apply saved config (this overrides .env if config exists)
if (configStore.isConfigured()) {
  log('[Config] Applying saved configuration...');
  configStore.applyToEnv();
}

// Disable hardware acceleration for better compatibility
app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let sessionManager: SessionManager | null = null;
let skillsManager: SkillsManager | null = null;

function createWindow() {
  // Theme colors (warm cream theme)
  const THEME = {
    background: '#f5f3ee',
    titleBar: '#f5f3ee',
    titleBarSymbol: '#1a1a1a',
  };

  // Platform-specific window configuration
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';

  // Base window options
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: THEME.background,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };

  if (isMac) {
    // macOS: Use hiddenInset for native traffic light buttons
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 16, y: 12 };
  } else if (isWindows) {
    // Windows: Use frameless window with custom titlebar
    // Note: frame: false removes native frame, allowing custom titlebar
    windowOptions.frame = false;
  } else {
    // Linux: Use frameless window
    windowOptions.frame = false;
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Notify renderer about config status after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    const isConfigured = configStore.isConfigured();
    log('[Config] Notifying renderer, isConfigured:', isConfigured);
    sendToRenderer({
      type: 'config.status',
      payload: { 
        isConfigured,
        config: isConfigured ? configStore.getAll() : null,
      },
    });

    // Start sandbox bootstrap after window is loaded
    startSandboxBootstrap();
  });
}

/**
 * Start sandbox bootstrap in the background
 * This pre-initializes WSL/Lima environment at app startup
 */
async function startSandboxBootstrap(): Promise<void> {
  const bootstrap = getSandboxBootstrap();
  
  // Skip if already complete
  if (bootstrap.isComplete()) {
    log('[App] Sandbox bootstrap already complete');
    return;
  }

  // Set up progress callback to notify renderer
  bootstrap.setProgressCallback((progress) => {
    sendToRenderer({
      type: 'sandbox.progress',
      payload: progress,
    });
  });

  // Start bootstrap (non-blocking)
  log('[App] Starting sandbox bootstrap...');
  try {
    const result = await bootstrap.bootstrap();
    log('[App] Sandbox bootstrap complete:', result.mode);
  } catch (error) {
    logError('[App] Sandbox bootstrap error:', error);
  }
}

// Send event to renderer
function sendToRenderer(event: ServerEvent) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-event', event);
  }
}

// Initialize app
app.whenReady().then(async () => {
  // Log environment variables for debugging
  log('=== Open Cowork Starting ===');
  log('Config file:', configStore.getPath());
  log('Is configured:', configStore.isConfigured());
  log('Environment Variables:');
  log('  ANTHROPIC_AUTH_TOKEN:', process.env.ANTHROPIC_AUTH_TOKEN ? '✓ Set' : '✗ Not set');
  log('  ANTHROPIC_BASE_URL:', process.env.ANTHROPIC_BASE_URL || '(not set)');
  log('  CLAUDE_MODEL:', process.env.CLAUDE_MODEL || '(not set)');
  log('  CLAUDE_CODE_PATH:', process.env.CLAUDE_CODE_PATH || '(not set)');
  log('  OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✓ Set' : '✗ Not set');
  log('  OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL || '(not set)');
  log('  OPENAI_MODEL:', process.env.OPENAI_MODEL || '(not set)');
  log('  OPENAI_API_MODE:', process.env.OPENAI_API_MODE || '(default)');
  log('===========================');
  
  // Initialize database
  const db = initDatabase();

  // Initialize skills manager
  skillsManager = new SkillsManager(db);

  // Initialize session manager
  sessionManager = new SessionManager(db, sendToRenderer);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Flag to prevent double cleanup
let isCleaningUp = false;

/**
 * Cleanup all sandbox resources
 * Called on app quit (both Windows and macOS)
 */
async function cleanupSandboxResources(): Promise<void> {
  if (isCleaningUp) {
    log('[App] Cleanup already in progress, skipping...');
    return;
  }
  isCleaningUp = true;

  // Cleanup all sandbox sessions (sync changes back to host OS first)
  try {
    log('[App] Cleaning up all sandbox sessions...');

    // Cleanup WSL sessions
    await SandboxSync.cleanupAllSessions();

    // Cleanup Lima sessions
    const { LimaSync } = await import('./sandbox/lima-sync');
    await LimaSync.cleanupAllSessions();

    log('[App] Sandbox sessions cleanup complete');
  } catch (error) {
    logError('[App] Error cleaning up sandbox sessions:', error);
  }

  // Shutdown sandbox adapter
  try {
    await shutdownSandbox();
    log('[App] Sandbox shutdown complete');
  } catch (error) {
    logError('[App] Error shutting down sandbox:', error);
  }
}

// Handle app quit - window-all-closed (primary for Windows/Linux)
app.on('window-all-closed', async () => {
  await cleanupSandboxResources();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle app quit - before-quit (for macOS Cmd+Q and other quit methods)
app.on('before-quit', async (event) => {
  if (!isCleaningUp) {
    event.preventDefault();
    await cleanupSandboxResources();
    app.quit();
  }
});

// IPC Handlers
ipcMain.on('client-event', async (_event, data: ClientEvent) => {
  try {
    await handleClientEvent(data);
  } catch (error) {
    logError('Error handling client event:', error);
    sendToRenderer({
      type: 'error',
      payload: { message: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
});

ipcMain.handle('client-invoke', async (_event, data: ClientEvent) => {
  return handleClientEvent(data);
});

ipcMain.handle('get-version', () => {
  return app.getVersion();
});

ipcMain.handle('shell.openExternal', async (_event, url: string) => {
  if (!url) {
    return false;
  }

  return shell.openExternal(url);
});

ipcMain.handle('dialog.selectFiles', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    title: 'Select Files',
  });

  if (result.canceled) {
    return [];
  }

  return result.filePaths;
});

// Config IPC handlers
ipcMain.handle('config.get', () => {
  return configStore.getAll();
});

ipcMain.handle('config.getPresets', () => {
  return PROVIDER_PRESETS;
});

ipcMain.handle('config.save', (_event, newConfig: Partial<AppConfig>) => {
  log('[Config] Saving config:', { ...newConfig, apiKey: newConfig.apiKey ? '***' : '' });

  // Update config
  configStore.update(newConfig);

  // Mark as configured if we have an API key
  if (newConfig.apiKey) {
    configStore.set('isConfigured', true);
  }

  // Apply to environment
  configStore.applyToEnv();

  // Reload config in session manager (safer than recreating it)
  if (sessionManager) {
    sessionManager.reloadConfig();
    log('[Config] Session manager config reloaded');
  }

  // Notify renderer of config update
  const isConfigured = configStore.isConfigured();
  const updatedConfig = configStore.getAll();
  sendToRenderer({
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

// MCP Server IPC handlers
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
  // Update only this specific server, not all servers
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
  // Remove and disconnect only this specific server
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
    if (!sessionManager) {
      return [];
    }
    const mcpManager = sessionManager.getMCPManager();
    return mcpManager.getTools();
  } catch (error) {
    logError('[MCP] Error getting tools:', error);
    return [];
  }
});

ipcMain.handle('mcp.getServerStatus', () => {
  try {
    if (!sessionManager) {
      return [];
    }
    const mcpManager = sessionManager.getMCPManager();
    return mcpManager.getServerStatus();
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

// Credentials IPC handlers
ipcMain.handle('credentials.getAll', () => {
  try {
    // Return credentials without passwords for UI display
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

// Skills API handlers
ipcMain.handle('skills.getAll', async () => {
  try {
    if (!skillsManager) {
      logError('[Skills] SkillsManager not initialized');
      return [];
    }
    const skills = skillsManager.listSkills();
    return skills;
  } catch (error) {
    logError('[Skills] Error getting skills:', error);
    return [];
  }
});

ipcMain.handle('skills.install', async (_event, skillPath: string) => {
  try {
    if (!skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    const skill = await skillsManager.installSkill(skillPath);
    return { success: true, skill };
  } catch (error) {
    logError('[Skills] Error installing skill:', error);
    throw error;
  }
});

ipcMain.handle('skills.delete', async (_event, skillId: string) => {
  try {
    if (!skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    await skillsManager.uninstallSkill(skillId);
    return { success: true };
  } catch (error) {
    logError('[Skills] Error deleting skill:', error);
    throw error;
  }
});

ipcMain.handle('skills.setEnabled', async (_event, skillId: string, enabled: boolean) => {
  try {
    if (!skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    skillsManager.setSkillEnabled(skillId, enabled);
    return { success: true };
  } catch (error) {
    logError('[Skills] Error toggling skill:', error);
    throw error;
  }
});

ipcMain.handle('skills.validate', async (_event, skillPath: string) => {
  try {
    if (!skillsManager) {
      return { valid: false, errors: ['SkillsManager not initialized'] };
    }
    const result = await skillsManager.validateSkillFolder(skillPath);
    return result;
  } catch (error) {
    logError('[Skills] Error validating skill:', error);
    return { valid: false, errors: ['Validation failed'] };
  }
});

// Window control IPC handlers
ipcMain.on('window.minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window.maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window.close', () => {
  mainWindow?.close();
});

// Sandbox IPC handlers
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

ipcMain.handle('sandbox.installClaudeCodeInLima', async () => {
  try {
    return await LimaBridge.installClaudeCodeInLima();
  } catch (error) {
    logError('[Sandbox] Error installing claude-code in Lima:', error);
    return false;
  }
});

async function handleClientEvent(event: ClientEvent): Promise<unknown> {
  // Check if configured before starting sessions
  if (event.type === 'session.start' && !configStore.isConfigured()) {
    sendToRenderer({
      type: 'error',
      payload: { message: '请先配置 API Key' },
    });
    sendToRenderer({
      type: 'config.status',
      payload: { isConfigured: false, config: null },
    });
    return null;
  }

  if (!sessionManager) {
    throw new Error('Session manager not initialized');
  }

  switch (event.type) {
    case 'session.start':
      return sessionManager.startSession(
        event.payload.title,
        event.payload.prompt,
        event.payload.cwd,
        event.payload.allowedTools,
        event.payload.content
      );

    case 'session.continue':
      return sessionManager.continueSession(
        event.payload.sessionId,
        event.payload.prompt,
        event.payload.content
      );

    case 'session.stop':
      return sessionManager.stopSession(event.payload.sessionId);

    case 'session.delete':
      return sessionManager.deleteSession(event.payload.sessionId);

    case 'session.list':
      const sessions = sessionManager.listSessions();
      sendToRenderer({ type: 'session.list', payload: { sessions } });
      return sessions;

    case 'session.getMessages':
      return sessionManager.getMessages(event.payload.sessionId);

    case 'session.getTraceSteps':
      return sessionManager.getTraceSteps(event.payload.sessionId);

    case 'permission.response':
      return sessionManager.handlePermissionResponse(
        event.payload.toolUseId,
        event.payload.result
      );

    case 'question.response':
      return sessionManager.handleQuestionResponse(
        event.payload.questionId,
        event.payload.answer
      );

    case 'folder.select':
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
      });
      if (!result.canceled && result.filePaths.length > 0) {
        sendToRenderer({
          type: 'folder.selected',
          payload: { path: result.filePaths[0] },
        });
        return result.filePaths[0];
      }
      return null;

    case 'settings.update':
      // TODO: Implement settings update
      return null;

    default:
      logWarn('Unknown event type:', event);
      return null;
  }
}
