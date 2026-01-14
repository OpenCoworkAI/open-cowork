import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join, resolve } from 'path';
import { config } from 'dotenv';
import { initDatabase } from './db/database';
import { SessionManager } from './session/session-manager';
import type { ClientEvent, ServerEvent } from '../renderer/types';

// Load .env file from project root
// In dev mode, __dirname is dist-electron/main, so we go up 2 levels
const envPath = resolve(__dirname, '../../.env');
console.log('[dotenv] Loading from:', envPath);
const dotenvResult = config({ path: envPath });
if (dotenvResult.error) {
  console.warn('[dotenv] Failed to load .env:', dotenvResult.error.message);
} else {
  console.log('[dotenv] Loaded successfully');
}

// Disable hardware acceleration for better compatibility
app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let sessionManager: SessionManager | null = null;

function createWindow() {
  // Theme colors (warm cream theme)
  const THEME = {
    background: '#f5f3ee',
    titleBar: '#f5f3ee',
    titleBarSymbol: '#1a1a1a',
  };

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: THEME.titleBar,
      symbolColor: THEME.titleBarSymbol,
      height: 40,
    },
    backgroundColor: THEME.background,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

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
  console.log('=== Open Cowork Starting ===');
  console.log('Environment Variables:');
  console.log('  ANTHROPIC_AUTH_TOKEN:', process.env.ANTHROPIC_AUTH_TOKEN ? '✓ Set' : '✗ Not set');
  console.log('  ANTHROPIC_BASE_URL:', process.env.ANTHROPIC_BASE_URL || '(not set)');
  console.log('  CLAUDE_MODEL:', process.env.CLAUDE_MODEL || '(not set)');
  console.log('  CLAUDE_CODE_PATH:', process.env.CLAUDE_CODE_PATH || '(not set)');
  console.log('===========================');
  
  // Initialize database
  const db = initDatabase();
  
  // Initialize session manager
  sessionManager = new SessionManager(db, sendToRenderer);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Handle app quit
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.on('client-event', async (event, data: ClientEvent) => {
  try {
    await handleClientEvent(data);
  } catch (error) {
    console.error('Error handling client event:', error);
    sendToRenderer({
      type: 'error',
      payload: { message: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
});

ipcMain.handle('client-invoke', async (event, data: ClientEvent) => {
  return handleClientEvent(data);
});

ipcMain.handle('get-version', () => {
  return app.getVersion();
});

async function handleClientEvent(event: ClientEvent): Promise<unknown> {
  if (!sessionManager) {
    throw new Error('Session manager not initialized');
  }

  switch (event.type) {
    case 'session.start':
      return sessionManager.startSession(
        event.payload.title,
        event.payload.prompt,
        event.payload.cwd,
        event.payload.allowedTools
      );

    case 'session.continue':
      return sessionManager.continueSession(
        event.payload.sessionId,
        event.payload.prompt
      );

    case 'session.stop':
      return sessionManager.stopSession(event.payload.sessionId);

    case 'session.delete':
      return sessionManager.deleteSession(event.payload.sessionId);

    case 'session.list':
      const sessions = sessionManager.listSessions();
      sendToRenderer({ type: 'session.list', payload: { sessions } });
      return sessions;

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
      console.warn('Unknown event type:', event);
      return null;
  }
}

