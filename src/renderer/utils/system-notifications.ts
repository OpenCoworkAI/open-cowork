import i18n from '../i18n/config';
import { useAppStore } from '../store';
import type {
  Message,
  PermissionRequest,
  SessionStatus,
  SudoPasswordRequest,
  TraceStep,
} from '../types';

const STORAGE_KEY = 'systemNotificationsEnabled';

// `running` can arrive before a scheduled session reaches the store, so live
// run starts are tracked here as well as through the store's last status.
const runningSessionIds = new Set<string>();

export function areSystemNotificationsEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'false';
}

export function setSystemNotificationsEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(enabled));
}

async function openSession(sessionId: string): Promise<void> {
  window.electronAPI.window.show();
  const store = useAppStore.getState();
  store.setShowSettings(false);
  store.setActiveSession(sessionId);
  // A session restored from the session list has no history in the store yet.
  if (!store.sessionStates[sessionId]?.messages.length) {
    const messages = await window.electronAPI.invoke<Message[]>({
      type: 'session.getMessages',
      payload: { sessionId },
    });
    if (!useAppStore.getState().sessionStates[sessionId]?.messages.length) {
      useAppStore.getState().setMessages(sessionId, messages);
    }
  }
  if (!store.sessionStates[sessionId]?.traceSteps.length) {
    const steps = await window.electronAPI.invoke<TraceStep[]>({
      type: 'session.getTraceSteps',
      payload: { sessionId },
    });
    if (!useAppStore.getState().sessionStates[sessionId]?.traceSteps.length) {
      useAppStore.getState().setTraceSteps(sessionId, steps);
    }
  }
}

function notifyForSession(sessionId: string, body: string): void {
  if (!areSystemNotificationsEnabled() || document.hasFocus()) return;
  const session = useAppStore.getState().sessions.find((item) => item.id === sessionId);
  const notification = new Notification(session?.title || 'Open Cowork', { body });
  notification.onclick = () => void openSession(sessionId);
}

export function notifySessionStatus(
  sessionId: string,
  previousStatus: SessionStatus | undefined,
  status: SessionStatus
): void {
  if (status === 'running') {
    runningSessionIds.add(sessionId);
    return;
  }
  const wasRunning = runningSessionIds.delete(sessionId) || previousStatus === 'running';
  // Session status does not carry the run outcome, so the text stays neutral.
  if (wasRunning) notifyForSession(sessionId, i18n.t('notifications.taskEnded'));
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
