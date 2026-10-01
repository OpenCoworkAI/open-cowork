import Store, { type Options as StoreOptions } from 'electron-store';
import { app } from 'electron';
import * as fs from 'fs';
import * as crypto from 'crypto';
import path from 'path';
import type { MCPServerConfig } from './mcp-manager';
import { log, logError } from '../utils/logger';
import {
  deleteServerFromMcpDocument,
  normalizeMcpConfigDocument,
  normalizeMcpConfigInput,
  normalizeMcpServerEntry,
  replaceRecognizedServersInMcpDocument,
  upsertServerInMcpDocument,
  type McpConfigWriteResult,
} from '../../shared/mcp-config';

/**
 * Preset MCP Server Configurations
 * These are common MCP servers that users can quickly add
 */
export const MCP_SERVER_PRESETS: Record<
  string,
  Omit<MCPServerConfig, 'id' | 'enabled'> & {
    requiresEnv?: string[];
    envDescription?: Record<string, string>;
  }
> = {
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
 *
 * `servers` is optional on purpose. electron-store writes `defaults` into the
 * JSON file when the store is constructed, so a default `servers: []` would
 * rewrite Claude-style documents at startup.
 */
type McpConfigStoreShape = {
  servers?: unknown;
  mcpServers?: unknown;
  mcp_servers?: unknown;
};

class MCPConfigStore {
  private store: Store<McpConfigStoreShape>;

  constructor() {
    const storeOptions: StoreOptions<McpConfigStoreShape> & { projectName?: string } = {
      name: 'mcp-config',
      projectName: 'open-cowork',
    };

    this.store = new Store<McpConfigStoreShape>(storeOptions);
  }

  /**
   * Get all MCP server configurations.
   *
   * Agent-installed or Claude-style documents are normalized in memory so
   * callers never receive a non-array. This method does not write. Unknown
   * entries and the original document shape stay in the file.
   */
  getServers(): MCPServerConfig[] {
    try {
      const document = this.readStoreDocument();
      const normalized = normalizeMcpConfigDocument(document);
      if (normalized.error) {
        logError('[MCPConfigStore] MCP config could not be normalized:', normalized.error);
      }
      return normalized.servers;
    } catch (error) {
      logError('[MCPConfigStore] Failed to read MCP servers, returning empty list:', error);
      return [];
    }
  }

  private readStoreDocument(): unknown {
    try {
      return this.store.store;
    } catch (error) {
      logError('[MCPConfigStore] Failed to read MCP store document:', error);
      try {
        return { servers: this.store.get('servers', []) };
      } catch {
        return { servers: [] };
      }
    }
  }

  private commitMcpConfigWrite(result: McpConfigWriteResult): void {
    if (!result.ok) {
      const message = result.error ?? 'MCP config was left unchanged.';
      logError('[MCPConfigStore] Refusing to modify MCP config:', message);
      throw new Error(message);
    }
    if (!result.changed || result.field === undefined) {
      return;
    }
    this.store.set(result.field, result.value);
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
    const { server } = normalizeMcpServerEntry(config, undefined, new Set());
    if (!server) {
      logError('[MCPConfigStore] Refusing to save invalid MCP server config');
      return;
    }

    this.commitMcpConfigWrite(upsertServerInMcpDocument(this.readStoreDocument(), server));
  }

  /**
   * Delete a server configuration
   */
  deleteServer(serverId: string): void {
    this.commitMcpConfigWrite(deleteServerFromMcpDocument(this.readStoreDocument(), serverId));
  }

  /**
   * Replace recognized server configurations.
   * Unrecognized entries and the original collection shape are kept.
   */
  setServers(servers: MCPServerConfig[]): void {
    const normalized = normalizeMcpConfigInput(servers);
    if (normalized.error) {
      this.commitMcpConfigWrite({ ok: false, changed: false, error: normalized.error });
      return;
    }
    this.commitMcpConfigWrite(
      replaceRecognizedServersInMcpDocument(this.readStoreDocument(), normalized.servers)
    );
  }

  /**
   * Get enabled servers only
   */
  getEnabledServers(): MCPServerConfig[] {
    try {
      return this.getServers().filter((s) => s.enabled);
    } catch (error) {
      logError('[MCPConfigStore] Failed to read enabled MCP servers:', error);
      return [];
    }
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
  private getMcpServerPath(filename: string): string | null {
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
        log(`[MCPConfigStore] MCP Server path resolved (${filename}):`, sourcePath);
        return sourcePath;
      } else {
        logError(`[MCPConfigStore] File not found at:`, sourcePath);
        logError('[MCPConfigStore] __dirname:', __dirname);
        logError('[MCPConfigStore] projectRoot:', projectRoot);
      }
    } catch (error) {
      logError('[MCPConfigStore] Error checking file:', error);
    }

    return null;
  }

  /**
   * Get the path to the Software Development MCP server file
   */
  private getSoftwareDevServerPath(): string | null {
    return this.getMcpServerPath('software-dev-server-example.ts');
  }

  /**
   * Get the path to the GUI Operate MCP server file
   */
  private getGuiOperateServerPath(): string | null {
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
        args: preset.args.map((arg) => {
          // Software Development server path
          if (arg === '{SOFTWARE_DEV_SERVER_PATH}') {
            return this.getSoftwareDevServerPath() || arg;
          }
          // GUI Operate server path
          if (arg === '{GUI_OPERATE_SERVER_PATH}') {
            return this.getGuiOperateServerPath() || arg;
          }
          return arg;
        }),
      };
    }

    return {
      ...resolvedPreset,
      id: `mcp-${presetKey}-${crypto.randomUUID()}`,
      enabled,
    };
  }
}

// Singleton instance
export const mcpConfigStore = new MCPConfigStore();
