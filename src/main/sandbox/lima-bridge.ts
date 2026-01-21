/**
 * Lima Bridge - Communication bridge between macOS and Lima VM
 *
 * Handles:
 * - Lima VM detection and lifecycle management
 * - Node.js installation in Lima
 * - JSON-RPC communication with Lima agent
 * - Path handling (minimal conversion - Lima mounts /Users directly)
 */

import { spawn, exec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { log, logError } from '../utils/logger';
import type {
  LimaStatus,
  SandboxConfig,
  SandboxExecutor,
  ExecutionResult,
  DirectoryEntry,
  JSONRPCRequest,
  JSONRPCResponse,
  PathConverter,
} from './types';

// Import lazily to avoid circular dependency
let getSandboxBootstrap: (() => { getCachedLimaStatus(): LimaStatus | null }) | null = null;
async function loadBootstrap() {
  if (!getSandboxBootstrap) {
    const mod = await import('./sandbox-bootstrap');
    getSandboxBootstrap = mod.getSandboxBootstrap;
  }
  return getSandboxBootstrap();
}

const execAsync = promisify(exec);

const LIMA_INSTANCE_NAME = 'claude-sandbox';

/**
 * Path conversion utilities for macOS <-> Lima
 * Lima mounts /Users at /Users, so conversion is minimal
 */
export const limaPathConverter: PathConverter = {
  /**
   * Convert macOS path to Lima path
   * /Users/username/project -> /Users/username/project (same)
   */
  toWSL(macPath: string): string {
    if (!macPath) return macPath;
    // Lima mounts /Users directly, so paths are the same
    return macPath;
  },

  /**
   * Convert Lima path to macOS path
   * /Users/username/project -> /Users/username/project (same)
   */
  toWindows(limaPath: string): string {
    if (!limaPath) return limaPath;
    return limaPath;
  },
};

// Alias with more appropriate names for Lima
export const pathConverter = limaPathConverter;

/**
 * Lima Bridge - Manages communication with Lima VM
 */
export class LimaBridge implements SandboxExecutor {
  private limaProcess: ChildProcess | null = null;
  private pendingRequests: Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();
  private buffer: string = '';
  private config: SandboxConfig | null = null;
  private isInitialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Check if Lima is available on this system
   */
  static async checkLimaStatus(): Promise<LimaStatus> {
    try {
      // Check if limactl is installed
      try {
        await execAsync('which limactl', { timeout: 5000 });
      } catch {
        log('[Lima] limactl not found - Lima not installed');
        return { available: false };
      }

      log('[Lima] limactl found, checking instances...');

      // Check if our instance exists using limactl list (plain text, more reliable)
      let instanceExists = false;
      let instanceRunning = false;
      try {
        // First try plain text list which is more reliable
        const { stdout } = await execAsync('limactl list', {
          timeout: 10000,
        });
        log('[Lima] limactl list output:', stdout);

        // Parse text output - format is: NAME STATUS SSH CPUS MEMORY DISK DIR
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          if (line.includes(LIMA_INSTANCE_NAME)) {
            instanceExists = true;
            // Check if status is Running
            instanceRunning = line.includes('Running');
            log('[Lima] Instance found:', LIMA_INSTANCE_NAME, 'Running:', instanceRunning);
            break;
          }
        }

        if (!instanceExists) {
          log('[Lima] Instance not found in list');
        }
      } catch (error) {
        log('[Lima] Error checking instances:', error);
        // Try alternative check - see if instance directory exists
        try {
          await execAsync(`limactl info ${LIMA_INSTANCE_NAME}`, { timeout: 5000 });
          instanceExists = true;
          log('[Lima] Instance exists (found via limactl info)');
        } catch {
          log('[Lima] Instance does not exist');
        }
      }

      // If instance is not running, we can't check Node.js/Python yet
      if (!instanceRunning) {
        return {
          available: true,
          instanceExists,
          instanceRunning: false,
          instanceName: LIMA_INSTANCE_NAME,
        };
      }

      // Check if Node.js is available
      let nodeAvailable = false;
      let nodeVersion = '';
      try {
        const { stdout } = await execAsync(
          `limactl shell ${LIMA_INSTANCE_NAME} -- node --version`,
          { timeout: 10000 }
        );
        nodeVersion = stdout.trim();
        if (nodeVersion.startsWith('v')) {
          nodeAvailable = true;
          log('[Lima] Node.js found:', nodeVersion);
        }
      } catch {
        // Try with nvm
        try {
          const { stdout } = await execAsync(
            `limactl shell ${LIMA_INSTANCE_NAME} -- bash -c "source ~/.nvm/nvm.sh 2>/dev/null && node --version"`,
            { timeout: 10000 }
          );
          nodeVersion = stdout.trim();
          if (nodeVersion.startsWith('v')) {
            nodeAvailable = true;
            nodeVersion += ' (nvm)';
            log('[Lima] Node.js found via nvm:', nodeVersion);
          }
        } catch {
          log('[Lima] Node.js not found');
        }
      }

      // Check Python
      let pythonAvailable = false;
      let pipAvailable = false;
      let pythonVersion = '';
      try {
        const { stdout } = await execAsync(
          `limactl shell ${LIMA_INSTANCE_NAME} -- python3 --version`,
          { timeout: 10000 }
        );
        pythonVersion = stdout.trim();
        if (pythonVersion.startsWith('Python')) {
          pythonAvailable = true;
          log('[Lima] Python found:', pythonVersion);

          // Check pip
          try {
            await execAsync(
              `limactl shell ${LIMA_INSTANCE_NAME} -- python3 -m pip --version`,
              { timeout: 10000 }
            );
            pipAvailable = true;
          } catch {
            log('[Lima] pip not available');
          }
        }
      } catch {
        log('[Lima] Python not found');
      }

      // Check claude-code
      let claudeCodeAvailable = false;
      if (nodeAvailable) {
        try {
          await execAsync(
            `limactl shell ${LIMA_INSTANCE_NAME} -- bash -c "source ~/.nvm/nvm.sh 2>/dev/null; which claude"`,
            { timeout: 10000 }
          );
          claudeCodeAvailable = true;
          log('[Lima] claude-code found');
        } catch {
          log('[Lima] claude-code not found');
        }
      }

      return {
        available: true,
        instanceExists,
        instanceRunning,
        instanceName: LIMA_INSTANCE_NAME,
        nodeAvailable,
        pythonAvailable,
        pipAvailable,
        claudeCodeAvailable,
        version: nodeVersion,
        pythonVersion,
      };
    } catch (error) {
      log('[Lima] Error checking status:', error);
      return { available: false };
    }
  }

  /**
   * Create Lima instance if it doesn't exist
   * Returns a promise that resolves when creation is complete
   * Note: This can take several minutes for initial image download
   */
  static async createLimaInstance(): Promise<boolean> {
    // First check if instance already exists
    try {
      const { stdout } = await execAsync('limactl list', { timeout: 5000 });
      if (stdout.includes(LIMA_INSTANCE_NAME)) {
        log('[Lima] Instance already exists, skipping creation');
        return true;
      }
    } catch {
      // Ignore error, proceed with creation
    }

    log('[Lima] Creating instance:', LIMA_INSTANCE_NAME);
    log('[Lima] This may take several minutes for initial image download...');

    return new Promise((resolve) => {
      // Use spawn instead of exec for better control and logging
      // Note: template:ubuntu (not template://ubuntu) for Lima v2.0+
      const limaProcess = spawn(
        'limactl',
        ['create', `--name=${LIMA_INSTANCE_NAME}`, '--mount-writable', 'template:ubuntu'],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );

      limaProcess.stdout?.on('data', (data: Buffer) => {
        log('[Lima Create]', data.toString().trim());
      });

      limaProcess.stderr?.on('data', (data: Buffer) => {
        log('[Lima Create]', data.toString().trim());
      });

      limaProcess.on('close', (code) => {
        if (code === 0) {
          log('[Lima] Instance created successfully');
          resolve(true);
        } else {
          logError('[Lima] Failed to create instance, exit code:', code);
          resolve(false);
        }
      });

      limaProcess.on('error', (error) => {
        logError('[Lima] Failed to create instance:', error);
        resolve(false);
      });

      // Timeout after 10 minutes
      setTimeout(() => {
        log('[Lima] Create timeout - killing process');
        limaProcess.kill();
        resolve(false);
      }, 600000);
    });
  }

  /**
   * Start Lima instance
   */
  static async startLimaInstance(): Promise<boolean> {
    log('[Lima] Starting instance:', LIMA_INSTANCE_NAME);
    log('[Lima] This may take several minutes (first start includes image download)...');

    return new Promise((resolve) => {
      let resolved = false;
      const limaProcess = spawn('limactl', ['start', LIMA_INSTANCE_NAME], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      limaProcess.stdout?.on('data', (data: Buffer) => {
        log('[Lima Start]', data.toString().trim());
      });

      limaProcess.stderr?.on('data', (data: Buffer) => {
        log('[Lima Start]', data.toString().trim());
      });

      limaProcess.on('close', (code) => {
        if (resolved) return;
        resolved = true;
        if (code === 0) {
          log('[Lima] Instance started successfully');
          resolve(true);
        } else {
          logError('[Lima] Failed to start instance, exit code:', code);
          resolve(false);
        }
      });

      limaProcess.on('error', (error) => {
        if (resolved) return;
        resolved = true;
        logError('[Lima] Failed to start instance:', error);
        resolve(false);
      });

      // Timeout after 10 minutes (first start may include image download)
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        log('[Lima] Start timeout - killing process');
        limaProcess.kill();
        resolve(false);
      }, 600000);
    });
  }

  /**
   * Stop Lima instance
   */
  static async stopLimaInstance(): Promise<boolean> {
    log('[Lima] Stopping instance:', LIMA_INSTANCE_NAME);
    try {
      await execAsync(`limactl stop ${LIMA_INSTANCE_NAME}`, {
        timeout: 30000,
      });
      log('[Lima] Instance stopped');
      return true;
    } catch (error) {
      logError('[Lima] Failed to stop instance:', error);
      return false;
    }
  }

  /**
   * Install Node.js in Lima via nvm
   */
  static async installNodeInLima(): Promise<boolean> {
    log('[Lima] Installing Node.js via nvm...');
    try {
      // Install nvm
      await execAsync(
        `limactl shell ${LIMA_INSTANCE_NAME} -- bash -c "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"`,
        { timeout: 120000 }
      );

      // Install Node.js 20
      await execAsync(
        `limactl shell ${LIMA_INSTANCE_NAME} -- bash -c "source ~/.nvm/nvm.sh && nvm install 20 && nvm alias default 20"`,
        { timeout: 180000 }
      );

      // Verify
      const { stdout } = await execAsync(
        `limactl shell ${LIMA_INSTANCE_NAME} -- bash -c "source ~/.nvm/nvm.sh && node --version"`,
        { timeout: 10000 }
      );
      log('[Lima] Node.js installed:', stdout.trim());
      return true;
    } catch (error) {
      logError('[Lima] Failed to install Node.js:', error);
      return false;
    }
  }

  /**
   * Install Python in Lima
   */
  static async installPythonInLima(): Promise<boolean> {
    log('[Lima] Installing Python...');
    try {
      await execAsync(
        `limactl shell ${LIMA_INSTANCE_NAME} -- sudo apt-get update && sudo apt-get install -y python3 python3-pip python3-venv`,
        { timeout: 180000 }
      );

      const { stdout } = await execAsync(
        `limactl shell ${LIMA_INSTANCE_NAME} -- python3 --version`,
        { timeout: 10000 }
      );
      log('[Lima] Python installed:', stdout.trim());
      return true;
    } catch (error) {
      logError('[Lima] Failed to install Python:', error);
      return false;
    }
  }

  /**
   * Install claude-code in Lima
   */
  static async installClaudeCodeInLima(): Promise<boolean> {
    log('[Lima] Installing claude-code...');
    try {
      await execAsync(
        `limactl shell ${LIMA_INSTANCE_NAME} -- bash -c "source ~/.nvm/nvm.sh && npm install -g @anthropic-ai/claude-code"`,
        { timeout: 180000 }
      );
      log('[Lima] claude-code installed');
      return true;
    } catch (error) {
      logError('[Lima] Failed to install claude-code:', error);
      return false;
    }
  }

  /**
   * Get path to Lima agent script
   */
  private getAgentScriptPath(): string {
    const isPackaged = app.isPackaged;
    if (isPackaged) {
      return path.join(process.resourcesPath || '', 'lima-agent', 'index.js');
    } else {
      // Development: __dirname = dist-electron/main, need to go up 2 levels to project root
      return path.join(__dirname, '..', '..', 'dist-lima-agent', 'index.js');
    }
  }

  /**
   * Initialize the Lima bridge
   */
  async initialize(config: SandboxConfig): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this._initialize(config);
    return this.initPromise;
  }

  private async _initialize(config: SandboxConfig): Promise<void> {
    this.config = config;

    // Try to use cached status from bootstrap first (much faster)
    let status: LimaStatus;
    try {
      const bootstrap = await loadBootstrap();
      const cachedStatus = bootstrap.getCachedLimaStatus();
      if (cachedStatus && cachedStatus.available && cachedStatus.instanceRunning) {
        log('[Lima] Using cached status from bootstrap');
        status = cachedStatus;
      } else {
        log('[Lima] No cached status or instance not running, checking Lima...');
        status = await LimaBridge.checkLimaStatus();
      }
    } catch {
      log('[Lima] Bootstrap not available, checking Lima...');
      status = await LimaBridge.checkLimaStatus();
    }

    if (!status.available) {
      throw new Error('Lima is not installed. Please install with: brew install lima');
    }

    // Create instance if needed (should be done by bootstrap)
    if (!status.instanceExists) {
      log('[Lima] Creating new instance...');
      const created = await LimaBridge.createLimaInstance();
      if (!created) {
        throw new Error('Failed to create Lima instance');
      }
    }

    // Start instance if needed (should be done by bootstrap)
    if (!status.instanceRunning) {
      log('[Lima] Starting instance...');
      const started = await LimaBridge.startLimaInstance();
      if (!started) {
        throw new Error('Failed to start Lima instance');
      }
      // Re-check status
      status = await LimaBridge.checkLimaStatus();
    }

    // Dependencies should already be installed by bootstrap
    if (!status.nodeAvailable) {
      log('[Lima] Installing Node.js...');
      const installed = await LimaBridge.installNodeInLima();
      if (!installed) {
        throw new Error('Failed to install Node.js in Lima');
      }
    }

    if (!status.pythonAvailable) {
      log('[Lima] Python not found, installing...');
      const installed = await LimaBridge.installPythonInLima();
      if (!installed) {
        log('[Lima] Failed to install Python (non-critical, continuing...)');
      }
    }

    // Start the Lima agent process
    await this.startAgent();

    // Configure workspace - Lima mounts /Users at /Users, so paths are the same
    await this.sendRequest('setWorkspace', {
      path: config.workspacePath,
      macPath: config.workspacePath,
    });

    this.isInitialized = true;
    log('[Lima] Bridge initialized successfully');
  }

  /**
   * Start the Lima agent process
   */
  private async startAgent(): Promise<void> {
    const agentPath = this.getAgentScriptPath();

    if (!fs.existsSync(agentPath)) {
      throw new Error(`Lima agent script not found: ${agentPath}`);
    }

    log('[Lima] Starting agent from:', agentPath);

    // Start agent inside Lima VM
    // Need to source nvm.sh first since node is installed via nvm
    const nodeCommand = `source ~/.nvm/nvm.sh 2>/dev/null; node "${agentPath}"`;

    this.limaProcess = spawn(
      'limactl',
      ['shell', LIMA_INSTANCE_NAME, '--', 'bash', '-c', nodeCommand],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    // Handle stdout (JSON-RPC responses)
    this.limaProcess.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    // Handle stderr (logging)
    this.limaProcess.stderr?.on('data', (data: Buffer) => {
      log('[Lima Agent]', data.toString().trim());
    });

    // Handle process exit
    this.limaProcess.on('exit', (code, signal) => {
      log('[Lima] Agent process exited:', { code, signal });
      this.limaProcess = null;
      this.isInitialized = false;

      for (const [_id, pending] of this.pendingRequests) {
        pending.reject(new Error('Lima agent process exited'));
        clearTimeout(pending.timeout);
      }
      this.pendingRequests.clear();
    });

    this.limaProcess.on('error', (error) => {
      logError('[Lima] Agent process error:', error);
    });

    // Wait for agent to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Lima agent startup timeout'));
      }, 30000);

      const checkReady = async () => {
        try {
          await this.sendRequest('ping', {});
          clearTimeout(timeout);
          resolve();
        } catch {
          setTimeout(checkReady, 500);
        }
      };

      setTimeout(checkReady, 1000);
    });

    log('[Lima] Agent is ready');
  }

  /**
   * Process incoming data buffer for complete JSON messages
   */
  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response = JSON.parse(line) as JSONRPCResponse;
        const pending = this.pendingRequests.get(response.id);

        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(response.id);

          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (error) {
        logError('[Lima] Failed to parse response:', line, error);
      }
    }
  }

  /**
   * Send a JSON-RPC request to the Lima agent
   */
  private async sendRequest<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number = 60000
  ): Promise<T> {
    if (!this.limaProcess?.stdin) {
      throw new Error('Lima agent not running');
    }

    const id = uuidv4();
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      this.limaProcess!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * Execute a command in Lima
   */
  async executeCommand(
    command: string,
    cwd?: string,
    env?: Record<string, string>
  ): Promise<ExecutionResult> {
    if (!this.isInitialized) {
      throw new Error('Lima bridge not initialized');
    }

    const result = await this.sendRequest<{
      code: number;
      stdout: string;
      stderr: string;
    }>(
      'executeCommand',
      {
        command,
        cwd,
        env,
      },
      this.config?.timeout || 60000
    );

    return {
      success: result.code === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
    };
  }

  /**
   * Read a file from Lima
   */
  async readFile(filePath: string): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('Lima bridge not initialized');
    }

    const result = await this.sendRequest<{ content: string }>('readFile', {
      path: filePath,
    });

    return result.content;
  }

  /**
   * Write a file in Lima
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Lima bridge not initialized');
    }

    await this.sendRequest('writeFile', {
      path: filePath,
      content,
    });
  }

  /**
   * List directory contents
   */
  async listDirectory(dirPath: string): Promise<DirectoryEntry[]> {
    if (!this.isInitialized) {
      throw new Error('Lima bridge not initialized');
    }

    const result = await this.sendRequest<{ entries: DirectoryEntry[] }>('listDirectory', {
      path: dirPath,
    });

    return result.entries;
  }

  /**
   * Check if a file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    if (!this.isInitialized) {
      throw new Error('Lima bridge not initialized');
    }

    const result = await this.sendRequest<{ exists: boolean }>('fileExists', {
      path: filePath,
    });

    return result.exists;
  }

  /**
   * Delete a file
   */
  async deleteFile(filePath: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Lima bridge not initialized');
    }

    await this.sendRequest('deleteFile', { path: filePath });
  }

  /**
   * Create a directory
   */
  async createDirectory(dirPath: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Lima bridge not initialized');
    }

    await this.sendRequest('createDirectory', { path: dirPath });
  }

  /**
   * Copy a file
   */
  async copyFile(src: string, dest: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Lima bridge not initialized');
    }

    await this.sendRequest('copyFile', { src, dest });
  }

  /**
   * Run claude-code in Lima
   */
  async runClaudeCode(
    prompt: string,
    options: {
      cwd?: string;
      model?: string;
      maxTurns?: number;
      systemPrompt?: string;
      env?: Record<string, string>;
    } = {}
  ): Promise<AsyncIterable<unknown>> {
    if (!this.isInitialized) {
      throw new Error('Lima bridge not initialized');
    }

    const result = await this.sendRequest<{ messages: unknown[] }>(
      'runClaudeCode',
      {
        prompt,
        cwd: options.cwd,
        model: options.model,
        maxTurns: options.maxTurns,
        systemPrompt: options.systemPrompt,
        env: options.env,
      },
      300000
    ); // 5 minute timeout for claude-code

    // Convert to async iterable
    return (async function* () {
      for (const msg of result.messages) {
        yield msg;
      }
    })();
  }

  /**
   * Shutdown the Lima bridge
   */
  async shutdown(): Promise<void> {
    if (this.limaProcess) {
      try {
        await this.sendRequest('shutdown', {});
      } catch {
        // Ignore errors during shutdown
      }

      this.limaProcess.kill();
      this.limaProcess = null;
    }

    this.isInitialized = false;
    this.pendingRequests.clear();
    log('[Lima] Bridge shutdown complete');
  }

  /**
   * Get path converter for external use
   */
  getPathConverter(): PathConverter {
    return limaPathConverter;
  }

  /**
   * Check if bridge is initialized
   */
  get initialized(): boolean {
    return this.isInitialized;
  }
}
