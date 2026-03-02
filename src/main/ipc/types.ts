import type { BrowserWindow } from 'electron';
import type { SessionManager } from '../session/session-manager';
import type { SkillsManager } from '../skills/skills-manager';
import type { PluginRuntimeService } from '../skills/plugin-runtime-service';
import type { ServerEvent } from '../../renderer/types';

/**
 * Shared dependencies injected into all IPC handler modules.
 * Uses getter functions so handlers always access the latest instance
 * (managers may be null before app.whenReady completes).
 */
export interface HandlerDependencies {
  getMainWindow: () => BrowserWindow | null;
  getSessionManager: () => SessionManager | null;
  getSkillsManager: () => SkillsManager | null;
  getPluginRuntimeService: () => PluginRuntimeService | null;
  sendToRenderer: (event: ServerEvent) => void;
  getWorkingDir: () => string | null;
  setWorkingDir: (newDir: string, sessionId?: string) => Promise<{ success: boolean; path: string; error?: string }>;
}
