/**
 * Sandbox Adapter - Platform-aware sandbox execution layer
 * 
 * Automatically selects the appropriate executor based on platform:
 * - Windows: Uses WSL2 for isolated execution
 * - Mac/Linux: Uses native execution (with warnings)
 * 
 * Provides a unified interface for:
 * - Command execution
 * - File operations
 * - Path resolution
 */

import { dialog, BrowserWindow } from 'electron';
import { log, logWarn, logError } from '../utils/logger';
import { WSLBridge, pathConverter } from './wsl-bridge';
import { LimaBridge, limaPathConverter } from './lima-bridge';
import { NativeExecutor } from './native-executor';
import { getSandboxBootstrap } from './sandbox-bootstrap';
import type {
  SandboxConfig,
  SandboxExecutor,
  ExecutionResult,
  DirectoryEntry,
  WSLStatus,
  LimaStatus,
  PathConverter,
} from './types';

export type SandboxMode = 'wsl' | 'lima' | 'native' | 'none';

export interface SandboxAdapterConfig extends SandboxConfig {
  /** Force native execution even on Windows (not recommended) */
  forceNative?: boolean;
  /** Skip WSL installation prompts */
  skipInstallPrompts?: boolean;
  /** Main window for dialogs */
  mainWindow?: BrowserWindow | null;
}

interface SandboxState {
  mode: SandboxMode;
  wslStatus?: WSLStatus;
  limaStatus?: LimaStatus;
  initialized: boolean;
  workspacePath: string;
}

/**
 * Sandbox Adapter - Unified sandbox execution interface
 */
export class SandboxAdapter implements SandboxExecutor {
  private executor: SandboxExecutor | null = null;
  private state: SandboxState = {
    mode: 'none',
    initialized: false,
    workspacePath: '',
  };
  // @ts-expect-error Reserved for future use
  private _config: SandboxAdapterConfig | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Get current sandbox mode
   */
  get mode(): SandboxMode {
    return this.state.mode;
  }

  /**
   * Check if sandbox is using WSL
   */
  get isWSL(): boolean {
    return this.state.mode === 'wsl';
  }

  /**
   * Check if sandbox is using Lima
   */
  get isLima(): boolean {
    return this.state.mode === 'lima';
  }

  /**
   * Check if sandbox is initialized
   */
  get initialized(): boolean {
    return this.state.initialized;
  }

  /**
   * Get WSL status (if applicable)
   */
  get wslStatus(): WSLStatus | undefined {
    return this.state.wslStatus;
  }

  /**
   * Get Lima status (if applicable)
   */
  get limaStatus(): LimaStatus | undefined {
    return this.state.limaStatus;
  }

  /**
   * Initialize the sandbox adapter
   */
  async initialize(config: SandboxAdapterConfig): Promise<void> {
    // Prevent multiple initializations
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._initialize(config);
    return this.initPromise;
  }

  private async _initialize(config: SandboxAdapterConfig): Promise<void> {
    this._config = config;
    this.state.workspacePath = config.workspacePath;

    const platform = process.platform;
    log('[SandboxAdapter] Initializing on platform:', platform);

    if (platform === 'win32' && !config.forceNative) {
      // Windows: Try to use WSL2
      await this.initializeWSL(config);
    } else if (platform === 'darwin' && !config.forceNative) {
      // macOS: Try to use Lima
      await this.initializeLima(config);
    } else {
      // Linux or force native: Use native execution
      await this.initializeNative(config);
    }

    this.state.initialized = true;
    log('[SandboxAdapter] Initialized with mode:', this.state.mode);
  }

  /**
   * Initialize WSL-based sandbox (Windows)
   */
  private async initializeWSL(config: SandboxAdapterConfig): Promise<void> {
    log('[SandboxAdapter] Checking WSL2 availability...');
    
    // Try to use cached status from bootstrap first (much faster)
    const bootstrap = getSandboxBootstrap();
    let wslStatus = bootstrap.getCachedWSLStatus();
    
    if (wslStatus) {
      log('[SandboxAdapter] Using cached WSL status from bootstrap');
    } else {
      log('[SandboxAdapter] No cached status, checking WSL...');
      wslStatus = await WSLBridge.checkWSLStatus();
    }
    
    this.state.wslStatus = wslStatus;

    log('[SandboxAdapter] WSL Status:', JSON.stringify(wslStatus, null, 2));

    if (!wslStatus.available) {
      // WSL not available - show warning and fallback to native
      log('[SandboxAdapter] [X] WSL2 not available');
      await this.showWSLNotAvailableWarning(config);
      await this.initializeNative(config);
      return;
    }

    log('[SandboxAdapter] [OK] WSL2 detected');
    log('[SandboxAdapter]   Distro:', wslStatus.distro);
    log('[SandboxAdapter]   Node.js:', wslStatus.nodeAvailable ? `[OK] ${wslStatus.version || 'available'}` : '[X] not found');
    log('[SandboxAdapter]   Python:', wslStatus.pythonAvailable ? `[OK] ${wslStatus.pythonVersion || 'available'}` : '[X] not found');
    log('[SandboxAdapter]   claude-code:', wslStatus.claudeCodeAvailable ? '[OK] available' : '[!] not in WSL (using Windows)');

    // Check if Node.js needs to be installed
    if (!wslStatus.nodeAvailable) {
      if (!config.skipInstallPrompts) {
        const shouldInstall = await this.showNodeInstallPrompt(config, wslStatus.distro!);
        if (!shouldInstall) {
          await this.initializeNative(config);
          return;
        }
      }

      log('[SandboxAdapter] Installing Node.js in WSL...');
      const installed = await WSLBridge.installNodeInWSL(wslStatus.distro!);
      if (!installed) {
        logError('[SandboxAdapter] Failed to install Node.js in WSL');
        await this.showInstallFailedWarning(config, 'Node.js');
        await this.initializeNative(config);
        return;
      }
      wslStatus.nodeAvailable = true;
    }

    // claude-code in WSL is NOT needed - we use Windows-side claude-code
    // WSL sandbox is only for command execution (Bash, file operations)
    if (!wslStatus.claudeCodeAvailable) {
      log('[SandboxAdapter] claude-code not in WSL (not needed - Windows claude-code is used)');
    }

    // Initialize WSL Bridge
    try {
      const wslBridge = new WSLBridge();
      await wslBridge.initialize(config);
      
      this.executor = wslBridge;
      this.state.mode = 'wsl';
      log('[SandboxAdapter] [OK] WSL sandbox initialized successfully');
      log('[SandboxAdapter] =============================================');
      log('[SandboxAdapter] SANDBOX MODE: WSL (Isolated Linux Environment)');
      log('[SandboxAdapter] =============================================');
    } catch (error) {
      logError('[SandboxAdapter] ✗ Failed to initialize WSL bridge:', error);
      await this.showWSLInitFailedWarning(config, error);
      await this.initializeNative(config);
    }
  }

  /**
   * Initialize Lima-based sandbox (macOS)
   */
  private async initializeLima(config: SandboxAdapterConfig): Promise<void> {
    log('[SandboxAdapter] Checking Lima availability...');

    // Try to use cached status from bootstrap first (much faster)
    const bootstrap = getSandboxBootstrap();
    let limaStatus = bootstrap.getCachedLimaStatus();
    
    if (limaStatus) {
      log('[SandboxAdapter] Using cached Lima status from bootstrap');
    } else {
      log('[SandboxAdapter] No cached status, checking Lima...');
      limaStatus = await LimaBridge.checkLimaStatus();
    }
    
    this.state.limaStatus = limaStatus;

    log('[SandboxAdapter] Lima Status:', JSON.stringify(limaStatus, null, 2));

    if (!limaStatus.available) {
      log('[SandboxAdapter] [X] Lima not available');
      await this.showLimaNotAvailableWarning(config);
      await this.initializeNative(config);
      return;
    }

    log('[SandboxAdapter] [OK] Lima detected');
    log('[SandboxAdapter]   Instance:', limaStatus.instanceName || 'claude-sandbox');
    log('[SandboxAdapter]   Exists:', limaStatus.instanceExists ? '[OK]' : '[X] not created');
    log('[SandboxAdapter]   Running:', limaStatus.instanceRunning ? '[OK]' : '[X] not running');
    log('[SandboxAdapter]   Node.js:', limaStatus.nodeAvailable ? `[OK] ${limaStatus.version || 'available'}` : '[X] not found');
    log('[SandboxAdapter]   Python:', limaStatus.pythonAvailable ? `[OK] ${limaStatus.pythonVersion || 'available'}` : '[X] not found');

    // Initialize Lima Bridge
    try {
      const limaBridge = new LimaBridge();
      await limaBridge.initialize(config);

      this.executor = limaBridge;
      this.state.mode = 'lima';
      log('[SandboxAdapter] [OK] Lima sandbox initialized successfully');
      log('[SandboxAdapter] =============================================');
      log('[SandboxAdapter] SANDBOX MODE: Lima (Isolated Linux Environment)');
      log('[SandboxAdapter] =============================================');
    } catch (error) {
      logError('[SandboxAdapter] Failed to initialize Lima bridge:', error);
      await this.showLimaInitFailedWarning(config, error);
      await this.initializeNative(config);
    }
  }

  /**
   * Initialize native execution (Mac/Linux/fallback)
   */
  private async initializeNative(config: SandboxAdapterConfig): Promise<void> {
    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    if (isWindows) {
      // On Windows without WSL, show security warning
      await this.showNativeFallbackWarning(config);
    }

    const nativeExecutor = new NativeExecutor();
    await nativeExecutor.initialize(config);

    this.executor = nativeExecutor;
    this.state.mode = 'native';

    log('[SandboxAdapter] =============================================');
    if (isWindows) {
      log('[SandboxAdapter] [!] SANDBOX MODE: Native (Windows - No WSL Isolation)');
    } else if (isMac) {
      log('[SandboxAdapter] SANDBOX MODE: Native (macOS - No Lima Isolation)');
    } else {
      log('[SandboxAdapter] SANDBOX MODE: Native (Linux)');
    }
    log('[SandboxAdapter] =============================================');
  }

  // ==================== Warning Dialogs ====================

  private async showWSLNotAvailableWarning(config: SandboxAdapterConfig): Promise<void> {
    if (!config.mainWindow) {
      logWarn('[SandboxAdapter] WSL2 not available, no window to show dialog');
      return;
    }

    await dialog.showMessageBox(config.mainWindow, {
      type: 'warning',
      title: 'WSL2 Not Available',
      message: 'Windows Subsystem for Linux (WSL2) is not installed on this system.',
      detail: 'For better security, we recommend installing WSL2. ' +
        'Commands will be executed directly on Windows without sandbox isolation.\n\n' +
        'To install WSL2, run this command in PowerShell as Administrator:\n' +
        'wsl --install\n\n' +
        'Then restart your computer.',
      buttons: ['Continue Anyway'],
    });
  }

  private async showNodeInstallPrompt(
    config: SandboxAdapterConfig,
    distro: string
  ): Promise<boolean> {
    if (!config.mainWindow) {
      return true; // Auto-install if no window
    }

    const result = await dialog.showMessageBox(config.mainWindow, {
      type: 'question',
      title: 'Install Node.js in WSL',
      message: `Node.js is not installed in ${distro}.`,
      detail: 'Node.js is required for the sandbox environment. ' +
        'Would you like to install it automatically?',
      buttons: ['Install', 'Skip (use native execution)'],
      defaultId: 0,
    });

    return result.response === 0;
  }

  // @ts-expect-error Reserved for future use
  private async _showClaudeCodeInstallPrompt(
    config: SandboxAdapterConfig,
    distro: string
  ): Promise<boolean> {
    if (!config.mainWindow) {
      return true; // Auto-install if no window
    }

    const result = await dialog.showMessageBox(config.mainWindow, {
      type: 'question',
      title: 'Install claude-code in WSL',
      message: `Claude Code is not installed in ${distro}.`,
      detail: 'Claude Code is required for AI agent functionality. ' +
        'Would you like to install it automatically?',
      buttons: ['Install', 'Skip (use native execution)'],
      defaultId: 0,
    });

    return result.response === 0;
  }

  private async showInstallFailedWarning(
    config: SandboxAdapterConfig,
    packageName: string
  ): Promise<void> {
    if (!config.mainWindow) {
      logWarn(`[SandboxAdapter] ${packageName} installation failed, no window to show dialog`);
      return;
    }

    await dialog.showMessageBox(config.mainWindow, {
      type: 'warning',
      title: 'Installation Failed',
      message: `Failed to install ${packageName} in WSL.`,
      detail: 'Please try installing it manually. Commands will be executed ' +
        'directly on Windows without sandbox isolation.',
      buttons: ['OK'],
    });
  }

  private async showWSLInitFailedWarning(
    config: SandboxAdapterConfig,
    error: unknown
  ): Promise<void> {
    if (!config.mainWindow) {
      logWarn('[SandboxAdapter] WSL init failed, no window to show dialog');
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    await dialog.showMessageBox(config.mainWindow, {
      type: 'warning',
      title: 'WSL Initialization Failed',
      message: 'Failed to initialize WSL sandbox.',
      detail: `Error: ${errorMessage}\n\n` +
        'Commands will be executed directly on Windows without sandbox isolation.',
      buttons: ['OK'],
    });
  }

  private async showNativeFallbackWarning(config: SandboxAdapterConfig): Promise<void> {
    if (!config.mainWindow) {
      logWarn('[SandboxAdapter] Falling back to native execution, no window to show dialog');
      return;
    }

    await dialog.showMessageBox(config.mainWindow, {
      type: 'warning',
      title: 'Security Warning',
      message: 'Running without sandbox isolation.',
      detail: 'Commands will be executed directly on your system without ' +
        'WSL sandbox protection. This is less secure.\n\n' +
        'Only use this mode with trusted AI agents and workspaces.',
      buttons: ['I Understand'],
    });
  }

  private async showLimaNotAvailableWarning(config: SandboxAdapterConfig): Promise<void> {
    if (!config.mainWindow) {
      logWarn('[SandboxAdapter] Lima not available, no window to show dialog');
      return;
    }

    await dialog.showMessageBox(config.mainWindow, {
      type: 'warning',
      title: 'Lima Not Available',
      message: 'Lima is not installed on this system.',
      detail: 'For better security, we recommend installing Lima for isolated execution.\n\n' +
        'To install Lima, run:\n' +
        'brew install lima\n\n' +
        'Commands will be executed directly on macOS without sandbox isolation.',
      buttons: ['Continue Anyway'],
    });
  }

  private async showLimaInitFailedWarning(
    config: SandboxAdapterConfig,
    error: unknown
  ): Promise<void> {
    if (!config.mainWindow) {
      logWarn('[SandboxAdapter] Lima init failed, no window to show dialog');
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    await dialog.showMessageBox(config.mainWindow, {
      type: 'warning',
      title: 'Lima Initialization Failed',
      message: 'Failed to initialize Lima sandbox.',
      detail: `Error: ${errorMessage}\n\n` +
        'Commands will be executed directly on macOS without sandbox isolation.',
      buttons: ['OK'],
    });
  }

  // ==================== Executor Interface ====================

  /**
   * Execute a shell command
   */
  async executeCommand(
    command: string,
    cwd?: string,
    env?: Record<string, string>
  ): Promise<ExecutionResult> {
    if (!this.executor) {
      throw new Error('Sandbox not initialized');
    }

    return this.executor.executeCommand(command, cwd, env);
  }

  /**
   * Read a file
   */
  async readFile(filePath: string): Promise<string> {
    if (!this.executor) {
      throw new Error('Sandbox not initialized');
    }

    return this.executor.readFile(filePath);
  }

  /**
   * Write a file
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    if (!this.executor) {
      throw new Error('Sandbox not initialized');
    }

    return this.executor.writeFile(filePath, content);
  }

  /**
   * List directory contents
   */
  async listDirectory(dirPath: string): Promise<DirectoryEntry[]> {
    if (!this.executor) {
      throw new Error('Sandbox not initialized');
    }

    return this.executor.listDirectory(dirPath);
  }

  /**
   * Check if file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    if (!this.executor) {
      throw new Error('Sandbox not initialized');
    }

    return this.executor.fileExists(filePath);
  }

  /**
   * Delete a file
   */
  async deleteFile(filePath: string): Promise<void> {
    if (!this.executor) {
      throw new Error('Sandbox not initialized');
    }

    return this.executor.deleteFile(filePath);
  }

  /**
   * Create a directory
   */
  async createDirectory(dirPath: string): Promise<void> {
    if (!this.executor) {
      throw new Error('Sandbox not initialized');
    }

    return this.executor.createDirectory(dirPath);
  }

  /**
   * Copy a file
   */
  async copyFile(src: string, dest: string): Promise<void> {
    if (!this.executor) {
      throw new Error('Sandbox not initialized');
    }

    return this.executor.copyFile(src, dest);
  }

  /**
   * Shutdown the sandbox
   */
  async shutdown(): Promise<void> {
    if (this.executor) {
      await this.executor.shutdown();
      this.executor = null;
    }

    this.state.initialized = false;
    this.state.mode = 'none';
    this.initPromise = null;
    log('[SandboxAdapter] Shutdown complete');
  }

  // ==================== Path Utilities ====================

  /**
   * Get path converter (for Windows <-> WSL or macOS <-> Lima path conversion)
   */
  getPathConverter(): PathConverter {
    if (this.state.mode === 'lima') {
      return limaPathConverter;
    }
    return pathConverter;
  }

  /**
   * Convert path for current execution environment
   * - On WSL mode: converts Windows paths to WSL paths
   * - On Lima mode: paths are the same (Lima mounts /Users directly)
   * - On native mode: returns path as-is
   */
  resolvePath(inputPath: string): string {
    if (this.state.mode === 'wsl') {
      return pathConverter.toWSL(inputPath);
    }
    if (this.state.mode === 'lima') {
      return limaPathConverter.toWSL(inputPath);
    }
    return inputPath;
  }

  /**
   * Convert result path back to host format (if needed)
   */
  unresolveResultPath(resultPath: string): string {
    if (this.state.mode === 'wsl') {
      return pathConverter.toWindows(resultPath);
    }
    if (this.state.mode === 'lima') {
      return limaPathConverter.toWindows(resultPath);
    }
    return resultPath;
  }

  // ==================== Claude Code Integration ====================

  /**
   * Run claude-code in the sandbox
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
    if (!this.executor) {
      throw new Error('Sandbox not initialized');
    }

    if (this.state.mode === 'wsl' && this.executor instanceof WSLBridge) {
      return (this.executor as WSLBridge).runClaudeCode(prompt, options);
    }

    if (this.state.mode === 'lima' && this.executor instanceof LimaBridge) {
      return (this.executor as LimaBridge).runClaudeCode(prompt, options);
    }

    // For native mode, we need to spawn claude-code directly
    // This is a simplified implementation - full streaming would be more complex
    throw new Error('Claude Code execution is only supported in WSL/Lima mode');
  }
}

// Export singleton instance for app-wide use
let globalSandboxAdapter: SandboxAdapter | null = null;

/**
 * Get the global sandbox adapter instance
 */
export function getSandboxAdapter(): SandboxAdapter {
  if (!globalSandboxAdapter) {
    globalSandboxAdapter = new SandboxAdapter();
  }
  return globalSandboxAdapter;
}

/**
 * Initialize the global sandbox adapter
 */
export async function initializeSandbox(config: SandboxAdapterConfig): Promise<SandboxAdapter> {
  const adapter = getSandboxAdapter();
  await adapter.initialize(config);
  return adapter;
}

/**
 * Shutdown the global sandbox adapter
 */
export async function shutdownSandbox(): Promise<void> {
  if (globalSandboxAdapter) {
    await globalSandboxAdapter.shutdown();
    globalSandboxAdapter = null;
  }
}

