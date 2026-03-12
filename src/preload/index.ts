import { contextBridge, ipcRenderer } from 'electron';
import type {
  ClientEvent,
  ServerEvent,
  AppConfig,
  CreateSetPayload,
  ProviderPresets,
  Skill,
  ApiTestInput,
  ApiTestResult,
  PluginCatalogItem,
  PluginCatalogItemV2,
  InstalledPlugin,
  PluginInstallResult,
  PluginInstallResultV2,
  PluginToggleResult,
  PluginComponentKind,
  ScheduleTask,
  ScheduleCreateInput,
  ScheduleUpdateInput,
  ProviderModelInfo,
} from '../renderer/types';

// Track registered callbacks to prevent duplicate listeners
let registeredCallback: ((event: ServerEvent) => void) | null = null;
let ipcListener: ((event: Electron.IpcRendererEvent, data: ServerEvent) => void) | null = null;

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Send events to main process
  send: (event: ClientEvent) => {
    console.log('[Preload] Sending event:', event.type);
    ipcRenderer.send('client-event', event);
  },

  // Receive events from main process - ensures only ONE listener
  on: (callback: (event: ServerEvent) => void) => {
    // Remove previous listener if exists
    if (ipcListener) {
      console.log('[Preload] Removing previous listener');
      ipcRenderer.removeListener('server-event', ipcListener);
    }
    
    registeredCallback = callback;
    ipcListener = (_: Electron.IpcRendererEvent, data: ServerEvent) => {
      console.log('[Preload] Received event:', data.type);
      if (registeredCallback) {
        registeredCallback(data);
      }
    };
    
    console.log('[Preload] Registering new listener');
    ipcRenderer.on('server-event', ipcListener);
    
    // Return cleanup function
    return () => {
      console.log('[Preload] Cleanup called');
      if (ipcListener) {
        ipcRenderer.removeListener('server-event', ipcListener);
        ipcListener = null;
        registeredCallback = null;
      }
    };
  },

  // Invoke and wait for response
  invoke: async <T>(event: ClientEvent): Promise<T> => {
    console.log('[Preload] Invoking:', event.type);
    return ipcRenderer.invoke('client-invoke', event);
  },

  // Platform info
  platform: process.platform,

  // App info
  getVersion: () => ipcRenderer.invoke('get-version'),

  // Open links in default browser
  openExternal: (url: string) => ipcRenderer.invoke('shell.openExternal', url),
  showItemInFolder: (filePath: string, cwd?: string) => ipcRenderer.invoke('shell.showItemInFolder', filePath, cwd),

  // Select files using native dialog
  selectFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog.selectFiles'),

  artifacts: {
    listRecentFiles: (
      cwd: string,
      sinceMs: number,
      limit = 50
    ): Promise<Array<{ path: string; modifiedAt: number; size: number }>> =>
      ipcRenderer.invoke('artifacts.listRecentFiles', cwd, sinceMs, limit),
  },

  // Config methods
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config.get'),
    getPresets: (): Promise<ProviderPresets> => ipcRenderer.invoke('config.getPresets'),
    save: (config: Partial<AppConfig>): Promise<{ success: boolean; config: AppConfig }> => 
      ipcRenderer.invoke('config.save', config),
    createSet: (payload: CreateSetPayload): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.createSet', payload),
    renameSet: (payload: { id: string; name: string }): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.renameSet', payload),
    deleteSet: (payload: { id: string }): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.deleteSet', payload),
    switchSet: (payload: { id: string }): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.switchSet', payload),
    isConfigured: (): Promise<boolean> => ipcRenderer.invoke('config.isConfigured'),
    test: (config: ApiTestInput): Promise<ApiTestResult> =>
      ipcRenderer.invoke('config.test', config),
    listModels: (payload: { provider: AppConfig['provider']; apiKey: string; baseUrl?: string }): Promise<ProviderModelInfo[]> =>
      ipcRenderer.invoke('config.listModels', payload),
  },

  auth: {
    getStatus: (): Promise<Array<Record<string, unknown>>> => ipcRenderer.invoke('auth.getStatus'),
    importToken: (provider: string): Promise<Record<string, unknown> | null> => ipcRenderer.invoke('auth.importToken', provider),
  },

  // Window control methods
  window: {
    minimize: () => ipcRenderer.send('window.minimize'),
    maximize: () => ipcRenderer.send('window.maximize'),
    close: () => ipcRenderer.send('window.close'),
  },

  // MCP methods
  mcp: {
    getServers: (): Promise<any[]> => ipcRenderer.invoke('mcp.getServers'),
    getServer: (serverId: string): Promise<any> => ipcRenderer.invoke('mcp.getServer', serverId),
    saveServer: (config: any): Promise<{ success: boolean }> => 
      ipcRenderer.invoke('mcp.saveServer', config),
    deleteServer: (serverId: string): Promise<{ success: boolean }> => 
      ipcRenderer.invoke('mcp.deleteServer', serverId),
    getTools: (): Promise<any[]> => ipcRenderer.invoke('mcp.getTools'),
    getServerStatus: (): Promise<any[]> => ipcRenderer.invoke('mcp.getServerStatus'),
    getPresets: (): Promise<Record<string, any>> => ipcRenderer.invoke('mcp.getPresets'),
  },

  // Credentials methods
  credentials: {
    getAll: (): Promise<any[]> => ipcRenderer.invoke('credentials.getAll'),
    getById: (id: string): Promise<any> => ipcRenderer.invoke('credentials.getById', id),
    getByType: (type: string): Promise<any[]> => ipcRenderer.invoke('credentials.getByType', type),
    getByService: (service: string): Promise<any[]> => ipcRenderer.invoke('credentials.getByService', service),
    save: (credential: any): Promise<any> => ipcRenderer.invoke('credentials.save', credential),
    update: (id: string, updates: any): Promise<any> => ipcRenderer.invoke('credentials.update', id, updates),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('credentials.delete', id),
  },

  // Skills methods
  skills: {
    getAll: (): Promise<Skill[]> => ipcRenderer.invoke('skills.getAll'),
    install: (skillPath: string): Promise<{ success: boolean; skill: Skill }> =>
      ipcRenderer.invoke('skills.install', skillPath),
    delete: (skillId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('skills.delete', skillId),
    setEnabled: (skillId: string, enabled: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('skills.setEnabled', skillId, enabled),
    validate: (skillPath: string): Promise<{ valid: boolean; errors: string[] }> =>
      ipcRenderer.invoke('skills.validate', skillPath),
    getStoragePath: (): Promise<string> =>
      ipcRenderer.invoke('skills.getStoragePath'),
    setStoragePath: (
      targetPath: string,
      migrate = true
    ): Promise<{ success: boolean; path: string; migratedCount: number; skippedCount: number; error?: string }> =>
      ipcRenderer.invoke('skills.setStoragePath', targetPath, migrate),
    openStoragePath: (): Promise<{ success: boolean; path: string; error?: string }> =>
      ipcRenderer.invoke('skills.openStoragePath'),
    listPlugins: (installableOnly = false): Promise<PluginCatalogItem[]> =>
      ipcRenderer.invoke('skills.listPlugins', installableOnly),
    installPlugin: (pluginName: string): Promise<PluginInstallResult> =>
      ipcRenderer.invoke('skills.installPlugin', pluginName),
  },

  plugins: {
    listCatalog: (options?: { installableOnly?: boolean }): Promise<PluginCatalogItemV2[]> =>
      ipcRenderer.invoke('plugins.listCatalog', options),
    listInstalled: (): Promise<InstalledPlugin[]> =>
      ipcRenderer.invoke('plugins.listInstalled'),
    install: (pluginName: string): Promise<PluginInstallResultV2> =>
      ipcRenderer.invoke('plugins.install', pluginName),
    setEnabled: (pluginId: string, enabled: boolean): Promise<PluginToggleResult> =>
      ipcRenderer.invoke('plugins.setEnabled', pluginId, enabled),
    setComponentEnabled: (
      pluginId: string,
      component: PluginComponentKind,
      enabled: boolean
    ): Promise<PluginToggleResult> => ipcRenderer.invoke('plugins.setComponentEnabled', pluginId, component, enabled),
    uninstall: (pluginId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('plugins.uninstall', pluginId),
  },

  // Sandbox methods
  sandbox: {
    getStatus: (): Promise<{
      platform: string;
      mode: string;
      initialized: boolean;
      wsl?: { 
        available: boolean; 
        distro?: string; 
        nodeAvailable?: boolean; 
        version?: string;
        pythonAvailable?: boolean;
        pythonVersion?: string;
        pipAvailable?: boolean;
        claudeCodeAvailable?: boolean;
      };
      lima?: {
        available: boolean;
        instanceExists?: boolean;
        instanceRunning?: boolean;
        instanceName?: string;
        nodeAvailable?: boolean;
        version?: string;
        pythonAvailable?: boolean;
        pythonVersion?: string;
        pipAvailable?: boolean;
        claudeCodeAvailable?: boolean;
      };
      error?: string;
    }> => ipcRenderer.invoke('sandbox.getStatus'),
    checkWSL: (): Promise<{
      available: boolean;
      distro?: string;
      nodeAvailable?: boolean;
      version?: string;
      pythonAvailable?: boolean;
      pythonVersion?: string;
      pipAvailable?: boolean;
      claudeCodeAvailable?: boolean;
    }> => ipcRenderer.invoke('sandbox.checkWSL'),
    checkLima: (): Promise<{
      available: boolean;
      instanceExists?: boolean;
      instanceRunning?: boolean;
      instanceName?: string;
      nodeAvailable?: boolean;
      version?: string;
      pythonAvailable?: boolean;
      pythonVersion?: string;
      pipAvailable?: boolean;
      claudeCodeAvailable?: boolean;
    }> => ipcRenderer.invoke('sandbox.checkLima'),
    installNodeInWSL: (distro: string): Promise<boolean> => 
      ipcRenderer.invoke('sandbox.installNodeInWSL', distro),
    installPythonInWSL: (distro: string): Promise<boolean> => 
      ipcRenderer.invoke('sandbox.installPythonInWSL', distro),
    installClaudeCodeInWSL: (distro: string): Promise<boolean> => 
      ipcRenderer.invoke('sandbox.installClaudeCodeInWSL', distro),
    installNodeInLima: (): Promise<boolean> => 
      ipcRenderer.invoke('sandbox.installNodeInLima'),
    installPythonInLima: (): Promise<boolean> => 
      ipcRenderer.invoke('sandbox.installPythonInLima'),
    installClaudeCodeInLima: (): Promise<boolean> => 
      ipcRenderer.invoke('sandbox.installClaudeCodeInLima'),
    startLimaInstance: (): Promise<boolean> =>
      ipcRenderer.invoke('sandbox.startLimaInstance'),
    stopLimaInstance: (): Promise<boolean> =>
      ipcRenderer.invoke('sandbox.stopLimaInstance'),
    retrySetup: (): Promise<{ success: boolean; error?: string; result?: unknown }> =>
      ipcRenderer.invoke('sandbox.retrySetup'),
    retryLimaSetup: (): Promise<{ success: boolean; error?: string; result?: unknown }> =>
      ipcRenderer.invoke('sandbox.retryLimaSetup'),
  },

  // Logs methods
  logs: {
    getPath: (): Promise<string | null> => ipcRenderer.invoke('logs.getPath'),
    getDirectory: (): Promise<string> => ipcRenderer.invoke('logs.getDirectory'),
    getAll: (): Promise<Array<{ name: string; path: string; size: number; mtime: Date }>> => 
      ipcRenderer.invoke('logs.getAll'),
    export: (): Promise<{ success: boolean; path?: string; size?: number; error?: string }> => 
      ipcRenderer.invoke('logs.export'),
    open: (): Promise<{ success: boolean; error?: string }> => 
      ipcRenderer.invoke('logs.open'),
    clear: (): Promise<{ success: boolean; deletedCount?: number; error?: string }> => 
      ipcRenderer.invoke('logs.clear'),
    setEnabled: (enabled: boolean): Promise<{ success: boolean; enabled?: boolean; error?: string }> =>
      ipcRenderer.invoke('logs.setEnabled', enabled),
    isEnabled: (): Promise<{ success: boolean; enabled?: boolean; error?: string }> =>
      ipcRenderer.invoke('logs.isEnabled'),
    write: (level: 'info' | 'warn' | 'error', ...args: any[]): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('logs.write', level, args),
  },

  // Remote control methods
  remote: {
    getConfig: (): Promise<any> => ipcRenderer.invoke('remote.getConfig'),
    getStatus: (): Promise<{
      running: boolean;
      port?: number;
      publicUrl?: string;
      channels: Array<{ type: string; connected: boolean; error?: string }>;
      activeSessions: number;
      pendingPairings: number;
    }> => ipcRenderer.invoke('remote.getStatus'),
    setEnabled: (enabled: boolean): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.setEnabled', enabled),
    updateGatewayConfig: (config: any): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.updateGatewayConfig', config),
    updateFeishuConfig: (config: any): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.updateFeishuConfig', config),
    getPairedUsers: (): Promise<any[]> => ipcRenderer.invoke('remote.getPairedUsers'),
    getPendingPairings: (): Promise<any[]> => ipcRenderer.invoke('remote.getPendingPairings'),
    approvePairing: (channelType: string, userId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.approvePairing', channelType, userId),
    revokePairing: (channelType: string, userId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.revokePairing', channelType, userId),
    getRemoteSessions: (): Promise<any[]> => ipcRenderer.invoke('remote.getRemoteSessions'),
    clearRemoteSession: (sessionId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.clearRemoteSession', sessionId),
    getTunnelStatus: (): Promise<{
      connected: boolean;
      url: string | null;
      provider: string;
      error?: string;
    }> => ipcRenderer.invoke('remote.getTunnelStatus'),
    getWebhookUrl: (): Promise<string | null> => ipcRenderer.invoke('remote.getWebhookUrl'),
    restart: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.restart'),
  },

  schedule: {
    list: (): Promise<ScheduleTask[]> => ipcRenderer.invoke('schedule.list'),
    create: (payload: ScheduleCreateInput): Promise<ScheduleTask> =>
      ipcRenderer.invoke('schedule.create', payload),
    update: (id: string, updates: ScheduleUpdateInput): Promise<ScheduleTask | null> =>
      ipcRenderer.invoke('schedule.update', id, updates),
    delete: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('schedule.delete', id),
    toggle: (id: string, enabled: boolean): Promise<ScheduleTask | null> =>
      ipcRenderer.invoke('schedule.toggle', id, enabled),
    runNow: (id: string): Promise<ScheduleTask | null> =>
      ipcRenderer.invoke('schedule.runNow', id),
  },
});

// Type declaration for the renderer process
declare global {
  interface Window {
    electronAPI: {
      send: (event: ClientEvent) => void;
      on: (callback: (event: ServerEvent) => void) => () => void;
      invoke: <T>(event: ClientEvent) => Promise<T>;
      platform: NodeJS.Platform;
      getVersion: () => Promise<string>;
      openExternal: (url: string) => Promise<boolean>;
      showItemInFolder: (filePath: string, cwd?: string) => Promise<boolean>;
      selectFiles: () => Promise<string[]>;
      artifacts: {
        listRecentFiles: (
          cwd: string,
          sinceMs: number,
          limit?: number
        ) => Promise<Array<{ path: string; modifiedAt: number; size: number }>>;
      };
      config: {
        get: () => Promise<AppConfig>;
        getPresets: () => Promise<ProviderPresets>;
        save: (config: Partial<AppConfig>) => Promise<{ success: boolean; config: AppConfig }>;
        createSet: (payload: CreateSetPayload) => Promise<{ success: boolean; config: AppConfig }>;
        renameSet: (payload: { id: string; name: string }) => Promise<{ success: boolean; config: AppConfig }>;
        deleteSet: (payload: { id: string }) => Promise<{ success: boolean; config: AppConfig }>;
        switchSet: (payload: { id: string }) => Promise<{ success: boolean; config: AppConfig }>;
        isConfigured: () => Promise<boolean>;
        test: (config: ApiTestInput) => Promise<ApiTestResult>;
        listModels: (payload: { provider: AppConfig['provider']; apiKey: string; baseUrl?: string }) => Promise<ProviderModelInfo[]>;
      };
      auth: {
        getStatus: () => Promise<Array<Record<string, unknown>>>;
        importToken: (provider: string) => Promise<Record<string, unknown> | null>;
      };
      window: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
      };
      mcp: {
        getServers: () => Promise<any[]>;
        getServer: (serverId: string) => Promise<any>;
        saveServer: (config: any) => Promise<{ success: boolean }>;
        deleteServer: (serverId: string) => Promise<{ success: boolean }>;
        getTools: () => Promise<any[]>;
        getServerStatus: () => Promise<any[]>;
        getPresets: () => Promise<Record<string, any>>;
      };
      credentials: {
        getAll: () => Promise<any[]>;
        getById: (id: string) => Promise<any>;
        getByType: (type: string) => Promise<any[]>;
        getByService: (service: string) => Promise<any[]>;
        save: (credential: any) => Promise<any>;
        update: (id: string, updates: any) => Promise<any>;
        delete: (id: string) => Promise<boolean>;
      };
      skills: {
        getAll: () => Promise<Skill[]>;
        install: (skillPath: string) => Promise<{ success: boolean; skill: Skill }>;
        delete: (skillId: string) => Promise<{ success: boolean }>;
        setEnabled: (skillId: string, enabled: boolean) => Promise<{ success: boolean }>;
        validate: (skillPath: string) => Promise<{ valid: boolean; errors: string[] }>;
        getStoragePath: () => Promise<string>;
        setStoragePath: (
          targetPath: string,
          migrate?: boolean
        ) => Promise<{ success: boolean; path: string; migratedCount: number; skippedCount: number; error?: string }>;
        openStoragePath: () => Promise<{ success: boolean; path: string; error?: string }>;
        listPlugins: (installableOnly?: boolean) => Promise<PluginCatalogItem[]>;
        installPlugin: (pluginName: string) => Promise<PluginInstallResult>;
      };
      plugins: {
        listCatalog: (options?: { installableOnly?: boolean }) => Promise<PluginCatalogItemV2[]>;
        listInstalled: () => Promise<InstalledPlugin[]>;
        install: (pluginName: string) => Promise<PluginInstallResultV2>;
        setEnabled: (pluginId: string, enabled: boolean) => Promise<PluginToggleResult>;
        setComponentEnabled: (
          pluginId: string,
          component: PluginComponentKind,
          enabled: boolean
        ) => Promise<PluginToggleResult>;
        uninstall: (pluginId: string) => Promise<{ success: boolean }>;
      };
      sandbox: {
        getStatus: () => Promise<{
          platform: string;
          mode: string;
          initialized: boolean;
          wsl?: { 
            available: boolean; 
            distro?: string; 
            nodeAvailable?: boolean; 
            version?: string;
            pythonAvailable?: boolean;
            pythonVersion?: string;
            pipAvailable?: boolean;
            claudeCodeAvailable?: boolean;
          };
          lima?: {
            available: boolean;
            instanceExists?: boolean;
            instanceRunning?: boolean;
            instanceName?: string;
            nodeAvailable?: boolean;
            version?: string;
            pythonAvailable?: boolean;
            pythonVersion?: string;
            pipAvailable?: boolean;
            claudeCodeAvailable?: boolean;
          };
          error?: string;
        }>;
        checkWSL: () => Promise<{
          available: boolean;
          distro?: string;
          nodeAvailable?: boolean;
          version?: string;
          pythonAvailable?: boolean;
          pythonVersion?: string;
          pipAvailable?: boolean;
          claudeCodeAvailable?: boolean;
        }>;
        checkLima: () => Promise<{
          available: boolean;
          instanceExists?: boolean;
          instanceRunning?: boolean;
          instanceName?: string;
          nodeAvailable?: boolean;
          version?: string;
          pythonAvailable?: boolean;
          pythonVersion?: string;
          pipAvailable?: boolean;
          claudeCodeAvailable?: boolean;
        }>;
        installNodeInWSL: (distro: string) => Promise<boolean>;
        installPythonInWSL: (distro: string) => Promise<boolean>;
        installClaudeCodeInWSL: (distro: string) => Promise<boolean>;
        installNodeInLima: () => Promise<boolean>;
        installPythonInLima: () => Promise<boolean>;
        installClaudeCodeInLima: () => Promise<boolean>;
        startLimaInstance: () => Promise<boolean>;
        stopLimaInstance: () => Promise<boolean>;
        retrySetup: () => Promise<{ success: boolean; error?: string; result?: unknown }>;
        retryLimaSetup: () => Promise<{ success: boolean; error?: string; result?: unknown }>;
      };
      logs: {
        getPath: () => Promise<string | null>;
        getDirectory: () => Promise<string>;
        getAll: () => Promise<Array<{ name: string; path: string; size: number; mtime: Date }>>;
        export: () => Promise<{ success: boolean; path?: string; size?: number; error?: string }>;
        open: () => Promise<{ success: boolean; error?: string }>;
        clear: () => Promise<{ success: boolean; deletedCount?: number; error?: string }>;
        setEnabled: (enabled: boolean) => Promise<{ success: boolean; enabled?: boolean; error?: string }>;
        isEnabled: () => Promise<{ success: boolean; enabled?: boolean; error?: string }>;
        write: (level: 'info' | 'warn' | 'error', ...args: any[]) => Promise<{ success: boolean; error?: string }>;
      };
      remote: {
        getConfig: () => Promise<any>;
        getStatus: () => Promise<{
          running: boolean;
          port?: number;
          publicUrl?: string;
          channels: Array<{ type: string; connected: boolean; error?: string }>;
          activeSessions: number;
          pendingPairings: number;
        }>;
        setEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
        updateGatewayConfig: (config: any) => Promise<{ success: boolean; error?: string }>;
        updateFeishuConfig: (config: any) => Promise<{ success: boolean; error?: string }>;
        getPairedUsers: () => Promise<any[]>;
        getPendingPairings: () => Promise<any[]>;
        approvePairing: (channelType: string, userId: string) => Promise<{ success: boolean; error?: string }>;
        revokePairing: (channelType: string, userId: string) => Promise<{ success: boolean; error?: string }>;
        getRemoteSessions: () => Promise<any[]>;
        clearRemoteSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
        getTunnelStatus: () => Promise<{
          connected: boolean;
          url: string | null;
          provider: string;
          error?: string;
        }>;
        getWebhookUrl: () => Promise<string | null>;
        restart: () => Promise<{ success: boolean; error?: string }>;
      };
      schedule: {
        list: () => Promise<ScheduleTask[]>;
        create: (payload: ScheduleCreateInput) => Promise<ScheduleTask>;
        update: (id: string, updates: ScheduleUpdateInput) => Promise<ScheduleTask | null>;
        delete: (id: string) => Promise<{ success: boolean }>;
        toggle: (id: string, enabled: boolean) => Promise<ScheduleTask | null>;
        runNow: (id: string) => Promise<ScheduleTask | null>;
      };
    };
  }
}
