import { app, BrowserWindow } from 'electron';
import { join, resolve } from 'path';
import * as fs from 'fs';
import { config } from 'dotenv';
import { initDatabase } from './db/database';
import { SessionManager } from './session/session-manager';
import { SkillsManager } from './skills/skills-manager';
import { PluginCatalogService } from './skills/plugin-catalog-service';
import { PluginRuntimeService } from './skills/plugin-runtime-service';
import { configStore } from './config/config-store';
import { SandboxSync } from './sandbox/sandbox-sync';
import { getSandboxBootstrap } from './sandbox/sandbox-bootstrap';
import type { ServerEvent } from '../renderer/types';
import { remoteManager, type AgentExecutor } from './remote/remote-manager';
import { remoteConfigStore } from './remote/remote-config-store';
import {
  log,
  logWarn,
  logError,
  closeLogFile,
  setDevLogsEnabled,
} from './utils/logger';
import { vmManager } from './vm/vm-manager';
import { getVMBootstrap } from './vm/vm-bootstrap';
import { getVMHealthMonitor } from './vm/vm-health-monitor';
import { shutdownSandbox } from './sandbox/sandbox-adapter';
import { registerAllHandlers } from './ipc/registry';

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
let pluginRuntimeService: PluginRuntimeService | null = null;

function createWindow() {
  const THEME = {
    background: '#000000',
    titleBar: '#000000',
    titleBarSymbol: '#f0f0f0',
  };

  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';

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
      sandbox: false, // TODO: Re-enable when preload compatibility is verified
    },
  };

  if (isMac) {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 16, y: 12 };
  } else if (isWindows) {
    windowOptions.frame = false;
  } else {
    windowOptions.frame = false;
  }

  mainWindow = new BrowserWindow(windowOptions);

  const allowedOrigins = new Set<string>();
  if (process.env.VITE_DEV_SERVER_URL) {
    try {
      allowedOrigins.add(new URL(process.env.VITE_DEV_SERVER_URL).origin);
    } catch {
      // ignore
    }
  }
  const allowedProtocols = new Set<string>(['file:', 'devtools:']);

  const isExternalUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      if (allowedProtocols.has(parsed.protocol)) return false;
      if (allowedOrigins.has(parsed.origin)) return false;
      return true;
    } catch {
      return true;
    }
  };

  const { shell } = require('electron');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      void shell.openExternal(url);
      return { action: 'deny' as const };
    }
    return { action: 'allow' as const };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isExternalUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

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

    sendToRenderer({
      type: 'workdir.changed',
      payload: { path: currentWorkingDir || '' },
    });

    startSandboxBootstrap();
    startVMBootstrap();
  });
}

function initializeDefaultWorkingDir(): string {
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

function getWorkingDir(): string | null {
  return currentWorkingDir;
}

async function setWorkingDir(newDir: string, sessionId?: string): Promise<{ success: boolean; path: string; error?: string }> {
  if (!fs.existsSync(newDir)) {
    return { success: false, path: newDir, error: 'Directory does not exist' };
  }

  if (sessionId && sessionManager) {
    log('[App] Updating session cwd:', sessionId, '->', newDir);
    sessionManager.updateSessionCwd(sessionId, newDir);

    SandboxSync.clearSession(sessionId);
    const { LimaSync } = await import('./sandbox/lima-sync');
    LimaSync.clearSession(sessionId);
  }

  sendToRenderer({
    type: 'workdir.changed',
    payload: { path: newDir },
  });

  log('[App] Working directory for UI updated:', newDir, sessionId ? `(session: ${sessionId})` : '(pending new session)');
  return { success: true, path: newDir };
}

async function startSandboxBootstrap(): Promise<void> {
  const sandboxEnabled = configStore.get('sandboxEnabled');
  if (sandboxEnabled === false) {
    log('[App] Sandbox disabled, skipping bootstrap (using native mode)');
    return;
  }

  const bootstrap = getSandboxBootstrap();

  if (bootstrap.isComplete()) {
    log('[App] Sandbox bootstrap already complete');
    return;
  }

  bootstrap.setProgressCallback((progress) => {
    sendToRenderer({ type: 'sandbox.progress', payload: progress });
  });

  log('[App] Starting sandbox bootstrap...');
  try {
    const result = await bootstrap.bootstrap();
    log('[App] Sandbox bootstrap complete:', result.mode);
  } catch (error) {
    logError('[App] Sandbox bootstrap error:', error);
  }
}

async function startVMBootstrap(): Promise<void> {
  const bootstrap = getVMBootstrap();

  if (bootstrap.isComplete()) {
    log('[App] VM bootstrap already complete');
    return;
  }

  bootstrap.setProgressCallback((progress) => {
    sendToRenderer({
      type: 'vm.bootstrapProgress' as any,
      payload: progress,
    });
  });

  log('[App] Starting VM bootstrap...');
  try {
    const result = await bootstrap.bootstrap();
    log('[App] VM bootstrap complete, provisioned:', result.provisioned);

    if (result.provisioned || vmManager.getAllVMConfigs().length > 0) {
      startVMHealthMonitor();
    }
  } catch (error) {
    logError('[App] VM bootstrap error:', error);
  }
}

function startVMHealthMonitor(): void {
  const monitor = getVMHealthMonitor();
  monitor.start((event) => {
    sendToRenderer({
      type: 'vm.healthEvent' as any,
      payload: event,
    });
  });
  log('[App] VM health monitor started');
}

function sendToRenderer(event: ServerEvent) {
  const payload = event.payload as { sessionId?: string; [key: string]: any };
  const sessionId = payload?.sessionId;

  if (sessionId && remoteManager.isRemoteSession(sessionId)) {
    // stream.message
    if (event.type === 'stream.message') {
      const message = payload.message as { role?: string; content?: Array<{ type: string; text?: string }> };
      if (message?.role === 'assistant' && message?.content) {
        const textContent = message.content
          .filter((c: any) => c.type === 'text' && c.text)
          .map((c: any) => c.text)
          .join('\n');

        if (textContent) {
          remoteManager.sendResponseToChannel(sessionId, textContent).catch((err: Error) => {
            logError('[Remote] Failed to send response to channel:', err);
          });
        }
      }
    }

    // trace.step
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

    // session.status
    if (event.type === 'session.status') {
      const status = payload.status as string;
      if (status === 'idle' || status === 'error') {
        remoteManager.clearSessionBuffer(sessionId).catch((err: Error) => {
          logError('[Remote] Failed to clear session buffer:', err);
        });
      }
    }

    // question.request
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
      return;
    }

    // permission.request
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
      return;
    }
  }

  // Send to renderer UI
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-event', event);
  }
}

// Initialize app
app.whenReady().then(async () => {
  // TODO: Re-enable sandbox when debugging is complete
  configStore.set('sandboxEnabled', false);

  const enableDevLogs = configStore.get('enableDevLogs');
  setDevLogsEnabled(enableDevLogs);

  log('=== Coeadapt Starting ===');
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

  initializeDefaultWorkingDir();
  log('Working directory:', currentWorkingDir);
  remoteManager.setDefaultWorkingDirectory(currentWorkingDir || undefined);

  const db = initDatabase();

  skillsManager = new SkillsManager(db);
  pluginRuntimeService = new PluginRuntimeService(new PluginCatalogService());

  sessionManager = new SessionManager(db, sendToRenderer, pluginRuntimeService);

  vmManager.setEventCallback(sendToRenderer);

  // Register all IPC handlers
  registerAllHandlers({
    getMainWindow: () => mainWindow,
    getSessionManager: () => sessionManager,
    getSkillsManager: () => skillsManager,
    getPluginRuntimeService: () => pluginRuntimeService,
    sendToRenderer,
    getWorkingDir,
    setWorkingDir,
  });

  // Wire remote manager
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

// Cleanup
let isCleaningUp = false;

async function cleanupSandboxResources(): Promise<void> {
  if (isCleaningUp) {
    log('[App] Cleanup already in progress, skipping...');
    return;
  }
  isCleaningUp = true;

  try {
    log('[App] Stopping remote control...');
    await remoteManager.stop();
    log('[App] Remote control stopped');
  } catch (error) {
    logError('[App] Error stopping remote control:', error);
  }

  try {
    log('[App] Stopping VM health monitor...');
    getVMHealthMonitor().stop();
    log('[App] VM health monitor stopped');
  } catch (error) {
    logError('[App] Error stopping VM health monitor:', error);
  }

  try {
    log('[App] Shutting down VMs...');
    await vmManager.shutdownAll();
    log('[App] VM shutdown complete');
  } catch (error) {
    logError('[App] Error shutting down VMs:', error);
  }

  try {
    log('[App] Cleaning up all sandbox sessions...');
    await SandboxSync.cleanupAllSessions();
    const { LimaSync } = await import('./sandbox/lima-sync');
    await LimaSync.cleanupAllSessions();
    log('[App] Sandbox sessions cleanup complete');
  } catch (error) {
    logError('[App] Error cleaning up sandbox sessions:', error);
  }

  try {
    await shutdownSandbox();
    log('[App] Sandbox shutdown complete');
  } catch (error) {
    logError('[App] Error shutting down sandbox:', error);
  }
}

app.on('window-all-closed', async () => {
  await cleanupSandboxResources();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  if (!isCleaningUp) {
    event.preventDefault();
    await vmManager.shutdownAll();
    await cleanupSandboxResources();
    closeLogFile();
    app.quit();
  }
});
