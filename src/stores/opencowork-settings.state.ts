export interface OpencoworkSettingsState {
  defaultWorkspace: string | null;
}

const DEFAULT_WORKSPACE_PATH = '~/Documents/NewProject';
const STORAGE_KEY = 'opencowork-settings';

export const defaultSettings: OpencoworkSettingsState = {
  defaultWorkspace: null,
};

export function loadSettings(): OpencoworkSettingsState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore storage errors
  }
  return defaultSettings;
}

export function saveSettings(settings: OpencoworkSettingsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

export function getDefaultWorkspacePath(settings: OpencoworkSettingsState): string {
  return settings.defaultWorkspace ?? DEFAULT_WORKSPACE_PATH;
}