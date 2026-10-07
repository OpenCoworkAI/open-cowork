import i18n from '../i18n/config';
import { useAppStore } from '../store';
import type { PermissionRequest, SessionStatus, SudoPasswordRequest } from '../types';

const STORAGE_KEY = 'systemNotificationsEnabled';

const runningSessionIds = new Set<string>();

export function areSystemNotificationsEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'false';
}

export function setSystemNotificationsEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(enabled));
}

function notifyForSession(sessionId: string, body: string): void {
  if (!areSystemNotificationsEnabled() || document.hasFocus()) return;
  const session = useAppStore.getState().sessions.find((item) => item.id === sessionId);
  const notification = new Notification(session?.title || 'Open Cowork', { body });
  notification.onclick = () => {
    window.electronAPI.window.show();
    const store = useAppStore.getState();
    store.setShowSettings(false);
    store.setActiveSession(sessionId);
  };
}

export function notifySessionStatus(sessionId: string, status: SessionStatus): void {
  if (status === 'running') {
    runningSessionIds.add(sessionId);
    return;
  }
  if (!runningSessionIds.delete(sessionId)) return;
  if (status === 'error') {
    notifyForSession(sessionId, i18n.t('notifications.taskFailed'));
  } else {
    notifyForSession(sessionId, i18n.t('notifications.taskFinished'));
  }
}

export function notifyPermissionRequest(request: PermissionRequest): void {
  notifyForSession(
    request.sessionId,
    i18n.t('notifications.approvalNeeded', { tool: request.toolName })
  );
}

export function notifySudoPasswordRequest(request: SudoPasswordRequest): void {
  notifyForSession(request.sessionId, i18n.t('notifications.passwordNeeded'));
}
