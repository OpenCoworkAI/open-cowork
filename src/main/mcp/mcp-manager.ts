import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { app } from 'electron';
import path from 'path';
import { log, logError, logWarn } from '../utils/logger';

/**
 * MCP Server Configuration
 */
export interface MCPServerConfig {
  id: string;
  name: string;
  type: 'stdio' | 'sse';
  command?: string; // For stdio: command to run
  args?: string[]; // For stdio: command arguments
  env?: Record<string, string>; // Environment variables
  url?: string; // For SSE: server URL
  headers?: Record<string, string>; // For SSE: HTTP headers
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
    properties: Record<string, any>;
    required?: string[];
  };
  serverId: string;
  serverName: string;
}

/**
 * MCP Manager - Manages connections to MCP servers and exposes their tools
 */
export class MCPManager {
  private clients: Map<string, Client> = new Map();
  private transports: Map<string, StdioClientTransport | SSEClientTransport> = new Map();
  private processes: Map<string, any> = new Map();
  private tools: Map<string, MCPTool> = new Map(); // toolName -> MCPTool
  private serverConfigs: Map<string, MCPServerConfig> = new Map();
  private npxPath: string | null = null; // Cached npx path

  /**
   * Get bundled Node.js path
   * Returns the path to the bundled node/npx binaries
   */
  private getBundledNodePath(): { node: string; npx: string } | null {
    const path = require('path');
    const fs = require('fs');
    const os = require('os');
    
    const platform = os.platform();
    const arch = os.arch();
    
    // In production, resources are in app.asar.unpacked or extraResources
    let resourcesPath: string;
    
    if (process.env.NODE_ENV === 'development') {
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
      logWarn(`[MCPManager] Bundled binaries incomplete - node: ${fs.existsSync(nodePath)}, npx: ${fs.existsSync(npxPath)}`);
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

  /**
   * Get enhanced environment with proper PATH for packaged app
   * This is critical for packaged apps where process.env is very limited
   */
  private async getEnhancedEnv(configEnv: Record<string, string>): Promise<Record<string, string>> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
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
        const shell = process.env.SHELL || '/bin/zsh';
        const shellName = path.basename(shell);
        
        log(`[MCPManager] Getting full environment from ${shellName}...`);
        
        // Use login shell to get full environment including PATH
        const { stdout } = await execAsync(`${shell} -l -c 'env'`, { 
          timeout: 5000,
          env: { HOME: homeDir }
        });
        
        // Parse environment variables
        const lines = stdout.split('\n');
        const shellEnv: Record<string, string> = {};
        
        for (const line of lines) {
          const equalIndex = line.indexOf('=');
          if (equalIndex > 0) {
            const key = line.substring(0, equalIndex);
            const value = line.substring(equalIndex + 1);
            shellEnv[key] = value;
          }
        }
        
        // Merge shell environment with process environment
        // For most variables, use shell env (it's more complete)
        env = { ...env, ...shellEnv };
        
        // Special handling for PATH: merge both shell PATH and process PATH
        // This ensures we have both user tools (from shell) and system paths (from process)
        if (shellEnv.PATH && process.env.PATH) {
          // For Unix systems (darwin/linux), path delimiter is ':'
          const pathDelimiter = ':';
          
          const shellPaths = shellEnv.PATH.split(pathDelimiter).filter(p => p.trim());
          const processPaths = process.env.PATH.split(pathDelimiter).filter(p => p.trim());
          
          // Combine and deduplicate paths (shell paths first for priority)
          const allPaths = [...shellPaths];
          for (const p of processPaths) {
            if (!allPaths.includes(p)) {
              allPaths.push(p);
            }
          }
          
          env.PATH = allPaths.join(pathDelimiter);
          log(`[MCPManager] Merged PATH: ${shellPaths.length} paths from shell + ${processPaths.length - (allPaths.length - shellPaths.length)} unique paths from process = ${allPaths.length} total`);
        } else if (shellEnv.PATH) {
          env.PATH = shellEnv.PATH;
          log(`[MCPManager] Using shell PATH only`);
        }
        
        log(`[MCPManager] Enhanced environment with ${Object.keys(shellEnv).length} variables from shell`);
      } catch (error: any) {
        logWarn(`[MCPManager] Could not get environment from shell: ${error.message}`);
        logWarn(`[MCPManager] Using limited process.env, MCP servers may fail`);
      }
    }
    
    // Add bundled Node.js bin directory to PATH (highest priority)
    // This ensures npx can find the bundled node executable
    const bundledNode = this.getBundledNodePath();
    if (bundledNode && env.PATH) {
      const nodeBinDir = path.dirname(bundledNode.node);
      const pathDelimiter = platform === 'win32' ? ';' : ':';
      
      // Prepend bundled node bin directory to PATH
      const pathParts = env.PATH.split(pathDelimiter).filter(p => p.trim());
      
      // Remove bundled path if it already exists (to avoid duplicates)
      const filteredPaths = pathParts.filter(p => p !== nodeBinDir);
      
      // Add bundled path at the beginning
      env.PATH = [nodeBinDir, ...filteredPaths].join(pathDelimiter);
      log(`[MCPManager] Prepended bundled Node.js bin to PATH: ${nodeBinDir}`);
    }
    
    log(`[MCPManager] Final PATH: ${env.PATH?.substring(0, 150)}...`);

    // Merge with config env (config env takes precedence)
    return { ...env, ...configEnv };
  }

  /**
   * Initialize MCP servers from configuration
   */
  async initializeServers(configs: MCPServerConfig[]): Promise<void> {
    log('[MCPManager] Initializing', configs.length, 'MCP servers');
    
    // Close existing connections
    await this.disconnectAll();

    // Store configurations
    this.serverConfigs.clear();
    for (const config of configs) {
      this.serverConfigs.set(config.id, config);
    }

    // Connect to enabled servers
    for (const config of configs) {
      if (config.enabled) {
        try {
          await this.connectServer(config);
        } catch (error) {
          logError(`[MCPManager] Failed to connect to server ${config.name}:`, error);
        }
      }
    }

    // Refresh tools from all connected servers
    await this.refreshTools();
  }

  /**
   * Update a single server configuration and reconnect if needed
   * This is more efficient than reinitializing all servers
   */
  async updateServer(config: MCPServerConfig): Promise<void> {
    log(`[MCPManager] Updating server: ${config.name} (enabled: ${config.enabled})`);
    
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
    await this.disconnectServer(serverId);
    this.serverConfigs.delete(serverId);
    await this.refreshTools();
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

    let transport: StdioClientTransport | SSEClientTransport;
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
      const isBuiltinServer = (config.name === 'GUI_Operate' || config.name === 'GUI Operate' || 
                                config.name === 'Software_Development' || config.name === 'Software Development');
      const isOldConfig = (command === 'npx' || command.endsWith('/npx')) && 
                          args.includes('-y') && args.includes('tsx');
      
      if (isBuiltinServer && isOldConfig && app.isPackaged) {
        log(`[MCPManager] Auto-migrating ${config.name} from npx/tsx to node (production mode)`);
        
        // Get bundled node path
        const bundledNode = this.getBundledNodePath();
        if (bundledNode) {
          command = bundledNode.node;
          // Remove '-y', 'tsx' from args, keep only the script path
          args = args.filter(arg => arg !== '-y' && arg !== 'tsx');
          log(`[MCPManager] Updated command: ${command} ${args.join(' ')}`);
        }
      }
      
      args = args.map(arg => {
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
        const tsScript = args.find(a => typeof a === 'string' && a.endsWith('.ts'));
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
      
      // If command is 'npx', check if it's in PATH
      if (command === 'npx' || command.endsWith('/npx')) {
        // Check if npx is in PATH, throw error if not found
        await this.checkNpxInPath();
        
        // Use the resolved npx path
        if (this.npxPath) {
          command = this.npxPath;
          log(`[MCPManager] Using npx from PATH: ${command}`);
        }
      }
      
      // Store for error logging
      commandForLogging = command;
      argsForLogging = args;
      
      // Get environment variables
      const env = await this.getEnhancedEnv(config.env || {});
      
      // In production, set NODE_PATH to include unpacked node_modules
      if (app.isPackaged && isBuiltinServer) {
        const unpackedNodeModules = path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules');
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
      
      // Test if npx can be executed with the current environment
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        log(`[MCPManager] Testing npx execution: ${command} --version`);
        // Quote the command path to handle spaces
        const quotedCommand = `"${command}"`;
        const testResult = await execAsync(`${quotedCommand} --version`, { 
          timeout: 5000,
          env: env
        });
        log(`[MCPManager] npx test successful: ${testResult.stdout.trim()}`);
      } catch (testError: any) {
        logError(`[MCPManager] npx test failed: ${testError.message}`);
        if (testError.stderr) {
          logError(`[MCPManager] npx test stderr: ${testError.stderr}`);
        }
        logError(`[MCPManager] This indicates npx cannot run with the current environment`);
      }

      // Create STDIO transport - it will spawn the process internally
      transport = new StdioClientTransport({
        command,
        args,
        env,
      });
      
      log(`[MCPManager] STDIO transport created successfully`);
      
      // IMPORTANT: Wait a bit for the process to spawn
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Try to capture stderr from the spawned process for debugging
      try {
        const transportAny = transport as any;
        if (transportAny._process) {
          const process = transportAny._process;
          log(`[MCPManager] MCP server process spawned with PID: ${process.pid}`);
          
          // Capture stdout for debugging
          if (process.stdout) {
            process.stdout.on('data', (data: Buffer) => {
              const message = data.toString().trim();
              if (message) {
                log(`[MCPManager] MCP server stdout: ${message}`);
              }
            });
          }
          
          // Listen to stderr for error messages
          if (process.stderr) {
            process.stderr.on('data', (data: Buffer) => {
              const message = data.toString().trim();
              if (message) {
                logError(`[MCPManager] MCP server stderr: ${message}`);
              }
            });
          }
          
          // Listen to process exit
          process.on('exit', (code: number, signal: string) => {
            if (code !== null && code !== 0) {
              logError(`[MCPManager] MCP server process exited with code ${code}`);
            } else if (signal) {
              logError(`[MCPManager] MCP server process killed with signal ${signal}`);
            } else {
              log(`[MCPManager] MCP server process exited normally`);
            }
          });
          
          process.on('error', (error: Error) => {
            logError(`[MCPManager] MCP server process error: ${error.message}`);
            logError(`[MCPManager] Error stack: ${error.stack}`);
          });
        } else {
          logWarn(`[MCPManager] Could not access transport._process, it may not be spawned yet`);
        }
      } catch (e: any) {
        // Ignore if we can't access internal process
        logWarn(`[MCPManager] Could not attach to MCP server process for logging: ${e.message}`);
      }
    } else if (config.type === 'sse') {
      if (!config.url) {
        throw new Error(`SSE server ${config.name} requires a URL`);
      }

      // Create SSE transport
      transport = new SSEClientTransport(
        new URL(config.url),
        config.headers || {}
      );
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
      // Connect (client.connect() will automatically call transport.start())
      await client.connect(transport);
      log(`[MCPManager] Client.connect() completed successfully`);
    } catch (error: any) {
      logError(`[MCPManager] Client.connect() failed:`, error);
      logError(`[MCPManager] Error details - code: ${error.code}, name: ${error.name}, message: ${error.message}`);
      
      // Try to get more details from the transport
      if (config.type === 'stdio' && commandForLogging) {
        logError(`[MCPManager] STDIO transport may have failed to spawn process or communicate`);
        logError(`[MCPManager] Command was: ${commandForLogging} ${argsForLogging.join(' ')}`);
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
    } catch (error: any) {
      log(`[MCPManager] Chrome debug port check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Wait for Chrome debugging port to become ready with retries
   */
  private async waitForChromeDebugPort(maxRetries: number = 15, delayMs: number = 1000): Promise<boolean> {
    log(`[MCPManager] Waiting for Chrome debug port (max ${maxRetries} retries)...`);
    
    for (let i = 0; i < maxRetries; i++) {
      const isReady = await this.isChromeDebugPortReady();
      if (isReady) {
        log(`[MCPManager] Chrome debug port ready ✓ (attempt ${i + 1})`);
        return true;
      }
      
      if (i < maxRetries - 1) {
        log(`[MCPManager] Port not ready, retrying in ${delayMs}ms... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
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
  private async ensureChromeReady(_serverId: string, serverName: string, client: Client): Promise<void> {
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
      } catch (error: any) {
        logWarn(`[MCPManager] ⚠️ Port accessible but tool call failed`);
        logWarn(`[MCPManager] Error code: ${error.code}, message: ${error.message}`);
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
        return;
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
        } catch (verifyError: any) {
          if (i < 4) {
            log(`[MCPManager] Connection verification attempt ${i + 1}/5 failed, retrying...`);
            log(`[MCPManager] Error: ${verifyError.message}`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            logError(`[MCPManager] ❌ Chrome started but MCP connection verification failed after 5 attempts`);
            logError(`[MCPManager] Last error code: ${verifyError.code}, message: ${verifyError.message}`);
            logError(`[MCPManager] The chrome-devtools-mcp server may not be working correctly`);
          }
        }
      }
    } catch (startError: any) {
      logError(`[MCPManager] ❌ Failed to start Chrome with debugging`);
      logError(`[MCPManager] Error: ${startError.message || startError}`);
    }
  }

  /**
   * Get Chrome user data directory for remote debugging
   * Chrome 136+ requires --user-data-dir for remote debugging to work properly
   */
  private getChromeUserDataDir(): string {
    const os = require('os');
    const path = require('path');
    return path.join(os.tmpdir(), 'chrome-mcp-debug');
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
    const { exec } = await import('child_process');
    const os = await import('os');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    const platform = os.platform();
    const userDataDir = this.getChromeUserDataDir();
    let startupCommand: string;
    
    log(`[MCPManager] Platform: ${platform}`);
    log(`[MCPManager] User data dir: ${userDataDir}`);
    
    // Chrome 136+ requires --user-data-dir for remote debugging
    // Without it, --remote-debugging-port may be ignored
    
    if (platform === 'darwin') {
      // macOS: Start Chrome with dedicated profile
      const escapedPath = userDataDir.replace(/'/g, "'\\''");
      startupCommand = `
        /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \
          --remote-debugging-port=9222 \
          --user-data-dir='${escapedPath}' \
          --no-first-run \
          --no-default-browser-check \
          --new-window \
          about:blank \
          > /dev/null 2>&1 &
      `.replace(/\s+/g, ' ').trim();
    } else if (platform === 'win32') {
      // Windows: Start Chrome with dedicated profile
      const winPath = userDataDir.replace(/\\/g, '\\\\');
      startupCommand = `
        start "" "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" 
          --remote-debugging-port=9222 
          --user-data-dir="${winPath}" 
          --no-first-run 
          --no-default-browser-check 
          --new-window 
          about:blank
      `.replace(/\s+/g, ' ').trim();
    } else {
      // Linux: Start Chrome with dedicated profile
      const escapedPath = userDataDir.replace(/'/g, "'\\''");
      startupCommand = `
        google-chrome \
          --remote-debugging-port=9222 \
          --user-data-dir='${escapedPath}' \
          --no-first-run \
          --no-default-browser-check \
          --new-window \
          about:blank \
          > /dev/null 2>&1 &
      `.replace(/\s+/g, ' ').trim();
    }

    log(`[MCPManager] Chrome startup command: ${startupCommand}`);

    try {
      const shellPath = platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : '/bin/sh';
      log(`[MCPManager] Using shell: ${shellPath}`);
      
      const result = await execAsync(startupCommand, {
        shell: shellPath,
        timeout: 10000,
      });
      
      log(`[MCPManager] Chrome command executed successfully`);
      if (result.stdout) {
        log(`[MCPManager] stdout: ${result.stdout}`);
      }
      if (result.stderr) {
        log(`[MCPManager] stderr: ${result.stderr}`);
      }
    } catch (error: any) {
      logWarn(`[MCPManager] Chrome startup command completed with warning`);
      logWarn(`[MCPManager] Error message: ${error.message}`);
      if (error.stdout) {
        log(`[MCPManager] stdout: ${error.stdout}`);
      }
      if (error.stderr) {
        log(`[MCPManager] stderr: ${error.stderr}`);
      }
    }
  }

  /**
   * Disconnect from a specific server
   */
  async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    const transport = this.transports.get(serverId);
    const process = this.processes.get(serverId);

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

    // Kill process if we're managing it (for legacy compatibility)
    if (process) {
      try {
        process.kill();
      } catch (error) {
        // Process may already be terminated
      }
      this.processes.delete(serverId);
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
    this.tools.clear();

    for (const [serverId, client] of this.clients.entries()) {
      try {
        const config = this.serverConfigs.get(serverId);
        if (!config) continue;

        // Add timeout for listTools call to prevent hanging
        const timeoutMs = 10000; // 10 second timeout
        const listToolsPromise = client.listTools();
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('listTools timeout after 10s')), timeoutMs);
        });

        log(`[MCPManager] Fetching tools from ${config.name} (timeout: ${timeoutMs}ms)...`);
        
        const listToolsResult = await Promise.race([listToolsPromise, timeoutPromise]);
        
        log(`[MCPManager] Raw tools from ${config.name}:`, listToolsResult);
        
        for (const tool of listToolsResult.tools) {
          // Prefix tool name with server name to avoid conflicts
          // Format: mcp__<ServerName>__<toolName> (double underscores, preserve case)
          const serverKey = config.name.replace(/\s+/g, '_');
          const prefixedName = `mcp__${serverKey}__${tool.name}`;
          
          this.tools.set(prefixedName, {
            name: prefixedName,
            description: tool.description || '',
            inputSchema: {
              type: 'object',
              properties: (tool.inputSchema as any)?.properties || {},
              required: (tool.inputSchema as any)?.required,
            },
            serverId,
            serverName: config.name,
          });
        }

        log(`[MCPManager] ✓ Loaded ${listToolsResult.tools.length} tools from ${config.name}`);
      } catch (error: any) {
        logError(`[MCPManager] ❌ Error listing tools from ${serverId}:`, error.message || error);
        // If Chrome server, try to reconnect
        const config = this.serverConfigs.get(serverId);
        if (config && config.name.toLowerCase().includes('chrome')) {
          log(`[MCPManager] Chrome server may need reconnection. Trying to refresh...`);
        }
      }
    }

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
  async callTool(toolName: string, args: Record<string, any>): Promise<any> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`MCP tool not found: ${toolName}`);
    }

    const client = this.clients.get(tool.serverId);
    if (!client) {
      throw new Error(`MCP server not connected: ${tool.serverId}`);
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

    log(`[MCPManager] Calling tool ${actualToolName} on server ${tool.serverName}`);

    const maxRetries = 2;
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Add timeout for tool call
        const timeoutMs = 30000; // 30 second timeout
        const callPromise = client.callTool({
          name: actualToolName,
          arguments: args,
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Tool call timeout after ${timeoutMs}ms`)), timeoutMs);
        });

        const result = await Promise.race([callPromise, timeoutPromise]);
        return result;
      } catch (error: any) {
        lastError = error;
        const errorMsg = error.message || String(error);
        logError(`[MCPManager] Error calling tool ${toolName} (attempt ${attempt + 1}/${maxRetries + 1}):`, errorMsg);
        
        // If connection closed, try to reconnect
        if (errorMsg.includes('Connection closed') || errorMsg.includes('timeout')) {
          if (attempt < maxRetries) {
            log(`[MCPManager] Connection issue detected, waiting before retry...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } else {
          // For other errors, don't retry
          break;
        }
      }
    }

    throw lastError;
  }

  /**
   * Get server status
   */
  getServerStatus(): Array<{ id: string; name: string; connected: boolean; toolCount: number }> {
    const status: Array<{ id: string; name: string; connected: boolean; toolCount: number }> = [];

    for (const [serverId, config] of this.serverConfigs.entries()) {
      const connected = this.clients.has(serverId);
      const toolCount = Array.from(this.tools.values()).filter(
        (tool) => tool.serverId === serverId
      ).length;

      status.push({
        id: serverId,
        name: config.name,
        connected,
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
