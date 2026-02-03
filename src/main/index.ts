import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { join, resolve } from 'path';
import * as fs from 'fs';
import { config } from 'dotenv';
import { initDatabase } from './db/database';
import { SessionManager } from './session/session-manager';
import { SkillsManager } from './skills/skills-manager';
import { configStore, PROVIDER_PRESETS, type AppConfig } from './config/config-store';
import { testApiConnection } from './config/api-tester';
import { mcpConfigStore } from './mcp/mcp-config-store';
import { credentialsStore, type UserCredential } from './credentials/credentials-store';
import { getSandboxAdapter, shutdownSandbox } from './sandbox/sandbox-adapter';
import { SandboxSync } from './sandbox/sandbox-sync';
import { WSLBridge } from './sandbox/wsl-bridge';
import { LimaBridge } from './sandbox/lima-bridge';
import { getSandboxBootstrap } from './sandbox/sandbox-bootstrap';
import type { MCPServerConfig } from './mcp/mcp-manager';
import type { ClientEvent, ServerEvent, ApiTestInput, ApiTestResult } from '../renderer/types';
import { remoteManager, type AgentExecutor } from './remote/remote-manager';
import { remoteConfigStore } from './remote/remote-config-store';
import type { GatewayConfig, FeishuChannelConfig, ChannelType } from './remote/types';
import {
  log,
  logWarn,
  logError,
  getLogFilePath,
  getLogsDirectory,
  getAllLogFiles,
  closeLogFile,
  setDevLogsEnabled,
  isDevLogsEnabled,
} from './utils/logger';

// Current working directory (persisted between sessions)
let currentWorkingDir: string | null = null;

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
      sandbox: false, // Temporarily disabled to test if it resolves the console error
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

  const allowedOrigins = new Set<string>();
  if (process.env.VITE_DEV_SERVER_URL) {
    try {
      allowedOrigins.add(new URL(process.env.VITE_DEV_SERVER_URL).origin);
    } catch {
      // 忽略无效的开发服务地址
    }
  }
  const allowedProtocols = new Set<string>(['file:', 'devtools:']);

  const isExternalUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      if (allowedProtocols.has(parsed.protocol)) {
        return false;
      }
      if (allowedOrigins.has(parsed.origin)) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isExternalUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // mainWindow.webContents.openDevTools(); // Commented out - open manually with Cmd+Option+I if needed
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

    // Send current working directory to renderer
    sendToRenderer({
      type: 'workdir.changed',
      payload: { path: currentWorkingDir || '' },
    });

    // Start sandbox bootstrap after window is loaded
    startSandboxBootstrap();
  });
}

/**
 * Initialize default working directory
 * This is always the app's default_working_dir in userData - it never changes
 * Each session can have its own cwd that differs from this default
 */
function initializeDefaultWorkingDir(): string {
  // Create default working directory in user data path (this is the permanent global default)
  const userDataPath = app.getPath('userData');
  const defaultDir = join(userDataPath, 'default_working_dir');
  
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
    log('[App] Created default working directory:', defaultDir);
  }
  
  currentWorkingDir = defaultDir;
  
  log('[App] Global default working directory:', currentWorkingDir);
  return currentWorkingDir;
}

/**
 * Get current working directory
 */
function getWorkingDir(): string | null {
  return currentWorkingDir;
}

/**
 * Set working directory
 * - If sessionId is provided: update only that session's cwd (for switching directories within a chat)
 * - If no sessionId: update UI display only (for WelcomeView - will be used when creating new session)
 * 
 * Note: The global default (currentWorkingDir) is NEVER changed after initialization.
 * It is always app.getPath('userData')/default_working_dir
 */
async function setWorkingDir(newDir: string, sessionId?: string): Promise<{ success: boolean; path: string; error?: string }> {
  if (!fs.existsSync(newDir)) {
    return { success: false, path: newDir, error: 'Directory does not exist' };
  }
  
  if (sessionId && sessionManager) {
    // Update only this session's cwd - don't change the global default
    log('[App] Updating session cwd:', sessionId, '->', newDir);
    sessionManager.updateSessionCwd(sessionId, newDir);
    
    // Clear this session's sandbox mapping so next query uses the new directory
    SandboxSync.clearSession(sessionId);
    const { LimaSync } = await import('./sandbox/lima-sync');
    LimaSync.clearSession(sessionId);
  }
  
  // Notify renderer of workdir change (for UI display)
  // This updates what the user sees, and will be passed to startSession for new sessions
  sendToRenderer({
    type: 'workdir.changed',
    payload: { path: newDir },
  });
  
  log('[App] Working directory for UI updated:', newDir, sessionId ? `(session: ${sessionId})` : '(pending new session)');
  
  return { success: true, path: newDir };
}

/**
 * Start sandbox bootstrap in the background
 * This pre-initializes WSL/Lima environment at app startup
 */
async function startSandboxBootstrap(): Promise<void> {
  // Skip sandbox bootstrap if disabled - use native mode directly
  const sandboxEnabled = configStore.get('sandboxEnabled');
  if (sandboxEnabled === false) {
    log('[App] Sandbox disabled, skipping bootstrap (using native mode)');
    return;
  }

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

// 发送事件到渲染进程（含远程会话拦截）
function sendToRenderer(event: ServerEvent) {
  const payload = event.payload as { sessionId?: string; [key: string]: any };
  const sessionId = payload?.sessionId;
  
  // 判断是否远程会话
  if (sessionId && remoteManager.isRemoteSession(sessionId)) {
    // 处理远程会话事件
    
    // 拦截 stream.message，用于回传到远程通道
    if (event.type === 'stream.message') {
      const message = payload.message as { role?: string; content?: Array<{ type: string; text?: string }> };
      if (message?.role === 'assistant' && message?.content) {
        // 提取助手文本内容
        const textContent = message.content
          .filter((c: any) => c.type === 'text' && c.text)
          .map((c: any) => c.text)
          .join('\n');
        
        if (textContent) {
          // 发送到远程通道（带缓冲）
          remoteManager.sendResponseToChannel(sessionId, textContent).catch((err: Error) => {
            logError('[Remote] Failed to send response to channel:', err);
          });
        }
      }
    }
    
    // 拦截 trace.step 作为工具进度
    if (event.type === 'trace.step') {
      const step = payload.step as { type?: string; toolName?: string; status?: string; title?: string };
      if (step?.type === 'tool_call' && step?.toolName) {
        remoteManager.sendToolProgress(
          sessionId,
          step.toolName,
          step.status === 'completed' ? 'completed' : step.status === 'error' ? 'error' : 'running'
        ).catch((err: Error) => {
          logError('[Remote] Failed to send tool progress:', err);
        });
      }
    }
    
    // trace.update 预留；当前主要用 trace.step
    
    // 拦截 session.status 用于清理
    if (event.type === 'session.status') {
      const status = payload.status as string;
      if (status === 'idle' || status === 'error') {
        // 会话结束，清空缓冲
        remoteManager.clearSessionBuffer(sessionId).catch((err: Error) => {
          logError('[Remote] Failed to clear session buffer:', err);
        });
      }
    }
    
    // 拦截 question.request
    if (event.type === 'question.request' && payload.questionId && payload.questions) {
      log('[Remote] Intercepting question for remote session:', sessionId);
      remoteManager.handleQuestionRequest(
        sessionId,
        payload.questionId,
        payload.questions
      ).then((answer) => {
        if (answer !== null && sessionManager) {
          sessionManager.handleQuestionResponse(payload.questionId!, answer);
        }
      }).catch((err) => {
        logError('[Remote] Failed to handle question request:', err);
      });
      return; // 不发送到本地 UI
    }
    
    // 拦截 permission.request
    if (event.type === 'permission.request' && payload.toolUseId && payload.toolName) {
      log('[Remote] Intercepting permission for remote session:', sessionId);
      remoteManager.handlePermissionRequest(
        sessionId,
        payload.toolUseId,
        payload.toolName,
        payload.input || {}
      ).then((result) => {
        if (result !== null && sessionManager) {
          let permissionResult: 'allow' | 'deny' | 'allow_always';
          if (result.allow) {
            permissionResult = result.remember ? 'allow_always' : 'allow';
          } else {
            permissionResult = 'deny';
          }
          sessionManager.handlePermissionResponse(payload.toolUseId!, permissionResult);
        }
      }).catch((err) => {
        logError('[Remote] Failed to handle permission request:', err);
      });
      return; // 不发送到本地 UI
    }
  }
  
  // 发送到本地 UI
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-event', event);
  }
}

// Initialize app
app.whenReady().then(async () => {
  // TODO: Re-enable sandbox when debugging is complete
  // Force disable sandbox on startup (temporary fix)
  configStore.set('sandboxEnabled', false);
  
  // Apply dev logs setting from config
  const enableDevLogs = configStore.get('enableDevLogs');
  setDevLogsEnabled(enableDevLogs);
  
  // Log environment variables for debugging
  log('=== Open Cowork Starting ===');
  log('Config file:', configStore.getPath());
  log('Is configured:', configStore.isConfigured());
  log('Developer logs:', enableDevLogs ? 'Enabled' : 'Disabled');
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
  
  // Initialize default working directory
  initializeDefaultWorkingDir();
  log('Working directory:', currentWorkingDir);
  
  // Initialize database
  const db = initDatabase();

  // Initialize skills manager
  skillsManager = new SkillsManager(db);

  // Initialize session manager
  sessionManager = new SessionManager(db, sendToRenderer);

  // 初始化远程管理器
  remoteManager.setRendererCallback(sendToRenderer);
  const agentExecutor: AgentExecutor = {
    startSession: async (title, prompt, cwd) => {
      if (!sessionManager) throw new Error('Session manager not initialized');
      return sessionManager.startSession(title, prompt, cwd);
    },
    continueSession: async (sessionId, prompt, content) => {
      if (!sessionManager) throw new Error('Session manager not initialized');
      await sessionManager.continueSession(sessionId, prompt, content);
    },
    stopSession: async (sessionId) => {
      if (!sessionManager) throw new Error('Session manager not initialized');
      await sessionManager.stopSession(sessionId);
    },
  };
  remoteManager.setAgentExecutor(agentExecutor);

  // 远程控制启用时启动
  if (remoteConfigStore.isEnabled()) {
    remoteManager.start().catch(error => {
      logError('[App] Failed to start remote control:', error);
    });
  }

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

  // 停止远程控制
  try {
    log('[App] Stopping remote control...');
    await remoteManager.stop();
    log('[App] Remote control stopped');
  } catch (error) {
    logError('[App] Error stopping remote control:', error);
  }

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
    closeLogFile(); // Close log file before quitting
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

ipcMain.handle('shell.showItemInFolder', async (_event, filePath: string) => {
  if (!filePath) {
    return false;
  }

  return shell.showItemInFolder(filePath);
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

// Logs IPC handlers
ipcMain.handle('logs.getPath', () => {
  try {
    return getLogFilePath();
  } catch (error) {
    logError('[Logs] Error getting log path:', error);
    return null;
  }
});

ipcMain.handle('logs.getDirectory', () => {
  try {
    return getLogsDirectory();
  } catch (error) {
    logError('[Logs] Error getting logs directory:', error);
    return null;
  }
});

ipcMain.handle('logs.getAll', () => {
  try {
    return getAllLogFiles();
  } catch (error) {
    logError('[Logs] Error getting all log files:', error);
    return [];
  }
});

ipcMain.handle('logs.export', async () => {
  try {
    const logFiles = getAllLogFiles();
    
    if (logFiles.length === 0) {
      return { success: false, error: 'No log files found' };
    }

    // Show save dialog
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Logs',
      defaultPath: `opencowork-logs-${new Date().toISOString().split('T')[0]}.zip`,
      filters: [
        { name: 'ZIP Archive', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'User cancelled' };
    }

    // Dynamic import archiver
    const archiver = await import('archiver');
    const output = fs.createWriteStream(result.filePath);
    const archive = archiver.default('zip', { zlib: { level: 9 } });

    return new Promise((resolve) => {
      output.on('close', () => {
        log('[Logs] Exported logs to:', result.filePath);
        resolve({ 
          success: true, 
          path: result.filePath,
          size: archive.pointer()
        });
      });

      archive.on('error', (err: Error) => {
        logError('[Logs] Error creating archive:', err);
        resolve({ success: false, error: err.message });
      });

      archive.pipe(output);

      // Add all log files
      for (const logFile of logFiles) {
        archive.file(logFile.path, { name: logFile.name });
      }

      // Add system info
      const systemInfo = {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        appVersion: app.getVersion(),
        exportDate: new Date().toISOString(),
        logFiles: logFiles.map(f => ({
          name: f.name,
          size: f.size,
          modified: f.mtime
        }))
      };
      archive.append(JSON.stringify(systemInfo, null, 2), { name: 'system-info.json' });

      archive.finalize();
    });
  } catch (error) {
    logError('[Logs] Error exporting logs:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('logs.open', async () => {
  try {
    const logsDir = getLogsDirectory();
    await shell.openPath(logsDir);
    return { success: true };
  } catch (error) {
    logError('[Logs] Error opening logs directory:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('logs.clear', async () => {
  try {
    const logFiles = getAllLogFiles();
    
    // Close current log file
    closeLogFile();
    
    // Delete all log files
    for (const logFile of logFiles) {
      try {
        fs.unlinkSync(logFile.path);
        log('[Logs] Deleted log file:', logFile.name);
      } catch (err) {
        logError('[Logs] Failed to delete log file:', logFile.name, err);
      }
    }
    
    // Log will automatically reinitialize on next log call
    log('[Logs] Log files cleared and reinitialized');
    
    return { success: true, deletedCount: logFiles.length };
  } catch (error) {
    logError('[Logs] Error clearing logs:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('logs.setEnabled', async (_event, enabled: boolean) => {
  try {
    setDevLogsEnabled(enabled);
    configStore.set('enableDevLogs', enabled);
    log('[Logs] Developer logs', enabled ? 'enabled' : 'disabled');
    return { success: true, enabled };
  } catch (error) {
    logError('[Logs] Error setting dev logs enabled:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('logs.isEnabled', () => {
  try {
    return { success: true, enabled: isDevLogsEnabled() };
  } catch (error) {
    logError('[Logs] Error getting dev logs enabled:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// ============================================================================
// 远程控制 IPC 处理
// ============================================================================

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

ipcMain.handle('remote.updateFeishuConfig', async (_event, config: FeishuChannelConfig) => {
  try {
    await remoteManager.updateFeishuConfig(config);
    return { success: true };
  } catch (error) {
    logError('[Remote] Error updating Feishu config:', error);
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

ipcMain.handle('remote.getWebhookUrl', () => {
  try {
    return remoteManager.getFeishuWebhookUrl();
  } catch (error) {
    logError('[Remote] Error getting webhook URL:', error);
    return null;
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

ipcMain.handle('logs.write', (_event, level: 'info' | 'warn' | 'error', args: any[]) => {
  try {
    if (level === 'warn') {
      logWarn(...args);
    } else if (level === 'error') {
      logError(...args);
    } else {
      log(...args);
    }
    return { success: true };
  } catch (error) {
    console.error('[Logs] Error writing log:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('sandbox.retryLimaSetup', async () => {
  if (process.platform !== 'darwin') {
    return { success: false, error: 'Lima is only available on macOS' };
  }

  try {
    const bootstrap = getSandboxBootstrap();
    bootstrap.setProgressCallback((progress) => {
      sendToRenderer({
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

// Generic retry setup for both WSL and Lima
ipcMain.handle('sandbox.retrySetup', async () => {
  try {
    const bootstrap = getSandboxBootstrap();
    bootstrap.setProgressCallback((progress) => {
      sendToRenderer({
        type: 'sandbox.progress',
        payload: progress,
      });
    });

    // Reset and re-run bootstrap
    bootstrap.reset();
    const result = await bootstrap.bootstrap();
    const success = !result.error;
    return { success, result, error: result.error };
  } catch (error) {
    logError('[Sandbox] Error retrying setup:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
      const folderResult = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
      });
      if (!folderResult.canceled && folderResult.filePaths.length > 0) {
        sendToRenderer({
          type: 'folder.selected',
          payload: { path: folderResult.filePaths[0] },
        });
        return folderResult.filePaths[0];
      }
      return null;

    case 'workdir.get':
      return getWorkingDir();

    case 'workdir.set':
      return setWorkingDir(event.payload.path, event.payload.sessionId);

    case 'workdir.select':
      const workdirResult = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
        title: 'Select Working Directory',
        defaultPath: currentWorkingDir || undefined,
      });
      if (!workdirResult.canceled && workdirResult.filePaths.length > 0) {
        const selectedPath = workdirResult.filePaths[0];
        return setWorkingDir(selectedPath, event.payload.sessionId);
      }
      return { success: false, path: '', error: 'User cancelled' };

    case 'settings.update':
      // TODO: Implement settings update
      return null;

    default:
      logWarn('Unknown event type:', event);
      return null;
  }
}
