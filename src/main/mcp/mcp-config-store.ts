import Store from 'electron-store';
import { app } from 'electron';
import path from 'path';
import type { MCPServerConfig } from './mcp-manager';

/**
 * Preset MCP Server Configurations
 * These are common MCP servers that users can quickly add
 */
export const MCP_SERVER_PRESETS: Record<string, Omit<MCPServerConfig, 'id' | 'enabled'> & { requiresEnv?: string[]; envDescription?: Record<string, string> }> = {
  chrome: {
    name: 'Chrome',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest', '--browser-url', 'http://localhost:9222'],
  },
  notion: {
    name: 'Notion',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    env: {
      NOTION_TOKEN: '',
    },
    requiresEnv: ['NOTION_TOKEN'],
    envDescription: {
      NOTION_TOKEN: 'Notion Internal Integration Token (get from notion.so/profile/integrations)',
    },
  },
  'software-development': {
    name: 'Software_Development',
    type: 'stdio',
    command: 'node',
    args: ['{SOFTWARE_DEV_SERVER_PATH}'], // Path will be resolved at runtime (compiled JS in production)
    env: {
      WORKSPACE_DIR: '',
      TEST_ENV: 'development',
    },
    requiresEnv: [],
    envDescription: {
      WORKSPACE_DIR: 'Workspace directory for code development (optional)',
      TEST_ENV: 'Test environment: development, staging, or production (optional)',
    },
  },
  'gui-operate': {
    name: 'GUI_Operate',
    type: 'stdio',
    command: 'node',
    args: ['{GUI_OPERATE_SERVER_PATH}'], // Path will be resolved at runtime (compiled JS in production)
    env: {},
    requiresEnv: [],
    envDescription: {
      // No environment variables required
    },
  },
};

/**
 * MCP Server Configuration Store
 */
class MCPConfigStore {
  private store: Store<{ servers: MCPServerConfig[] }>;

  constructor() {
    this.store = new Store<{ servers: MCPServerConfig[] }>({
      name: 'mcp-config',
      defaults: {
        servers: [],
      },
    });
  }

  /**
   * Get all MCP server configurations
   */
  getServers(): MCPServerConfig[] {
    return this.store.get('servers', []);
  }

  /**
   * Get a specific server configuration
   */
  getServer(serverId: string): MCPServerConfig | undefined {
    const servers = this.getServers();
    return servers.find((s) => s.id === serverId);
  }

  /**
   * Add or update a server configuration
   */
  saveServer(config: MCPServerConfig): void {
    const servers = this.getServers();
    const index = servers.findIndex((s) => s.id === config.id);
    
    if (index >= 0) {
      servers[index] = config;
    } else {
      servers.push(config);
    }
    
    this.store.set('servers', servers);
  }

  /**
   * Delete a server configuration
   */
  deleteServer(serverId: string): void {
    const servers = this.getServers();
    const filtered = servers.filter((s) => s.id !== serverId);
    this.store.set('servers', filtered);
  }

  /**
   * Update all server configurations
   */
  setServers(servers: MCPServerConfig[]): void {
    this.store.set('servers', servers);
  }

  /**
   * Get enabled servers only
   */
  getEnabledServers(): MCPServerConfig[] {
    return this.getServers().filter((s) => s.enabled);
  }

  /**
   * Get preset configurations
   */
  getPresets(): Record<string, Omit<MCPServerConfig, 'id' | 'enabled'>> {
    return MCP_SERVER_PRESETS;
  }

  /**
   * Get the path to a MCP server file in the mcp directory
   */
  private getMcpServerPath(filename: string): string {
    const fs = require('fs');
    
    // In development: __dirname points to dist-electron/main
    // In production: appPath points to the app.asar or unpacked app
    if (app.isPackaged) {
      // Production: use compiled JavaScript files from extraResources/mcp
      // Convert .ts extension to .js
      const jsFilename = filename.replace(/\.ts$/, '.js');
      const mcpPath = path.join(process.resourcesPath || '', 'mcp', jsFilename);
      
      // Check if compiled JS file exists in resources
      try {
        if (fs.existsSync(mcpPath)) {
          return mcpPath;
        }
      } catch {
        // Fall through to development path
      }
    }
    
    // Development: __dirname is dist-electron/main
    // Need to go up 2 levels to get to project root (dist-electron/main -> dist-electron -> project root)
    const projectRoot = path.join(__dirname, '..', '..');

    // Prefer bundled JS from dist-mcp in development.
    // This avoids attempting to run TypeScript directly with `node`.
    const jsFilename = filename.replace(/\.ts$/, '.js');
    const devBundledPath = path.join(projectRoot, 'dist-mcp', jsFilename);
    try {
      if (fs.existsSync(devBundledPath)) {
        return devBundledPath;
      }
    } catch {
      // Fall through to source path
    }

    // Fallback: navigate to src/main/mcp/[filename]
    const sourcePath = path.join(projectRoot, 'src', 'main', 'mcp', filename);
    
    // Verify file exists and log for debugging
    try {
      if (fs.existsSync(sourcePath)) {
        console.log(`[MCPConfigStore] MCP Server path resolved (${filename}):`, sourcePath);
        return sourcePath;
      } else {
        console.error(`[MCPConfigStore] File not found at:`, sourcePath);
        console.error('[MCPConfigStore] __dirname:', __dirname);
        console.error('[MCPConfigStore] projectRoot:', projectRoot);
      }
    } catch (error) {
      console.error('[MCPConfigStore] Error checking file:', error);
    }
    
    return sourcePath;
  }

  /**
   * Get the path to the Software Development MCP server file
   */
  private getSoftwareDevServerPath(): string {
    return this.getMcpServerPath('software-dev-server-example.ts');
  }

  /**
   * Get the path to the GUI Operate MCP server file
   */
  private getGuiOperateServerPath(): string {
    return this.getMcpServerPath('gui-operate-server.ts');
  }

  /**
   * Create a server config from a preset
   */
  createFromPreset(presetKey: string, enabled: boolean = false): MCPServerConfig | null {
    const preset = MCP_SERVER_PRESETS[presetKey];
    if (!preset) {
      return null;
    }

    // Resolve path placeholders for presets
    let resolvedPreset = { ...preset };
    
    if (preset.args) {
      resolvedPreset = {
        ...preset,
        args: preset.args.map(arg => {
          // Software Development server path
          if (arg === '{SOFTWARE_DEV_SERVER_PATH}') {
            return this.getSoftwareDevServerPath();
          }
          // GUI Operate server path
          if (arg === '{GUI_OPERATE_SERVER_PATH}') {
            return this.getGuiOperateServerPath();
          }
          return arg;
        }),
      };
    }

    return {
      ...resolvedPreset,
      id: `mcp-${presetKey}-${Date.now()}`,
      enabled,
    };
  }
}

// Singleton instance
export const mcpConfigStore = new MCPConfigStore();
