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
  PluginCatalogItemV2,
  InstalledPlugin,
  PluginInstallResultV2,
  PluginToggleResult,
  PluginComponentKind,
  ScheduleTask,
  ScheduleCreateInput,
  ScheduleUpdateInput,
  ProviderModelInfo,
  LocalOllamaDiscoveryResult,
  MemoryOverview,
  MemorySearchResult,
  MemoryReadResult,
  MemorySearchScope,
  MemoryDebugFileInfo,
  MemoryDebugFileContent,
  MemoryInspectSessionResult,
} from '../renderer/types';
import type { DiagnosticInput, DiagnosticResult } from '../renderer/types';
import type {
  McpServerConfig,
  McpTool,
  McpServerStatus,
  McpPresetsMap,
  RemoteConfig,
  GatewayConfig,
  FeishuChannelConfig,
  PairedUser,
  PairingRequest,
  RemoteSessionMapping,
} from '../shared/ipc-types';

// Track registered callbacks to prevent duplicate listeners
let registeredCallback: ((event: ServerEvent) => void) | null = null;
let ipcListener: ((event: Electron.IpcRendererEvent, data: ServerEvent) => void) | null = null;

// Allowlist of valid ClientEvent types to prevent spoofing arbitrary IPC channels
const ALLOWED_CLIENT_EVENTS: ReadonlySet<string> = new Set<ClientEvent['type']>([
  'session.start',
  'session.continue',
  'session.stop',
  'session.delete',
  'session.batchDelete',
  'session.list',
  'session.getMessages',
  'session.getTraceSteps',
  'permission.response',
  'sudo.password.response',
  'settings.update',
  'folder.select',
  'workdir.get',
  'workdir.set',
  'workdir.select',
]);

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Send events to main process
  send: (event: ClientEvent) => {
    if (!ALLOWED_CLIENT_EVENTS.has(event.type)) {
      console.warn('[Preload] Blocked unauthorized event type:', event.type);
      return;
    }
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
    if (!ALLOWED_CLIENT_EVENTS.has(event.type)) {
      console.warn('[Preload] Blocked unauthorized invoke type:', event.type);
      throw new Error(`Unauthorized event type: ${event.type}`);
    }
    console.log('[Preload] Invoking:', event.type);
    return ipcRenderer.invoke('client-invoke', event);
  },

  // Platform info
  platform: process.platform,

  // System theme
  getSystemTheme: () => ipcRenderer.invoke('system.getTheme'),

  // App info
  getVersion: () => ipcRenderer.invoke('get-version'),

  // Open links in default browser
  openExternal: (url: string) => {
    // Sanitize mailto: URLs to strip dangerous query params that could attach files
    let safeUrl = url;
    if (/^mailto:/i.test(url)) {
      try {
        const parsed = new URL(url);
        parsed.searchParams.delete('attach');
        parsed.searchParams.delete('attachment');
        safeUrl = parsed.toString();
      } catch {
        // If URL parsing fails, block the call
        return Promise.resolve(false);
      }
    }
    return ipcRenderer.invoke('shell.openExternal', safeUrl);
  },
  showItemInFolder: (filePath: string, cwd?: string) =>
    ipcRenderer.invoke('shell.showItemInFolder', filePath, cwd),

  // Select files using native dialog
  selectFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog.selectFiles'),

  artifacts: {
    listRecentFiles: (
      cwd: string,
      sinceMs: number,
      limit = 50
    ): Promise<Array<{ path: string; modifiedAt: number; size: number }>> =>
      ipcRenderer.invoke('artifacts.listRecentFiles', cwd, sinceMs, Math.min(limit, 500)),
  },

  // Config methods
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config.get'),
    getPresets: (): Promise<ProviderPresets> => ipcRenderer.invoke('config.getPresets'),
    save: (config: Partial<AppConfig>): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.save', config),
    createSet: (payload: CreateSetPayload): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.createSet', payload),
    renameSet: (payload: {
      id: string;
      name: string;
    }): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.renameSet', payload),
    deleteSet: (payload: { id: string }): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.deleteSet', payload),
    switchSet: (payload: { id: string }): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.switchSet', payload),
    isConfigured: (): Promise<boolean> => ipcRenderer.invoke('config.isConfigured'),
    test: (config: ApiTestInput): Promise<ApiTestResult> =>
      ipcRenderer.invoke('config.test', config),
    listModels: (payload: {
      provider: AppConfig['provider'];
      apiKey: string;
      baseUrl?: string;
    }): Promise<ProviderModelInfo[]> => ipcRenderer.invoke('config.listModels', payload),
    diagnose: (input: DiagnosticInput): Promise<DiagnosticResult> =>
      ipcRenderer.invoke('config.diagnose', input),
    discoverLocal: (payload?: { baseUrl?: string }): Promise<LocalOllamaDiscoveryResult> =>
      ipcRenderer.invoke('config.discover-local', payload),
  },

  // Window control methods
  window: {
    minimize: () => ipcRenderer.send('window.minimize'),
    maximize: () => ipcRenderer.send('window.maximize'),
    close: () => ipcRenderer.send('window.close'),
  },

  // MCP methods
  mcp: {
    getServers: (): Promise<McpServerConfig[]> => ipcRenderer.invoke('mcp.getServers'),
    getServer: (serverId: string): Promise<McpServerConfig | undefined> =>
      ipcRenderer.invoke('mcp.getServer', serverId),
    saveServer: (config: McpServerConfig): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('mcp.saveServer', config),
    deleteServer: (serverId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('mcp.deleteServer', serverId),
    getTools: (): Promise<McpTool[]> => ipcRenderer.invoke('mcp.getTools'),
    getServerStatus: (): Promise<McpServerStatus[]> => ipcRenderer.invoke('mcp.getServerStatus'),
    getPresets: (): Promise<McpPresetsMap> => ipcRenderer.invoke('mcp.getPresets'),
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
    getStoragePath: (): Promise<string> => ipcRenderer.invoke('skills.getStoragePath'),
    setStoragePath: (
      targetPath: string,
      migrate = true
    ): Promise<{
      success: boolean;
      path: string;
      migratedCount: number;
      skippedCount: number;
      error?: string;
    }> => ipcRenderer.invoke('skills.setStoragePath', targetPath, migrate),
    openStoragePath: (): Promise<{ success: boolean; path: string; error?: string }> =>
      ipcRenderer.invoke('skills.openStoragePath'),
  },

  plugins: {
    listCatalog: (options?: { installableOnly?: boolean }): Promise<PluginCatalogItemV2[]> =>
      ipcRenderer.invoke('plugins.listCatalog', options),
    listInstalled: (): Promise<InstalledPlugin[]> => ipcRenderer.invoke('plugins.listInstalled'),
    install: (pluginName: string): Promise<PluginInstallResultV2> =>
      ipcRenderer.invoke('plugins.install', pluginName),
    setEnabled: (pluginId: string, enabled: boolean): Promise<PluginToggleResult> =>
      ipcRenderer.invoke('plugins.setEnabled', pluginId, enabled),
    setComponentEnabled: (
      pluginId: string,
      component: PluginComponentKind,
      enabled: boolean
    ): Promise<PluginToggleResult> =>
      ipcRenderer.invoke('plugins.setComponentEnabled', pluginId, component, enabled),
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
    installNodeInLima: (): Promise<boolean> => ipcRenderer.invoke('sandbox.installNodeInLima'),
    installPythonInLima: (): Promise<boolean> => ipcRenderer.invoke('sandbox.installPythonInLima'),
    startLimaInstance: (): Promise<boolean> => ipcRenderer.invoke('sandbox.startLimaInstance'),
    stopLimaInstance: (): Promise<boolean> => ipcRenderer.invoke('sandbox.stopLimaInstance'),
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
    open: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('logs.open'),
    clear: (): Promise<{ success: boolean; deletedCount?: number; error?: string }> =>
      ipcRenderer.invoke('logs.clear'),
    setEnabled: (
      enabled: boolean
    ): Promise<{ success: boolean; enabled?: boolean; error?: string }> =>
      ipcRenderer.invoke('logs.setEnabled', enabled),
    isEnabled: (): Promise<{ success: boolean; enabled?: boolean; error?: string }> =>
      ipcRenderer.invoke('logs.isEnabled'),
    write: (
      level: 'info' | 'warn' | 'error',
      ...args: unknown[]
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('logs.write', level, ...args),
  },

  // Remote control methods
  remote: {
    getConfig: (): Promise<RemoteConfig> => ipcRenderer.invoke('remote.getConfig'),
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
    updateGatewayConfig: (
      config: Partial<GatewayConfig>
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.updateGatewayConfig', config),
    updateFeishuConfig: (
      config: FeishuChannelConfig
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.updateFeishuConfig', config),
    getPairedUsers: (): Promise<PairedUser[]> => ipcRenderer.invoke('remote.getPairedUsers'),
    getPendingPairings: (): Promise<PairingRequest[]> =>
      ipcRenderer.invoke('remote.getPendingPairings'),
    approvePairing: (
      channelType: string,
      userId: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.approvePairing', channelType, userId),
    revokePairing: (
      channelType: string,
      userId: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.revokePairing', channelType, userId),
    rejectPairing: (
      channelType: string,
      userId: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.rejectPairing', channelType, userId),
    getRemoteSessions: (): Promise<RemoteSessionMapping[]> =>
      ipcRenderer.invoke('remote.getRemoteSessions'),
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
    runNow: (id: string): Promise<ScheduleTask | null> => ipcRenderer.invoke('schedule.runNow', id),
  },

  memory: {
    getOverview: (cwd?: string): Promise<MemoryOverview> =>
      ipcRenderer.invoke('memory.getOverview', cwd),
    search: (payload: {
      query: string;
      cwd?: string;
      sourceWorkspace?: string | null;
      scope?: MemorySearchScope;
      limit?: number;
    }): Promise<MemorySearchResult[]> => ipcRenderer.invoke('memory.search', payload),
    read: (id: string): Promise<MemoryReadResult | null> => ipcRenderer.invoke('memory.read', id),
    rebuildWorkspace: (cwd: string): Promise<{ success: boolean; workspaceKey: string }> =>
      ipcRenderer.invoke('memory.rebuildWorkspace', cwd),
    clearWorkspace: (cwd: string): Promise<{ success: boolean; workspaceKey: string }> =>
      ipcRenderer.invoke('memory.clearWorkspace', cwd),
    clearCoreMemory: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('memory.clearCoreMemory'),
    rebuildAll: (): Promise<{ success: boolean; workspaceCount: number; sessionCount: number }> =>
      ipcRenderer.invoke('memory.rebuildAll'),
    listFiles: (): Promise<MemoryDebugFileInfo[]> => ipcRenderer.invoke('memory.listFiles'),
    readFile: (filePath: string): Promise<MemoryDebugFileContent> =>
      ipcRenderer.invoke('memory.readFile', filePath),
    inspectSession: (
      sessionId: string,
      workspaceKey?: string
    ): Promise<MemoryInspectSessionResult | null> =>
      ipcRenderer.invoke('memory.inspectSession', sessionId, workspaceKey),
    setEnabled: (enabled: boolean): Promise<{ success: boolean; enabled: boolean }> =>
      ipcRenderer.invoke('memory.setEnabled', enabled),
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
      getSystemTheme: () => Promise<{ shouldUseDarkColors: boolean }>;
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
        renameSet: (payload: {
          id: string;
          name: string;
        }) => Promise<{ success: boolean; config: AppConfig }>;
        deleteSet: (payload: { id: string }) => Promise<{ success: boolean; config: AppConfig }>;
        switchSet: (payload: { id: string }) => Promise<{ success: boolean; config: AppConfig }>;
        isConfigured: () => Promise<boolean>;
        test: (config: ApiTestInput) => Promise<ApiTestResult>;
        listModels: (payload: {
          provider: AppConfig['provider'];
          apiKey: string;
          baseUrl?: string;
        }) => Promise<ProviderModelInfo[]>;
        diagnose: (input: DiagnosticInput) => Promise<DiagnosticResult>;
        discoverLocal: (payload?: { baseUrl?: string }) => Promise<LocalOllamaDiscoveryResult>;
      };
      window: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
      };
      mcp: {
        getServers: () => Promise<McpServerConfig[]>;
        getServer: (serverId: string) => Promise<McpServerConfig | undefined>;
        saveServer: (config: McpServerConfig) => Promise<{ success: boolean; error?: string }>;
        deleteServer: (serverId: string) => Promise<{ success: boolean }>;
        getTools: () => Promise<McpTool[]>;
        getServerStatus: () => Promise<McpServerStatus[]>;
        getPresets: () => Promise<McpPresetsMap>;
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
        ) => Promise<{
          success: boolean;
          path: string;
          migratedCount: number;
          skippedCount: number;
          error?: string;
        }>;
        openStoragePath: () => Promise<{ success: boolean; path: string; error?: string }>;
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
        installNodeInLima: () => Promise<boolean>;
        installPythonInLima: () => Promise<boolean>;
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
        setEnabled: (
          enabled: boolean
        ) => Promise<{ success: boolean; enabled?: boolean; error?: string }>;
        isEnabled: () => Promise<{ success: boolean; enabled?: boolean; error?: string }>;
        write: (
          level: 'info' | 'warn' | 'error',
          ...args: unknown[]
        ) => Promise<{ success: boolean; error?: string }>;
      };
      remote: {
        getConfig: () => Promise<RemoteConfig>;
        getStatus: () => Promise<{
          running: boolean;
          port?: number;
          publicUrl?: string;
          channels: Array<{ type: string; connected: boolean; error?: string }>;
          activeSessions: number;
          pendingPairings: number;
        }>;
        setEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
        updateGatewayConfig: (
          config: Partial<GatewayConfig>
        ) => Promise<{ success: boolean; error?: string }>;
        updateFeishuConfig: (
          config: FeishuChannelConfig
        ) => Promise<{ success: boolean; error?: string }>;
        getPairedUsers: () => Promise<PairedUser[]>;
        getPendingPairings: () => Promise<PairingRequest[]>;
        approvePairing: (
          channelType: string,
          userId: string
        ) => Promise<{ success: boolean; error?: string }>;
        revokePairing: (
          channelType: string,
          userId: string
        ) => Promise<{ success: boolean; error?: string }>;
        rejectPairing: (
          channelType: string,
          userId: string
        ) => Promise<{ success: boolean; error?: string }>;
        getRemoteSessions: () => Promise<RemoteSessionMapping[]>;
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
      memory: {
        getOverview: (cwd?: string) => Promise<MemoryOverview>;
        search: (payload: {
          query: string;
          cwd?: string;
          sourceWorkspace?: string | null;
          scope?: MemorySearchScope;
          limit?: number;
        }) => Promise<MemorySearchResult[]>;
        read: (id: string) => Promise<MemoryReadResult | null>;
        rebuildWorkspace: (cwd: string) => Promise<{ success: boolean; workspaceKey: string }>;
        clearWorkspace: (cwd: string) => Promise<{ success: boolean; workspaceKey: string }>;
        clearCoreMemory: () => Promise<{ success: boolean }>;
        rebuildAll: () => Promise<{
          success: boolean;
          workspaceCount: number;
          sessionCount: number;
        }>;
        listFiles: () => Promise<MemoryDebugFileInfo[]>;
        readFile: (filePath: string) => Promise<MemoryDebugFileContent>;
        inspectSession: (
          sessionId: string,
          workspaceKey?: string
        ) => Promise<MemoryInspectSessionResult | null>;
        setEnabled: (enabled: boolean) => Promise<{ success: boolean; enabled: boolean }>;
      };
    };
  }
}
