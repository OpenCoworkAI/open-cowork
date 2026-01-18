import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

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

  /**
   * Initialize MCP servers from configuration
   */
  async initializeServers(configs: MCPServerConfig[]): Promise<void> {
    console.log('[MCPManager] Initializing', configs.length, 'MCP servers');
    
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
          console.error(`[MCPManager] Failed to connect to server ${config.name}:`, error);
        }
      }
    }

    // Refresh tools from all connected servers
    await this.refreshTools();
  }

  /**
   * Connect to a single MCP server
   */
  private async connectServer(config: MCPServerConfig): Promise<void> {
    console.log(`[MCPManager] Connecting to MCP server: ${config.name} (${config.type})`);

    let transport: StdioClientTransport | SSEClientTransport;

    if (config.type === 'stdio') {
      if (!config.command) {
        throw new Error(`STDIO server ${config.name} requires a command`);
      }

      const command = config.command;
      const args = config.args || [];
      const env = { ...process.env, ...(config.env || {}) } as Record<string, string>;

      console.log(`[MCPManager] Creating STDIO transport: ${command} ${args.join(' ')}`);

      // Create STDIO transport - it will spawn the process internally
      transport = new StdioClientTransport({
        command,
        args,
        env,
      });
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

    // Connect (client.connect() will automatically call transport.start())
    await client.connect(transport);

    // Store client and transport
    this.clients.set(config.id, client);
    this.transports.set(config.id, transport);

    console.log(`[MCPManager] Connected to ${config.name}`);

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
      const response = await fetch('http://localhost:9222/json/version', {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Wait for Chrome debugging port to become ready with retries
   */
  private async waitForChromeDebugPort(maxRetries: number = 15, delayMs: number = 1000): Promise<boolean> {
    console.log(`[MCPManager] Waiting for Chrome debug port (max ${maxRetries} retries)...`);
    
    for (let i = 0; i < maxRetries; i++) {
      const isReady = await this.isChromeDebugPortReady();
      if (isReady) {
        console.log(`[MCPManager] Chrome debug port ready ✓ (attempt ${i + 1})`);
        return true;
      }
      
      if (i < maxRetries - 1) {
        console.log(`[MCPManager] Port not ready, retrying in ${delayMs}ms... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    console.warn(`[MCPManager] Chrome debug port not ready after ${maxRetries} attempts`);
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
    console.log(`[MCPManager] Ensuring Chrome is ready for ${serverName}...`);
    
    // Step 1: Check if debugging port is accessible
    const portReady = await this.isChromeDebugPortReady();
    
    if (portReady) {
      console.log(`[MCPManager] Chrome debug port (9222) is accessible`);
      
      // Verify tool connection works
      try {
        await client.callTool({
          name: 'list_pages',
          arguments: {},
        });
        console.log(`[MCPManager] ✓ Chrome connected, using existing instance`);
        return;
      } catch (error: any) {
        console.warn(`[MCPManager] Port accessible but tool call failed:`, error.message);
        console.log(`[MCPManager] Starting new Chrome instance...`);
      }
    } else {
      console.log(`[MCPManager] Chrome debug port (9222) not accessible, starting new instance...`);
    }
    
    // Step 2: Start Chrome with remote debugging
    try {
      await this.startChromeWithDebugging();
      
      // Wait for Chrome debugging port to become ready
      const portBecameReady = await this.waitForChromeDebugPort(15, 1000);
      
      if (!portBecameReady) {
        console.error(`[MCPManager] ❌ Chrome startup failed or debug port not ready`);
        return;
      }
      
      // Verify tool connection
      console.log(`[MCPManager] Verifying tool connection...`);
      for (let i = 0; i < 5; i++) {
        try {
          await client.callTool({
            name: 'list_pages',
            arguments: {},
          });
          console.log(`[MCPManager] ✓ Chrome started and ready!`);
          return;
        } catch (verifyError: any) {
          if (i < 4) {
            console.log(`[MCPManager] Verifying connection... (${i + 1}/5)`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            console.warn(`[MCPManager] ⚠️ Chrome started but verification failed:`, verifyError.message);
          }
        }
      }
    } catch (startError: any) {
      console.error(`[MCPManager] ❌ Failed to start Chrome:`, startError.message || startError);
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

    console.log(`[MCPManager] Starting Chrome with remote debugging...`);
    console.log(`[MCPManager] User data dir: ${userDataDir}`);
    console.log(`[MCPManager] Command: ${startupCommand}`);

    try {
      const shellPath = platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : '/bin/sh';
      await execAsync(startupCommand, {
        shell: shellPath,
        timeout: 10000,
      });
      console.log(`[MCPManager] Chrome command executed successfully`);
    } catch (error: any) {
      console.warn(`[MCPManager] Chrome startup command completed with warning:`, error.message);
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
        console.error(`[MCPManager] Error closing client for ${serverId}:`, error);
      }
      this.clients.delete(serverId);
    }

    if (transport) {
      try {
        await transport.close();
      } catch (error) {
        console.error(`[MCPManager] Error closing transport for ${serverId}:`, error);
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

    console.log(`[MCPManager] Disconnected from server ${serverId}`);
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
    console.log('[MCPManager] Refreshing tools from all servers');
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

        console.log(`[MCPManager] Fetching tools from ${config.name} (timeout: ${timeoutMs}ms)...`);
        
        const listToolsResult = await Promise.race([listToolsPromise, timeoutPromise]);
        
        console.log(`[MCPManager] Raw tools from ${config.name}:`, listToolsResult);
        
        for (const tool of listToolsResult.tools) {
          // Prefix tool name with server name to avoid conflicts
          const prefixedName = `mcp_${config.name.toLowerCase().replace(/\s+/g, '_')}_${tool.name}`;
          
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

        console.log(`[MCPManager] ✓ Loaded ${listToolsResult.tools.length} tools from ${config.name}`);
      } catch (error: any) {
        console.error(`[MCPManager] ❌ Error listing tools from ${serverId}:`, error.message || error);
        // If Chrome server, try to reconnect
        const config = this.serverConfigs.get(serverId);
        if (config && config.name.toLowerCase().includes('chrome')) {
          console.log(`[MCPManager] Chrome server may need reconnection. Trying to refresh...`);
        }
      }
    }

    console.log(`[MCPManager] Total tools available: ${this.tools.size}`);
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

    // Extract the actual tool name (remove prefix)
    const actualToolName = toolName.replace(/^mcp_[^_]+_/, '');

    console.log(`[MCPManager] Calling tool ${actualToolName} on server ${tool.serverName}`);

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
        console.error(`[MCPManager] Error calling tool ${toolName} (attempt ${attempt + 1}/${maxRetries + 1}):`, errorMsg);
        
        // If connection closed, try to reconnect
        if (errorMsg.includes('Connection closed') || errorMsg.includes('timeout')) {
          if (attempt < maxRetries) {
            console.log(`[MCPManager] Connection issue detected, waiting before retry...`);
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
