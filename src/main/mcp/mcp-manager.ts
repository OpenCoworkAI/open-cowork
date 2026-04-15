/**
 * @module main/mcp/mcp-manager
 *
 * Model Context Protocol (MCP) server manager (1321 lines).
 *
 * Responsibilities:
 * - MCP server config CRUD (add, update, delete, list)
 * - Server lifecycle: start, stop, restart with health checks
 * - Transport handling: stdio (child process), SSE (HTTP stream), and Streamable HTTP
 * - Tool/resource/prompt discovery from connected servers
 *
 * Dependencies: config-store (via mcp-config-store)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { app, BrowserWindow } from 'electron';

import path from 'path';
import { log, logError, logWarn, logCtx, logCtxError, logTiming } from '../utils/logger';
import { getDefaultShell } from '../utils/shell-resolver';

/**
 * MCP Server Configuration
 */
export interface MCPServerConfig {
  id: string;
  name: string;
  type: 'stdio' | 'sse' | 'streamable-http';
  command?: string; // For stdio: command to run
  args?: string[]; // For stdio: command arguments
  env?: Record<string, string>; // Environment variables
  cwd?: string; // Working directory for stdio command
  url?: string; // For SSE / Streamable HTTP: server URL
  headers?: Record<string, string>; // For SSE / Streamable HTTP: HTTP headers
  enabled: boolean;
}

/**
 * MCP Tool Definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  serverId: string;
  serverName: string;
}

function normalizeWindowsPathForComparison(candidate: string): string {
  return path.win32.normalize(candidate).replace(/\//g, '\\').toLowerCase();
}

function normalizeWindowsDirectoryForComparison(candidate: string): string {
  return normalizeWindowsPathForComparison(candidate).replace(/[\\/]+$/, '');
}

function getTrustedWindowsNpxDirectories(
  env: Record<string, string | undefined> = process.env
): string[] {
  const candidates = [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );

  return Array.from(
    new Set(
      candidates.map((directory) =>
        normalizeWindowsDirectoryForComparison(path.win32.join(directory, 'nodejs'))
      )
    )
  );
}

export function findPreferredWindowsNpxPath(
  pathEnv: string | undefined,
  bundledNpxPath: string | null,
  pathExists: (candidate: string) => boolean = (candidate) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    return fs.existsSync(candidate);
  },
  trustedDirectories?: string[]
): string | null {
  const bundledNormalized = bundledNpxPath
    ? normalizeWindowsPathForComparison(bundledNpxPath)
    : null;
  const normalizedTrustedDirectories = trustedDirectories?.map(
    normalizeWindowsDirectoryForComparison
  );

  for (const rawEntry of (pathEnv || '').split(';')) {
    const entry = rawEntry.trim().replace(/^"(.*)"$/, '$1');
    if (!entry) {
      continue;
    }

    const candidate = path.win32.join(entry, 'npx.cmd');
    if (!pathExists(candidate)) {
      continue;
    }

    if (bundledNormalized && normalizeWindowsPathForComparison(candidate) === bundledNormalized) {
      continue;
    }

    if (
      normalizedTrustedDirectories &&
      !normalizedTrustedDirectories.includes(normalizeWindowsDirectoryForComparison(entry))
    ) {
      continue;
    }

    return candidate;
  }

  return bundledNpxPath;
}

/**
 * MCP Manager - Manages connections to MCP servers and exposes their tools
 */
export class MCPManager {
  private clients: Map<string, Client> = new Map();
  private transports: Map<
    string,
    StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport
  > = new Map();
  private tools: Map<string, MCPTool> = new Map(); // toolName -> MCPTool
  private serverConfigs: Map<string, MCPServerConfig> = new Map();
  private npxPath: string | null = null; // Cached npx path
  // Fingerprint of last initialized config to skip redundant re-init
  private lastConfigFingerprint: string | null = null;
  // Cached base environment (shell env + PATH). Resolved once, reused for all MCP server spawns.
  private cachedBaseEnv: Record<string, string> | null = null;
  private initializingServers = false;
  // Pending config queued while initialization is in progress
  private pendingInitConfigs: MCPServerConfig[] | null = null;
  // Guards against concurrent reconnect/update operations on the same server
  private reconnectingServers: Set<string> = new Set();
  // Tracks per-server connection status for UI display
  private connectionStatus = new Map<string, 'connecting' | 'connected' | 'failed'>();

  /**
   * Get bundled Node.js path
   * Returns the path to the bundled node/npx binaries
   */
  private getBundledNodePath(): { node: string; npx: string } | null {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const os = require('os');

    const platform = os.platform();
    const arch = os.arch();

    // In production, resources are in app.asar.unpacked or extraResources
    let resourcesPath: string;

    if (!app.isPackaged) {
      // Development: use downloaded node in resources/node
      // __dirname is dist-electron/main, so go up to project root
      log('[MCPManager] Development mode, using downloaded node in resources/node');
      const projectRoot = path.join(__dirname, '..', '..');
      resourcesPath = path.join(projectRoot, 'resources', 'node', `${platform}-${arch}`);
    } else {
      // Production: use bundled node in extraResources
      log('[MCPManager] Production mode, using bundled node in extraResources');
      resourcesPath = path.join(process.resourcesPath, 'node');
    }

    log(`[MCPManager] Looking for bundled Node.js at: ${resourcesPath}`);

    if (!fs.existsSync(resourcesPath)) {
      logWarn(`[MCPManager] Bundled Node.js not found at: ${resourcesPath}`);
      return null;
    }

    // Determine binary paths based on platform
    const binDir = platform === 'win32' ? resourcesPath : path.join(resourcesPath, 'bin');
    const nodeExe = platform === 'win32' ? 'node.exe' : 'node';
    const npxExe = platform === 'win32' ? 'npx.cmd' : 'npx';

    const nodePath = path.join(binDir, nodeExe);
    const npxPath = path.join(binDir, npxExe);

    // Verify files exist
    if (fs.existsSync(nodePath) && fs.existsSync(npxPath)) {
      log(`[MCPManager] Found bundled Node.js: ${nodePath}`);
      log(`[MCPManager] Found bundled npx: ${npxPath}`);
      return { node: nodePath, npx: npxPath };
    } else {
      logWarn(
        `[MCPManager] Bundled binaries incomplete - node: ${fs.existsSync(nodePath)}, npx: ${fs.existsSync(npxPath)}`
      );
      return null;
    }
  }

  /**
   * Get npx path from bundled Node.js
   * Throws an error if bundled Node.js is not found
   */
  private async checkNpxInPath(): Promise<void> {
    const bundledNode = this.getBundledNodePath();
    if (!bundledNode) {
      const errorMessage =
        'Bundled Node.js not found. Please reinstall the application.\n' +
        '未找到内置的 Node.js。请重新安装应用。\n\n' +
        'The application requires bundled Node.js to run MCP servers.\n' +
        '应用需要内置的 Node.js 来运行 MCP 服务器。';

      logError('[MCPManager] Bundled Node.js not found');
      throw new Error(errorMessage);
    }

    this.npxPath = bundledNode.npx;
    log(`[MCPManager] Using bundled npx: ${this.npxPath}`);
  }

  private async resolvePreferredNpxPath(pathEnv: string | undefined): Promise<string> {
    const bundledNpxPath = this.getBundledNodePath()?.npx ?? null;

    if (process.platform === 'win32') {
      const preferredNpxPath = findPreferredWindowsNpxPath(
        pathEnv,
        bundledNpxPath,
        undefined,
        getTrustedWindowsNpxDirectories(process.env)
      );
      if (!preferredNpxPath) {
        throw new Error(
          'npx is not available. Install Node.js so Open Cowork can use your system npx.cmd, or reinstall the app to restore the bundled runtime.'
        );
      }

      this.npxPath = preferredNpxPath;
      if (
        bundledNpxPath &&
        normalizeWindowsPathForComparison(preferredNpxPath) !==
          normalizeWindowsPathForComparison(bundledNpxPath)
      ) {
        log(`[MCPManager] Using system npx on Windows: ${this.npxPath}`);
      } else {
        log(`[MCPManager] Using bundled npx: ${this.npxPath}`);
      }

      return preferredNpxPath;
    }

    await this.checkNpxInPath();
    if (!this.npxPath) {
      throw new Error('Bundled npx is unavailable.');
    }
    return this.npxPath;
  }

  /**
   * Get enhanced environment with proper PATH for packaged app
   * This is critical for packaged apps where process.env is very limited
   */
  private async getEnhancedEnv(configEnv: Record<string, string>): Promise<Record<string, string>> {
    if (!this.cachedBaseEnv) {
      this.cachedBaseEnv = await this.resolveBaseEnv();
    }
    return { ...this.cachedBaseEnv, ...configEnv };
  }

  /**
   * Resolve the base environment (shell env + PATH).
   * Heavy operation — called once, then cached by getEnhancedEnv.
   */
  private async resolveBaseEnv(): Promise<Record<string, string>> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const os = await import('os');
    const path = await import('path');

    const platform = os.platform();
    const homeDir = os.homedir();

    // Start with current process env
    let env = { ...process.env } as Record<string, string>;

    // For macOS/Linux, try to get full environment from user's shell
    // This is essential for packaged apps where process.env is minimal
    if (platform === 'darwin' || platform === 'linux') {
      try {
        const shell = getDefaultShell();
        const shellName = path.basename(shell);

        log(`[MCPManager] Getting full environment from ${shellName}...`);

        // Use login shell to get full environment including PATH
        // execFile avoids shell injection — args passed as array, not interpolated string
        const { stdout } = await execFileAsync(shell, ['-l', '-c', 'env'], {
          timeout: 5000,
          env: { HOME: homeDir },
        });

        // Parse environment variables
        const lines = stdout.split(/\r?\n/);
        const shellEnv: Record<string, string> = {};

        for (const line of lines) {
          const equalIndex = line.indexOf('=');
          if (equalIndex > 0) {
            const key = line.substring(0, equalIndex);
            const value = line.substring(equalIndex + 1);
            shellEnv[key] = value;
          }
        }

        // Merge shell environment safely: enrich missing runtime vars but never override
        // config-sensitive keys that were already set by app runtime.
        env = mergeShellEnvForMcp(env, shellEnv);

        // Special handling for PATH: merge both shell PATH and process PATH
        // This ensures we have both user tools (from shell) and system paths (from process)
        if (shellEnv.PATH && process.env.PATH) {
          // For Unix systems (darwin/linux), path delimiter is ':'
          const pathDelimiter = ':';

          const shellPaths = shellEnv.PATH.split(pathDelimiter).filter((p) => p.trim());
          const processPaths = process.env.PATH.split(pathDelimiter).filter((p) => p.trim());

          // Combine and deduplicate paths (shell paths first for priority)
          const allPaths = [...shellPaths];
          for (const p of processPaths) {
            if (!allPaths.includes(p)) {
              allPaths.push(p);
            }
          }

          env.PATH = allPaths.join(pathDelimiter);
          log(
            `[MCPManager] Merged PATH: ${shellPaths.length} paths from shell + ${processPaths.length - (allPaths.length - shellPaths.length)} unique paths from process = ${allPaths.length} total`
          );
        } else if (shellEnv.PATH) {
          env.PATH = shellEnv.PATH;
          log(`[MCPManager] Using shell PATH only`);
        }

        log(
          `[MCPManager] Enhanced environment with ${Object.keys(shellEnv).length} variables from shell`
        );
      } catch (error: unknown) {
        logWarn(
          `[MCPManager] Could not get environment from shell: ${error instanceof Error ? error.message : String(error)}`
        );
        logWarn(`[MCPManager] Using limited process.env, MCP servers may fail`);
      }
    } else if (platform === 'win32') {
      // Windows: try PowerShell to get user PATH
      // Use full path to avoid relying on PATH in Electron packaged environment
      const psExe = path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      );
      try {
        const { stdout } = await execFileAsync(
          psExe,
          [
            '-NoProfile',
            '-Command',
            "[Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')",
          ],
          { timeout: 5000 }
        );
        if (stdout.trim()) {
          const pathDelimiter = ';';
          const winPaths = stdout
            .trim()
            .split(pathDelimiter)
            .filter((p) => p.trim());
          const currentPaths = (env.PATH || '').split(pathDelimiter).filter((p) => p.trim());
          const allPaths = [...winPaths];
          for (const p of currentPaths) {
            if (!allPaths.some((ep) => ep.toLowerCase() === p.toLowerCase())) {
              allPaths.push(p);
            }
          }
          env.PATH = allPaths.join(pathDelimiter);
          log(
            `[MCPManager] Enhanced Windows PATH: ${winPaths.length} user/machine paths + ${allPaths.length - winPaths.length} unique process paths = ${allPaths.length} total`
          );
        }
      } catch (error: unknown) {
        logWarn(
          `[MCPManager] Could not get Windows PATH from PowerShell: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Add bundled Node.js bin directory to PATH (highest priority)
    // This ensures npx can find the bundled node executable
    const bundledNode = this.getBundledNodePath();
    if (bundledNode && env.PATH) {
      const nodeBinDir = path.dirname(bundledNode.node);
      const pathDelimiter = platform === 'win32' ? ';' : ':';

      // Prepend bundled node bin directory to PATH
      const pathParts = env.PATH.split(pathDelimiter).filter((p) => p.trim());

      // Remove bundled path if it already exists (to avoid duplicates)
      const filteredPaths = pathParts.filter((p) => p !== nodeBinDir);

      // Add bundled path at the beginning
      env.PATH = [nodeBinDir, ...filteredPaths].join(pathDelimiter);
      log(`[MCPManager] Prepended bundled Node.js bin to PATH: ${nodeBinDir}`);
    }

    log(`[MCPManager] Final PATH: ${env.PATH?.substring(0, 150)}...`);

    return env;
  }

  /**
   * Initialize MCP servers from configuration
   */
  async initializeServers(configs: MCPServerConfig[]): Promise<void> {
    if (this.initializingServers) {
      // Store the latest config so we can replay it once the current init finishes
      this.pendingInitConfigs = configs;
      return;
    }
    this.initializingServers = true;
    try {
      const fingerprint = JSON.stringify(
        configs.map((c) => ({
          id: c.id,
          enabled: c.enabled,
          command: c.command,
          args: c.args,
          url: c.url,
          env: c.env,
          headers: c.headers,
        }))
      );
      if (fingerprint === this.lastConfigFingerprint) {
        log('[MCPManager] Config unchanged, skipping re-initialization');
        return;
      }
      this.lastConfigFingerprint = fingerprint;

      log('[MCPManager] Initializing', configs.length, 'MCP servers');

      // Close existing connections
      await this.disconnectAll();

      // Store configurations
      this.serverConfigs.clear();
      for (const config of configs) {
        this.serverConfigs.set(config.id, config);
      }

      // Connect to enabled servers in parallel
      const enabledConfigs = configs.filter((c) => c.enabled);
      await Promise.allSettled(
        enabledConfigs.map(async (config) => {
          try {
            await this.connectServer(config);
          } catch (error) {
            logError(`[MCPManager] Failed to connect to server ${config.name}:`, error);
          }
        })
      );

      // Refresh tools from all connected servers
      await this.refreshTools();
    } finally {
      this.initializingServers = false;
      // Replay any config that arrived while we were initializing
      if (this.pendingInitConfigs !== null) {
        const pending = this.pendingInitConfigs;
        this.pendingInitConfigs = null;
        await this.initializeServers(pending);
      }
    }
  }

  /**
   * Update a single server configuration and reconnect if needed
   * This is more efficient than reinitializing all servers
   */
  async updateServer(config: MCPServerConfig): Promise<void> {
    // Defer if initialization is in progress to avoid races
    if (this.initializingServers) {
      log('[MCPManager] Deferring update during initialization');
      return;
    }
    // Prevent concurrent update while a reconnect is already in progress for this server
    if (this.reconnectingServers.has(config.id)) {
      logWarn(
        `[MCPManager] Skipping updateServer for ${config.name}: reconnect already in progress`
      );
      return;
    }
    log(`[MCPManager] Updating server: ${config.name} (enabled: ${config.enabled})`);
    this.lastConfigFingerprint = null;

    // Store the updated config
    this.serverConfigs.set(config.id, config);

    // Check if server is currently connected
    const isConnected = this.clients.has(config.id);

    if (config.enabled && !isConnected) {
      // Need to connect
      try {
        await this.connectServer(config);
        await this.refreshTools();
      } catch (error) {
        logError(`[MCPManager] Failed to connect to server ${config.name}:`, error);
        throw error;
      }
    } else if (!config.enabled && isConnected) {
      // Need to disconnect
      await this.disconnectServer(config.id);
      await this.refreshTools();
    } else if (config.enabled && isConnected) {
      // Config changed, reconnect
      await this.disconnectServer(config.id);
      try {
        await this.connectServer(config);
        await this.refreshTools();
      } catch (error) {
        logError(`[MCPManager] Failed to reconnect server ${config.name}:`, error);
        throw error;
      }
    }
    // If disabled and not connected, nothing to do
  }

  /**
   * Remove a server from tracking (call after deleting from config store)
   */
  async removeServer(serverId: string): Promise<void> {
    log(`[MCPManager] Removing server: ${serverId}`);
    this.lastConfigFingerprint = null;
    await this.disconnectServer(serverId);
    this.serverConfigs.delete(serverId);
    await this.refreshTools();
  }

  /**
   * Get the path to a MCP server file in the mcp directory
   */
  private getMcpServerPath(filename: string): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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
          log(`[MCPManager] Found MCP server at: ${mcpPath}`);
          return mcpPath;
        } else {
          logError(`[MCPManager] File not found at: ${mcpPath}`);
        }
      } catch (error) {
        logError(`[MCPManager] Error checking MCP server path: ${error}`);
      }
    }

    // Development: __dirname is dist-electron/main
    // Need to go up 2 levels to get to project root (dist-electron/main -> dist-electron -> project root)
    const projectRoot = path.join(__dirname, '..', '..');

    // Prefer bundled JS from dist-mcp in development.
    // This avoids running TypeScript directly with `node` (which will fail without a TS loader).
    const jsFilename = filename.replace(/\.ts$/, '.js');
    const devBundledPath = path.join(projectRoot, 'dist-mcp', jsFilename);
    try {
      if (fs.existsSync(devBundledPath)) {
        log(`[MCPManager] Found bundled MCP server (dev) at: ${devBundledPath}`);
        return devBundledPath;
      }
    } catch (error) {
      logWarn(`[MCPManager] Error checking dev bundled MCP server path: ${error}`);
    }

    // Fallback to source TypeScript (requires running via tsx/ts-node if using command 'node')
    const sourcePath = path.join(projectRoot, 'src', 'main', 'mcp', filename);

    // Verify file exists and log for debugging
    try {
      if (fs.existsSync(sourcePath)) {
        log(`[MCPManager] MCP Server path resolved (${filename}):`, sourcePath);
        return sourcePath;
      } else {
        logError(`[MCPManager] File not found at:`, sourcePath);
        logError('[MCPManager] __dirname:', __dirname);
        logError('[MCPManager] projectRoot:', projectRoot);
      }
    } catch (error) {
      logError('[MCPManager] Error checking file:', error);
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
   * Connect to a single MCP server
   */
  private async connectServer(config: MCPServerConfig): Promise<void> {
    log(`[MCPManager] Connecting to MCP server: ${config.name} (${config.type})`);

    // Mark status as connecting at the very start, before any transport creation
    this.connectionStatus.set(config.id, 'connecting');

    try {
      await this.connectServerInternal(config);
      this.connectionStatus.set(config.id, 'connected');
    } catch (error) {
      this.connectionStatus.set(config.id, 'failed');
      throw error;
    }
  }

  /**
   * Internal connect logic — separated so connectServer can guarantee
   * connectionStatus is always set to 'connected' or 'failed'.
   */
  private async connectServerInternal(config: MCPServerConfig): Promise<void> {
    let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;
    let commandForLogging = '';
    let argsForLogging: string[] = [];

    if (config.type === 'stdio') {
      if (!config.command) {
        throw new Error(`STDIO server ${config.name} requires a command`);
      }

      let command = config.command;
      // Resolve path placeholders for presets
      let args = config.args || [];

      // Auto-migrate old configs: if using 'npx -y tsx' with built-in MCP servers, switch to 'node'
      const isBuiltinServer =
        config.name === 'GUI_Operate' ||
        config.name === 'GUI Operate' ||
        config.name === 'Software_Development' ||
        config.name === 'Software Development';
      const isOldConfig =
        (command === 'npx' || command.endsWith('/npx')) &&
        args.includes('-y') &&
        args.includes('tsx');

      if (isBuiltinServer && isOldConfig && app.isPackaged) {
        log(`[MCPManager] Auto-migrating ${config.name} from npx/tsx to node (production mode)`);

        // Get bundled node path
        const bundledNode = this.getBundledNodePath();
        if (bundledNode) {
          command = bundledNode.node;
          // Remove '-y', 'tsx' from args, keep only the script path
          args = args.filter((arg) => arg !== '-y' && arg !== 'tsx');
          log(`[MCPManager] Updated command: ${command} ${args.join(' ')}`);
        }
      }

      args = args.map((arg) => {
        // Software Development server path
        if (arg === '{SOFTWARE_DEV_SERVER_PATH}') {
          return this.getSoftwareDevServerPath();
        }
        // GUI Operate server path
        if (arg === '{GUI_OPERATE_SERVER_PATH}') {
          return this.getGuiOperateServerPath();
        }
        return arg;
      });

      // Dev guard: running TypeScript directly with `node` will fail (no TS loader).
      // We expect built-in servers to be bundled into dist-mcp/*.js in development.
      if (!app.isPackaged && isBuiltinServer) {
        const cmdBase = path.basename(command).toLowerCase();
        const isNodeCmd = cmdBase === 'node' || cmdBase === 'node.exe';
        const tsScript = args.find((a) => typeof a === 'string' && a.endsWith('.ts'));
        if (isNodeCmd && tsScript) {
          throw new Error(
            `[MCPManager] Development config is trying to run a TypeScript MCP server with node:\n` +
              `  ${command} ${args.join(' ')}\n\n` +
              `Fix:\n` +
              `- Run: npm run build:mcp (or restart npm run dev, which should run it)\n` +
              `- Or change this server command to: npx -y tsx <server.ts>\n`
          );
        }
      }

      // Get environment variables before resolving npx so Windows can prefer a
      // real system npx.cmd later in PATH over the prepended bundled runtime.
      const env = await this.getEnhancedEnv(config.env || {});

      // If command is 'npx', resolve the concrete executable path now.
      if (command === 'npx' || command.endsWith('/npx')) {
        command = await this.resolvePreferredNpxPath(env.PATH);
      }

      // Windows: resolve bare commands (e.g. 'npx', 'node') to their .cmd/.exe equivalents.
      // Without this, spawn with shell:false fails with ENOENT because Windows cannot
      // execute .cmd batch wrappers without the explicit extension.
      if (process.platform === 'win32') {
        const cmdBase = path.basename(command).toLowerCase();
        const winSuffixMap: Record<string, string> = {
          npx: '.cmd',
          npm: '.cmd',
          yarn: '.cmd',
          pnpm: '.cmd',
          tsx: '.cmd',
          'ts-node': '.cmd',
          node: '.exe',
        };
        // Only touch bare commands (no directory separator, no existing extension)
        if (winSuffixMap[cmdBase] && command === cmdBase) {
          command = command + winSuffixMap[cmdBase];
          log(`[MCPManager] Windows: resolved bare command '${cmdBase}' to '${command}'`);
        }
      }

      // Store for error logging
      commandForLogging = command;
      argsForLogging = args;

      log('[MCPManager] Server auth env summary', {
        server: config.name,
        OPENAI_API_KEY: env.OPENAI_API_KEY?.trim() ? 'set' : 'unset',
        OPENAI_BASE_URL: env.OPENAI_BASE_URL || '(unset)',
        OPENAI_MODEL: env.OPENAI_MODEL || '(unset)',
        OPENAI_ACCOUNT_ID: env.OPENAI_ACCOUNT_ID?.trim() ? 'set' : 'unset',
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY?.trim() ? 'set' : 'unset',
        ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN?.trim() ? 'set' : 'unset',
      });

      // In production, set NODE_PATH to include unpacked node_modules
      if (app.isPackaged && isBuiltinServer) {
        const unpackedNodeModules = path.join(
          process.resourcesPath || '',
          'app.asar.unpacked',
          'node_modules'
        );
        const asarNodeModules = path.join(process.resourcesPath || '', 'app.asar', 'node_modules');

        // Add both paths to NODE_PATH (unpacked takes priority)
        const nodePaths = [unpackedNodeModules, asarNodeModules];

        env.NODE_PATH = nodePaths.join(path.delimiter);
        log(`[MCPManager] Set NODE_PATH for MCP server: ${env.NODE_PATH}`);

        // Pass resourcesPath to MCP servers so they can reliably locate bundled tools/resources
        // (Node processes spawned from bundled Node.js do not have process.resourcesPath)
        env.OPEN_COWORK_RESOURCES_PATH = process.resourcesPath || '';
      }

      log(`[MCPManager] Creating STDIO transport: ${command} ${args.join(' ')}`);
      log(`[MCPManager] Environment variables: ${Object.keys(env).length} vars`);
      log(`[MCPManager] PATH: ${env.PATH?.substring(0, 200)}...`);
      log(`[MCPManager] HOME: ${env.HOME}`);
      log(`[MCPManager] NODE_PATH: ${env.NODE_PATH || '(not set)'}`);

      // Test if npx can be executed with the current environment (only when command is npx)
      const isNpxCommand =
        path.basename(command).toLowerCase() === 'npx' ||
        path.basename(command).toLowerCase() === 'npx.cmd';
      if (isNpxCommand) {
        try {
          // On Windows, .cmd files (like npx.cmd) cannot be launched with execFile().
          // Use exec() via shell to handle both .cmd and direct executables.
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);

          const quotedCmd = command.includes(' ') ? `"${command}"` : command;
          log(`[MCPManager] Testing npx execution: ${quotedCmd} --version`);
          const testResult = await execAsync(`${quotedCmd} --version`, {
            timeout: 5000,
            env: env,
          });
          log(`[MCPManager] npx test successful: ${testResult.stdout.trim()}`);
        } catch (testError: unknown) {
          const errorMsg = testError instanceof Error ? testError.message : String(testError);
          logError(`[MCPManager] npx test failed: ${errorMsg}`);
          if (
            testError instanceof Error &&
            (testError as NodeJS.ErrnoException & { stderr?: string }).stderr
          ) {
            logError(
              `[MCPManager] npx test stderr: ${(testError as NodeJS.ErrnoException & { stderr?: string }).stderr}`
            );
          }
          // Log warning but do not throw — the real transport spawn may still succeed,
          // and on Windows .cmd resolution can behave differently between exec and spawn.
          logError(
            `[MCPManager] npx pre-check failed. The connection attempt will proceed but may fail.`
          );
        }
      }

      // Create STDIO transport - it will spawn the process internally
      transport = new StdioClientTransport({
        command,
        args,
        env,
        cwd: config.cwd || undefined,
      });

      log(`[MCPManager] STDIO transport created successfully`);
    } else if (config.type === 'sse') {
      if (!config.url) {
        throw new Error(`SSE server ${config.name} requires a URL`);
      }

      let sseUrl: URL;
      try {
        sseUrl = new URL(config.url);
      } catch {
        throw new Error(`SSE server ${config.name} has a malformed URL: "${config.url}"`);
      }

      // Create SSE transport — headers must be passed via requestInit, not as a raw dict
      transport = new SSEClientTransport(sseUrl, { requestInit: { headers: config.headers } });
    } else if (config.type === 'streamable-http') {
      if (!config.url) {
        throw new Error(`Streamable HTTP server ${config.name} requires a URL`);
      }

      log(`[MCPManager] Creating Streamable HTTP transport: ${config.url}`);

      let httpUrl: URL;
      try {
        httpUrl = new URL(config.url);
      } catch {
        throw new Error(
          `Streamable HTTP server ${config.name} has a malformed URL: "${config.url}"`
        );
      }

      // Create Streamable HTTP transport
      const requestInit: RequestInit = {};
      if (config.headers && Object.keys(config.headers).length > 0) {
        requestInit.headers = config.headers;
      }
      transport = new StreamableHTTPClientTransport(httpUrl, { requestInit });
    } else {
      throw new Error(`Unsupported transport type: ${config.type}`);
    }

    // Create MCP client
    const client = new Client(
      {
        name: 'open-cowork',
        version: '0.1.0',
      },
      {
        capabilities: {},
      }
    );

    log(`[MCPManager] MCP client created, attempting to connect...`);

    try {
      // Connect with timeout to prevent hanging indefinitely (e.g. npx download stalls)
      const connectTimeoutMs = 30000; // 30 second timeout
      const connectPromise = client.connect(transport);
      let connectTimeoutId: ReturnType<typeof setTimeout>;
      const connectTimeoutPromise = new Promise<never>((_, reject) => {
        connectTimeoutId = setTimeout(
          () =>
            reject(new Error(`MCP server connection timed out after ${connectTimeoutMs / 1000}s`)),
          connectTimeoutMs
        );
      });

      try {
        await Promise.race([connectPromise, connectTimeoutPromise]);
        clearTimeout(connectTimeoutId!);
      } catch (error) {
        clearTimeout(connectTimeoutId!);
        // Prevent UnhandledPromiseRejection from the orphaned connectPromise
        // when timeout wins the race and transport is closed beneath it.
        connectPromise.catch(() => {});
        throw error;
      }
      log(`[MCPManager] Client.connect() completed successfully`);

      // After connect(), the STDIO transport has spawned the child process.
      // Register process listeners now so _process is guaranteed to exist.
      if (config.type === 'stdio') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const transportAny = transport as any;
          if (transportAny._process) {
            const childProcess = transportAny._process;
            log(`[MCPManager] MCP server process spawned with PID: ${childProcess.pid}`);

            // Unref so this child process doesn't prevent parent exit
            childProcess.unref();

            // NOTE: Do NOT attach a 'data' listener to process.stdout here.
            // The StdioClientTransport owns stdout as its JSON-RPC channel; a competing
            // listener would consume bytes and corrupt the protocol framing.

            // Listen to stderr for error messages
            if (childProcess.stderr) {
              childProcess.stderr.on('data', (data: Buffer) => {
                try {
                  const message = data.toString().trim();
                  if (message) {
                    logError(`[MCPManager] MCP server stderr: ${message}`);
                  }
                } catch (error) {
                  logError('[MCPManager] Error processing MCP server stderr:', error);
                }
              });
            }

            // Listen to process exit
            childProcess.on('exit', (code: number, signal: string) => {
              if (code !== null && code !== 0) {
                logError(`[MCPManager] MCP server process exited with code ${code}`);
              } else if (signal) {
                logError(`[MCPManager] MCP server process killed with signal ${signal}`);
              } else {
                log(`[MCPManager] MCP server process exited normally`);
              }
            });

            childProcess.on('error', (error: Error) => {
              logError(`[MCPManager] MCP server process error: ${error.message}`);
              logError(`[MCPManager] Error stack: ${error.stack}`);
            });
          } else {
            logWarn(`[MCPManager] transport._process is not set after connect`);
          }
        } catch (e: unknown) {
          logWarn(
            `[MCPManager] Could not attach to MCP server process for logging: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    } catch (error: unknown) {
      logError(`[MCPManager] Client.connect() failed:`, error);
      const connErr = error as { code?: unknown; name?: unknown; message?: unknown };
      logError(
        `[MCPManager] Error details - code: ${connErr.code}, name: ${connErr.name}, message: ${connErr.message}`
      );

      // Try to get more details from the transport
      if (config.type === 'stdio' && commandForLogging) {
        logError(`[MCPManager] STDIO transport may have failed to spawn process or communicate`);
        logError(`[MCPManager] Command was: ${commandForLogging} ${argsForLogging.join(' ')}`);
      }

      try {
        await transport.close();
      } catch {
        /* ignore close error */
      }
      throw error;
    }

    // Store client and transport
    this.clients.set(config.id, client);
    this.transports.set(config.id, transport);

    log(`[MCPManager] Connected to ${config.name}`);

    // Special handling for Chrome DevTools MCP Server
    if (config.name.toLowerCase().includes('chrome')) {
      await this.ensureChromeReady(config.id, config.name, client);
    }
  }

  /**
   * Check if Chrome debugging port is accessible
   */
  private async isChromeDebugPortReady(): Promise<boolean> {
    try {
      log(`[MCPManager] Checking Chrome debug port: http://localhost:9222/json/version`);
      const response = await fetch('http://localhost:9222/json/version', {
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        const data = await response.json();
        log(`[MCPManager] Chrome debug port response: ${JSON.stringify(data)}`);
        return true;
      } else {
        log(`[MCPManager] Chrome debug port returned status: ${response.status}`);
        return false;
      }
    } catch (error: unknown) {
      log(
        `[MCPManager] Chrome debug port check failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Wait for Chrome debugging port to become ready with retries
   */
  private async waitForChromeDebugPort(
    maxRetries: number = 15,
    delayMs: number = 1000
  ): Promise<boolean> {
    log(`[MCPManager] Waiting for Chrome debug port (max ${maxRetries} retries)...`);

    for (let i = 0; i < maxRetries; i++) {
      const isReady = await this.isChromeDebugPortReady();
      if (isReady) {
        log(`[MCPManager] Chrome debug port ready ✓ (attempt ${i + 1})`);
        return true;
      }

      if (i < maxRetries - 1) {
        log(`[MCPManager] Port not ready, retrying in ${delayMs}ms... (${i + 1}/${maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    logWarn(`[MCPManager] Chrome debug port not ready after ${maxRetries} attempts`);
    return false;
  }

  /**
   * Ensure Chrome is ready by checking connection and auto-starting if needed
   * This prevents the first tool call from failing with connection errors
   *
   * Logic:
   * 1. Check if port 9222 is accessible
   * 2. If yes, use existing Chrome instance
   * 3. If no, start a new Chrome instance with debugging enabled
   */
  private async ensureChromeReady(
    _serverId: string,
    serverName: string,
    client: Client
  ): Promise<void> {
    log(`[MCPManager] Ensuring Chrome is ready for ${serverName}...`);

    // Step 1: Check if debugging port is accessible
    log(`[MCPManager] Step 1: Checking if Chrome debug port 9222 is accessible...`);
    const portReady = await this.isChromeDebugPortReady();

    if (portReady) {
      log(`[MCPManager] ✓ Chrome debug port (9222) is accessible`);

      // Verify tool connection works
      log(`[MCPManager] Verifying MCP tool connection with list_pages...`);
      try {
        const result = await client.callTool({
          name: 'list_pages',
          arguments: {},
        });
        log(`[MCPManager] ✓ Chrome connected successfully, using existing instance`);
        log(`[MCPManager] list_pages result:`, result);
        return;
      } catch (error: unknown) {
        logWarn(`[MCPManager] ⚠️ Port accessible but tool call failed`);
        const chromeErr = error as { code?: unknown; message?: unknown };
        logWarn(`[MCPManager] Error code: ${chromeErr.code}, message: ${chromeErr.message}`);
        log(`[MCPManager] Will try to start new Chrome instance...`);
      }
    } else {
      log(`[MCPManager] ✗ Chrome debug port (9222) not accessible`);
      log(`[MCPManager] Will start new Chrome instance with debugging enabled...`);
    }

    // Step 2: Start Chrome with remote debugging
    log(`[MCPManager] Step 2: Starting Chrome with remote debugging...`);
    try {
      await this.startChromeWithDebugging();
      log(`[MCPManager] Chrome start command executed`);

      // Wait for Chrome debugging port to become ready
      log(`[MCPManager] Step 3: Waiting for Chrome debug port to become ready...`);
      const portBecameReady = await this.waitForChromeDebugPort(15, 1000);

      if (!portBecameReady) {
        logError(`[MCPManager] ❌ Chrome debug port did not become ready after 15 seconds`);
        logError(`[MCPManager] Possible reasons:`);
        logError(`[MCPManager]   1. Chrome failed to start`);
        logError(`[MCPManager]   2. Another process is using port 9222`);
        logError(`[MCPManager]   3. Firewall blocking the port`);
        throw new Error('Chrome 浏览器未就绪，无法执行此操作: debug port did not become ready');
      }

      log(`[MCPManager] ✓ Chrome debug port is now ready`);

      // Verify tool connection
      log(`[MCPManager] Step 4: Verifying MCP tool connection...`);
      for (let i = 0; i < 5; i++) {
        try {
          const result = await client.callTool({
            name: 'list_pages',
            arguments: {},
          });
          log(`[MCPManager] ✓ Chrome MCP connection verified successfully!`);
          log(`[MCPManager] list_pages result:`, result);
          return;
        } catch (verifyError: unknown) {
          const ve = verifyError as { code?: unknown; message?: unknown };
          if (i < 4) {
            log(`[MCPManager] Connection verification attempt ${i + 1}/5 failed, retrying...`);
            log(`[MCPManager] Error: ${ve.message}`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } else {
            logError(
              `[MCPManager] ❌ Chrome started but MCP connection verification failed after 5 attempts`
            );
            logError(`[MCPManager] Last error code: ${ve.code}, message: ${ve.message}`);
            logError(`[MCPManager] The chrome-devtools-mcp server may not be working correctly`);
            throw new Error(
              'Chrome 浏览器未就绪，无法执行此操作: MCP connection verification failed after 5 attempts'
            );
          }
        }
      }
    } catch (startError: unknown) {
      logError(`[MCPManager] ❌ Failed to start Chrome with debugging`);
      const startErrMsg = startError instanceof Error ? startError.message : String(startError);
      logError(`[MCPManager] Error: ${startErrMsg}`);
      throw new Error(`Chrome 浏览器未就绪，无法执行此操作: ${startErrMsg}`);
    }
  }

  /**
   * Get Chrome user data directory for remote debugging
   * Chrome 136+ requires --user-data-dir for remote debugging to work properly
   */
  private getChromeUserDataDir(): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    // Use userData so the debug profile survives reboots and isn't wiped by OS temp-dir cleanup
    return path.join(app.getPath('userData'), 'chrome-mcp-debug');
  }

  /**
   * Start Chrome with remote debugging enabled on port 9222
   * Following official guide: https://github.com/ChromeDevTools/chrome-devtools-mcp
   *
   * Key requirements:
   * 1. Must use --user-data-dir (Chrome 136+ requirement)
   * 2. Must use --remote-debugging-port=9222
   */
  private async startChromeWithDebugging(): Promise<void> {
    const { spawn } = await import('child_process');
    const os = await import('os');

    const platform = os.platform();
    const userDataDir = this.getChromeUserDataDir();

    log(`[MCPManager] Platform: ${platform}`);
    log(`[MCPManager] User data dir: ${userDataDir}`);

    // Chrome 136+ requires --user-data-dir for remote debugging
    // Without it, --remote-debugging-port may be ignored

    const chromeArgs = [
      '--remote-debugging-port=9222',
      '--user-data-dir=' + userDataDir,
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      'about:blank',
    ];

    let chromePath: string;
    if (platform === 'darwin') {
      chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else if (platform === 'win32') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      // Chrome can be installed in per-user (%LOCALAPPDATA%) or system-wide locations
      const candidates = [
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(
          process.env['PROGRAMFILES'] || 'C:\\Program Files',
          'Google',
          'Chrome',
          'Application',
          'chrome.exe'
        ),
        path.join(
          process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
          'Google',
          'Chrome',
          'Application',
          'chrome.exe'
        ),
      ];
      chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'; // fallback
      for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
          chromePath = candidate;
          break;
        }
      }
    } else {
      chromePath = 'google-chrome';
    }

    log(`[MCPManager] Chrome path: ${chromePath}`);
    log(`[MCPManager] Chrome args: ${JSON.stringify(chromeArgs)}`);

    try {
      const chromeProcess = spawn(chromePath, chromeArgs, {
        detached: true,
        stdio: 'ignore',
      });
      chromeProcess.unref();

      log(`[MCPManager] Chrome spawned successfully`);
    } catch (error: unknown) {
      // ENOENT means the Chrome executable was not found — re-throw so the caller knows
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `Chrome executable not found at: ${chromePath}. Please install Google Chrome.`
        );
      }
      logWarn(`[MCPManager] Chrome startup command completed with warning`);
      logWarn(
        `[MCPManager] Error message: ${error instanceof Error ? error.message : String(error)}`
      );
      const spawnErr = error as { stdout?: string; stderr?: string };
      if (spawnErr.stdout) {
        log(`[MCPManager] stdout: ${spawnErr.stdout}`);
      }
      if (spawnErr.stderr) {
        log(`[MCPManager] stderr: ${spawnErr.stderr}`);
      }
    }
  }

  /**
   * Disconnect from a specific server
   */
  async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    const transport = this.transports.get(serverId);

    if (client) {
      try {
        await client.close();
      } catch (error) {
        logError(`[MCPManager] Error closing client for ${serverId}:`, error);
      }
      this.clients.delete(serverId);
    }

    if (transport) {
      try {
        await transport.close();
      } catch (error) {
        logError(`[MCPManager] Error closing transport for ${serverId}:`, error);
      }
      this.transports.delete(serverId);
    }

    // Remove tools from this server
    const toolsToRemove: string[] = [];
    for (const [toolName, tool] of this.tools.entries()) {
      if (tool.serverId === serverId) {
        toolsToRemove.push(toolName);
      }
    }
    for (const toolName of toolsToRemove) {
      this.tools.delete(toolName);
    }

    this.connectionStatus.delete(serverId);

    log(`[MCPManager] Disconnected from server ${serverId}`);
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    const serverIds = Array.from(this.clients.keys());
    for (const serverId of serverIds) {
      await this.disconnectServer(serverId);
    }
  }

  /**
   * Refresh tools from all connected servers with timeout protection
   */
  async refreshTools(): Promise<void> {
    log('[MCPManager] Refreshing tools from all servers');
    const newTools = new Map<string, MCPTool>();

    for (const [serverId, client] of this.clients.entries()) {
      try {
        const config = this.serverConfigs.get(serverId);
        if (!config) continue;

        // Add timeout for listTools call to prevent hanging
        const timeoutMs = 10000; // 10 second timeout
        const listToolsPromise = client.listTools();
        let timeoutId: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('listTools timeout after 10s')), timeoutMs);
        });

        log(`[MCPManager] Fetching tools from ${config.name} (timeout: ${timeoutMs}ms)...`);

        let listToolsResult;
        try {
          listToolsResult = await Promise.race([listToolsPromise, timeoutPromise]);
          clearTimeout(timeoutId!);
        } catch (error) {
          clearTimeout(timeoutId!);
          throw error;
        }

        log(`[MCPManager] Raw tools from ${config.name}:`, listToolsResult);

        for (const tool of listToolsResult.tools) {
          // Prefix tool name with server name to avoid conflicts
          // Format: mcp__<ServerName>__<toolName> (double underscores, preserve case)
          // Sanitize: collapse whitespace and collapse any accidental __ sequences
          const serverKey = config.name.replace(/\s+/g, '_').replace(/__/g, '_');
          const prefixedName = `mcp__${serverKey}__${tool.name}`;

          newTools.set(prefixedName, {
            name: prefixedName,
            description: tool.description || '',
            inputSchema: {
              type: 'object',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              properties: (tool.inputSchema as any)?.properties || {},
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              required: (tool.inputSchema as any)?.required,
            },
            serverId,
            serverName: config.name,
          });
        }

        log(`[MCPManager] ✓ Loaded ${listToolsResult.tools.length} tools from ${config.name}`);
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logError(`[MCPManager] ❌ Error listing tools from ${serverId}:`, errMsg);

        // Notify renderer that tools refresh failed for this server
        try {
          const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
          if (win) {
            win.webContents.send('server-event', {
              type: 'mcp:tools-refresh-error',
              payload: { serverId, error: errMsg },
            });
          }
        } catch (_notifyErr) {
          // Best-effort notification; logging already happened above
        }

        // If Chrome server, try to reconnect
        const config = this.serverConfigs.get(serverId);
        if (config && config.name.toLowerCase().includes('chrome')) {
          log(`[MCPManager] Chrome server may need reconnection. Trying to refresh...`);
        }
      }
    }

    this.tools = newTools; // atomic swap

    log(`[MCPManager] Total tools available: ${this.tools.size}`);
  }

  /**
   * Get all available MCP tools
   */
  getTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool by name
   */
  getTool(toolName: string): MCPTool | undefined {
    return this.tools.get(toolName);
  }

  /**
   * Call an MCP tool with timeout and retry
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`MCP tool not found: ${toolName}`);
    }

    // 提取实际工具名（格式：mcp__<ServerName>__<toolName>）
    let actualToolName = toolName;
    if (toolName.startsWith('mcp__')) {
      const remainder = toolName.slice('mcp__'.length);
      const separatorIndex = remainder.indexOf('__');
      if (separatorIndex !== -1) {
        actualToolName = remainder.slice(separatorIndex + 2);
      }
    }

    logCtx(`[MCPManager] Calling tool ${actualToolName} on server ${tool.serverName}`);

    const callStartTime = Date.now();
    const maxRetries = 2;
    let lastError: unknown;
    let compatHotReloadTried = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Re-lookup tool on every iteration: after reconnect the registry is refreshed
      const currentTool = this.tools.get(toolName) ?? tool;
      try {
        const client = this.clients.get(currentTool.serverId);
        if (!client) {
          throw new Error(`MCP server not connected: ${currentTool.serverId}`);
        }

        // Add timeout for tool call
        const timeoutMs = 30000; // 30 second timeout
        const callPromise = client.callTool({
          name: actualToolName,
          arguments: args,
        });
        let callTimeoutId: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<never>((_, reject) => {
          callTimeoutId = setTimeout(
            () => reject(new Error(`Tool call timeout after ${timeoutMs}ms`)),
            timeoutMs
          );
        });

        let result;
        try {
          result = await Promise.race([callPromise, timeoutPromise]);
        } finally {
          clearTimeout(callTimeoutId!);
        }

        const toolErrorMessage = extractStructuredToolErrorMessage(result);
        if (shouldReconnectOnStructuredToolError(toolErrorMessage)) {
          // 某些 MCP 服务会把连接错误包在结构化结果里而非直接抛异常，这里转为异常以复用统一重连逻辑。
          throw new Error(toolErrorMessage);
        }
        if (
          !compatHotReloadTried &&
          shouldHotReloadGuiVisionServer(currentTool.serverName, actualToolName, toolErrorMessage)
        ) {
          compatHotReloadTried = true;
          logWarn(
            `[MCPManager] Detected GUI vision compatibility error (${toolErrorMessage}). Reconnecting server ${currentTool.serverName} and retrying once.`
          );
          const reconnected = await this.reconnectServer(currentTool.serverId);
          if (reconnected) {
            continue;
          }
        }

        logTiming(`MCP tool ${actualToolName}`, callStartTime);
        return result;
      } catch (error: unknown) {
        lastError = error;
        const errorMsg = error instanceof Error ? error.message : String(error);
        logCtxError(
          `[MCPManager] Error calling tool ${toolName} (attempt ${attempt + 1}/${maxRetries + 1}):`,
          errorMsg
        );

        if (attempt >= maxRetries) {
          break;
        }

        const lowerErrorMsg = errorMsg.toLowerCase();
        const shouldReconnect =
          lowerErrorMsg.includes('mcp server not connected') ||
          lowerErrorMsg.includes('not connected') ||
          lowerErrorMsg.includes('connection closed');

        if (shouldReconnect) {
          log(
            `[MCPManager] Reconnectable MCP error detected for ${currentTool.serverName}; attempting reconnect...`
          );
          const reconnected = await this.reconnectServer(currentTool.serverId);
          if (reconnected) {
            continue;
          }
          logWarn(
            `[MCPManager] Reconnect attempt failed for ${currentTool.serverName}, will retry after backoff`
          );
          const delay = Math.min(2000 * Math.pow(1.5, attempt), 10000);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        if (errorMsg.includes('timeout')) {
          log(`[MCPManager] Tool call timeout detected, retrying after backoff...`);
          const delay = Math.min(2000 * Math.pow(1.5, attempt), 10000);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // For non-retryable errors, exit retry loop immediately
        break;
      }
    }

    throw lastError;
  }

  private async reconnectServer(serverId: string): Promise<boolean> {
    // Prevent concurrent reconnect operations for the same server
    if (this.reconnectingServers.has(serverId)) {
      logWarn(
        `[MCPManager] Skipping reconnectServer for ${serverId}: reconnect already in progress`
      );
      return false;
    }
    const config = this.serverConfigs.get(serverId);
    if (!config || !config.enabled) {
      logWarn(`[MCPManager] Cannot reconnect server ${serverId}: config missing or disabled`);
      return false;
    }

    this.reconnectingServers.add(serverId);
    // Pre-set 'connecting' before disconnect to avoid status flickering to 'disabled'
    this.connectionStatus.set(serverId, 'connecting');
    try {
      await this.disconnectServer(serverId);
      await this.connectServer(config);
      await this.refreshTools();
      log(`[MCPManager] Reconnected server ${config.name} (${serverId})`);
      return true;
    } catch (error) {
      logError(`[MCPManager] Failed to reconnect server ${serverId}:`, error);
      return false;
    } finally {
      this.reconnectingServers.delete(serverId);
    }
  }

  /**
   * Get server status
   */
  getServerStatus(): Array<{
    id: string;
    name: string;
    connected: boolean;
    status: 'connecting' | 'connected' | 'failed' | 'disabled';
    toolCount: number;
  }> {
    const status: Array<{
      id: string;
      name: string;
      connected: boolean;
      status: 'connecting' | 'connected' | 'failed' | 'disabled';
      toolCount: number;
    }> = [];

    for (const [serverId, config] of this.serverConfigs.entries()) {
      const connected = this.clients.has(serverId);
      const toolCount = Array.from(this.tools.values()).filter(
        (tool) => tool.serverId === serverId
      ).length;

      // Derive status: use connectionStatus map if available, otherwise infer from enabled/connected
      let serverStatus: 'connecting' | 'connected' | 'failed' | 'disabled';
      const trackedStatus = this.connectionStatus.get(serverId);
      if (!config.enabled) {
        serverStatus = 'disabled';
      } else if (trackedStatus) {
        serverStatus = trackedStatus;
      } else if (connected) {
        serverStatus = 'connected';
      } else {
        // Enabled server with no tracked status and no client — likely transient
        // (e.g. during reconnect after disconnectServer deleted the entry).
        serverStatus = 'connecting';
      }

      status.push({
        id: serverId,
        name: config.name,
        connected,
        status: serverStatus,
        toolCount,
      });
    }

    return status;
  }

  /**
   * Cleanup on shutdown
   */
  async shutdown(): Promise<void> {
    await this.disconnectAll();
  }
}

function hasNonEmptyEnvValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isProtectedConfigEnvKey(key: string): boolean {
  return (
    key.startsWith('OPENAI_') ||
    key.startsWith('ANTHROPIC_') ||
    key.startsWith('CLAUDE_') ||
    key.startsWith('COWORK_')
  );
}

export function mergeShellEnvForMcp(
  baseEnv: Record<string, string>,
  shellEnv: Record<string, string>
): Record<string, string> {
  const merged = { ...baseEnv };
  for (const [key, value] of Object.entries(shellEnv)) {
    if (key === 'PATH') {
      continue;
    }
    if (isProtectedConfigEnvKey(key)) {
      continue;
    }
    if (hasNonEmptyEnvValue(merged[key])) {
      continue;
    }
    if (typeof value === 'string' && value.length > 0) {
      merged[key] = value;
    }
  }
  return merged;
}

function extractStructuredToolErrorMessage(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return '';
  }

  const topLevelIsError = (result as { isError?: unknown }).isError === true;
  const resultObj = result as { content?: unknown };
  const content = Array.isArray(resultObj.content) ? resultObj.content : [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    if ((item as { type?: string }).type !== 'text') continue;
    const text = (item as { text?: unknown }).text;
    if (typeof text !== 'string') continue;

    const trimmed = text.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
        if (parsed.error === true && typeof parsed.message === 'string' && parsed.message.trim()) {
          return parsed.message.trim();
        }
      } catch {
        // Ignore malformed JSON payloads
      }
    }

    if (topLevelIsError && isReconnectableErrorText(trimmed)) {
      return trimmed;
    }
  }

  return '';
}

function isReconnectableErrorText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized === 'not connected' ||
    normalized.includes('mcp server not connected') ||
    normalized.includes('connection closed')
  );
}

function shouldReconnectOnStructuredToolError(errorMessage: string): boolean {
  if (!errorMessage) {
    return false;
  }
  return isReconnectableErrorText(errorMessage);
}

function shouldHotReloadGuiVisionServer(
  serverName: string,
  actualToolName: string,
  errorMessage: string
): boolean {
  if (!errorMessage) {
    return false;
  }
  if (actualToolName !== 'gui_verify_vision') {
    return false;
  }
  if (!serverName.toLowerCase().includes('gui')) {
    return false;
  }

  return (
    errorMessage.includes('Unsupported parameter: max_output_tokens') ||
    errorMessage.includes('Instructions are required') ||
    errorMessage.includes('Stream must be set to true')
  );
}
