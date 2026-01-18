import { contextBridge, ipcRenderer } from 'electron';
import type { ClientEvent, ServerEvent, AppConfig, ProviderPresets } from '../renderer/types';

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

  // Config methods
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config.get'),
    getPresets: (): Promise<ProviderPresets> => ipcRenderer.invoke('config.getPresets'),
    save: (config: Partial<AppConfig>): Promise<{ success: boolean; config: AppConfig }> => 
      ipcRenderer.invoke('config.save', config),
    isConfigured: (): Promise<boolean> => ipcRenderer.invoke('config.isConfigured'),
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
      config: {
        get: () => Promise<AppConfig>;
        getPresets: () => Promise<ProviderPresets>;
        save: (config: Partial<AppConfig>) => Promise<{ success: boolean; config: AppConfig }>;
        isConfigured: () => Promise<boolean>;
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
    };
  }
}
