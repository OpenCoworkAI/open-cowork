import { ipcMain, dialog } from 'electron';
import { configStore } from '../config/config-store';
import { logWarn, logError } from '../utils/logger';
import type { ClientEvent } from '../../renderer/types';
import type { HandlerDependencies } from './types';

export function registerSessionHandlers(deps: HandlerDependencies) {
  ipcMain.on('client-event', async (_event, data: ClientEvent) => {
    try {
      await handleClientEvent(data, deps);
    } catch (error) {
      logError('Error handling client event:', error);
      deps.sendToRenderer({
        type: 'error',
        payload: { message: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  });

  ipcMain.handle('client-invoke', async (_event, data: ClientEvent) => {
    return handleClientEvent(data, deps);
  });
}

async function handleClientEvent(event: ClientEvent, deps: HandlerDependencies): Promise<unknown> {
  // Check if configured before starting sessions
  if (event.type === 'session.start' && !configStore.isConfigured()) {
    deps.sendToRenderer({
      type: 'error',
      payload: { message: ' API Key' },
    });
    deps.sendToRenderer({
      type: 'config.status',
      payload: { isConfigured: false, config: null },
    });
    return null;
  }

  const sessionManager = deps.getSessionManager();
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

    case 'session.list': {
      const sessions = sessionManager.listSessions();
      deps.sendToRenderer({ type: 'session.list', payload: { sessions } });
      return sessions;
    }

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

    case 'folder.select': {
      const mainWindow = deps.getMainWindow();
      const folderResult = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
      });
      if (!folderResult.canceled && folderResult.filePaths.length > 0) {
        deps.sendToRenderer({
          type: 'folder.selected',
          payload: { path: folderResult.filePaths[0] },
        });
        return folderResult.filePaths[0];
      }
      return null;
    }

    case 'workdir.get':
      return deps.getWorkingDir();

    case 'workdir.set':
      return deps.setWorkingDir(event.payload.path, event.payload.sessionId);

    case 'workdir.select': {
      const mainWindow = deps.getMainWindow();
      const currentWorkingDir = deps.getWorkingDir();
      const workdirResult = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
        title: 'Select Working Directory',
        defaultPath: currentWorkingDir || undefined,
      });
      if (!workdirResult.canceled && workdirResult.filePaths.length > 0) {
        const selectedPath = workdirResult.filePaths[0];
        return deps.setWorkingDir(selectedPath, event.payload.sessionId);
      }
      return { success: false, path: '', error: 'User cancelled' };
    }

    case 'settings.update':
      // TODO: Implement settings update
      return null;

    default:
      logWarn('Unknown event type:', event);
      return null;
  }
}
