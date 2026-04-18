export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  language: string;
  defaultWorkspace: string | null;
  notificationsEnabled: boolean;
  autoUpdate: boolean;
}

export type SettingsKey = keyof AppSettings;
