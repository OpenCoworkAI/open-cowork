/**
 * Sandbox Bootstrap Service
 * 
 * Handles early sandbox initialization at app startup
 * Provides progress feedback to the renderer process
 * Caches status to avoid repeated slow checks
 */

import { log, logError } from '../utils/logger';
import { WSLBridge } from './wsl-bridge';
import { LimaBridge } from './lima-bridge';
import type { WSLStatus, LimaStatus } from './types';

export type SandboxSetupPhase = 
  | 'checking'      // Checking WSL/Lima availability
  | 'creating'      // Creating Lima instance (macOS only)
  | 'starting'      // Starting Lima instance (macOS only)  
  | 'installing_node'   // Installing Node.js
  | 'installing_python' // Installing Python
  | 'installing_pip'    // Installing pip
  | 'ready'         // Ready to use
  | 'skipped'       // No sandbox needed (native mode)
  | 'error';        // Setup failed

export interface SandboxSetupProgress {
  phase: SandboxSetupPhase;
  message: string;
  detail?: string;
  progress?: number; // 0-100
  error?: string;
}

export interface SandboxBootstrapResult {
  mode: 'wsl' | 'lima' | 'native';
  wslStatus?: WSLStatus;
  limaStatus?: LimaStatus;
  error?: string;
}

type ProgressCallback = (progress: SandboxSetupProgress) => void;

/**
 * Bootstrap sandbox environment at app startup
 * This runs in the background and reports progress to the renderer
 * Caches the result so SandboxAdapter can skip slow status checks
 */
export class SandboxBootstrap {
  private static instance: SandboxBootstrap | null = null;
  private setupPromise: Promise<SandboxBootstrapResult> | null = null;
  private progressCallback: ProgressCallback | null = null;
  private result: SandboxBootstrapResult | null = null;
  
  // Cached status for quick access by SandboxAdapter
  private cachedWSLStatus: WSLStatus | null = null;
  private cachedLimaStatus: LimaStatus | null = null;

  static getInstance(): SandboxBootstrap {
    if (!SandboxBootstrap.instance) {
      SandboxBootstrap.instance = new SandboxBootstrap();
    }
    return SandboxBootstrap.instance;
  }

  /**
   * Get cached WSL status (available after bootstrap completes)
   */
  getCachedWSLStatus(): WSLStatus | null {
    return this.cachedWSLStatus;
  }

  /**
   * Get cached Lima status (available after bootstrap completes)
   */
  getCachedLimaStatus(): LimaStatus | null {
    return this.cachedLimaStatus;
  }

  /**
   * Set progress callback for UI updates
   */
  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * Report progress to renderer
   */
  private reportProgress(progress: SandboxSetupProgress): void {
    log(`[SandboxBootstrap] ${progress.phase}: ${progress.message}`);
    if (progress.detail) {
      log(`[SandboxBootstrap]   Detail: ${progress.detail}`);
    }
    if (this.progressCallback) {
      this.progressCallback(progress);
    }
  }

  /**
   * Check if setup is complete
   */
  isComplete(): boolean {
    return this.result !== null;
  }

  /**
   * Get the bootstrap result (if complete)
   */
  getResult(): SandboxBootstrapResult | null {
    return this.result;
  }

  /**
   * Start sandbox bootstrap (idempotent - returns existing promise if running)
   */
  async bootstrap(): Promise<SandboxBootstrapResult> {
    if (this.setupPromise) {
      return this.setupPromise;
    }

    this.setupPromise = this._bootstrap();
    this.result = await this.setupPromise;
    return this.result;
  }

  private async _bootstrap(): Promise<SandboxBootstrapResult> {
    const platform = process.platform;
    log('[SandboxBootstrap] Starting bootstrap for platform:', platform);

    try {
      if (platform === 'win32') {
        return await this.bootstrapWSL();
      } else if (platform === 'darwin') {
        return await this.bootstrapLima();
      } else {
        // Linux - native mode
        this.reportProgress({
          phase: 'skipped',
          message: 'Using native execution mode',
          detail: 'Linux runs commands directly',
          progress: 100,
        });
        return { mode: 'native' };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logError('[SandboxBootstrap] Bootstrap failed:', error);
      this.reportProgress({
        phase: 'error',
        message: 'Sandbox setup failed',
        detail: errorMsg,
        error: errorMsg,
      });
      return { mode: 'native', error: errorMsg };
    }
  }

  /**
   * Bootstrap WSL on Windows
   */
  private async bootstrapWSL(): Promise<SandboxBootstrapResult> {
    // Phase 1: Check WSL availability
    this.reportProgress({
      phase: 'checking',
      message: 'Checking WSL2 environment...',
      progress: 10,
    });

    const wslStatus = await WSLBridge.checkWSLStatus();
    
    // Cache the status for SandboxAdapter to use later
    this.cachedWSLStatus = wslStatus;

    if (!wslStatus.available) {
      this.reportProgress({
        phase: 'skipped',
        message: 'WSL2 not detected, using native mode',
        detail: 'Install WSL2 for better sandbox isolation',
        progress: 100,
      });
      return { mode: 'native', wslStatus };
    }

    log('[SandboxBootstrap] WSL detected:', wslStatus.distro);

    // Phase 2: Install Node.js if needed
    if (!wslStatus.nodeAvailable) {
      this.reportProgress({
        phase: 'installing_node',
        message: 'Installing Node.js...',
        detail: `Installing Node.js runtime in ${wslStatus.distro}`,
        progress: 30,
      });

      const nodeInstalled = await WSLBridge.installNodeInWSL(wslStatus.distro!);
      if (!nodeInstalled) {
        this.reportProgress({
          phase: 'error',
          message: 'Node.js installation failed',
          detail: 'Please install Node.js manually in WSL',
          error: 'Failed to install Node.js in WSL',
        });
        return { mode: 'native', wslStatus, error: 'Node.js installation failed' };
      }
      wslStatus.nodeAvailable = true;
    }

    // Phase 3: Install Python if needed
    if (!wslStatus.pythonAvailable) {
      this.reportProgress({
        phase: 'installing_python',
        message: 'Installing Python...',
        detail: `Installing Python runtime in ${wslStatus.distro}`,
        progress: 60,
      });

      const pythonInstalled = await WSLBridge.installPythonInWSL(wslStatus.distro!);
      if (pythonInstalled) {
        wslStatus.pythonAvailable = true;
        wslStatus.pipAvailable = true;
      } else {
        log('[SandboxBootstrap] Python installation failed (non-critical)');
      }
    } else if (!wslStatus.pipAvailable) {
      // Python available but pip is not
      this.reportProgress({
        phase: 'installing_pip',
        message: 'Installing pip...',
        detail: `Installing Python package manager in ${wslStatus.distro}`,
        progress: 70,
      });

      const pipInstalled = await WSLBridge.installPipInWSL(wslStatus.distro!);
      if (pipInstalled) {
        wslStatus.pipAvailable = true;
      }
    }

    // Ready - update cached status
    this.cachedWSLStatus = wslStatus;
    
    this.reportProgress({
      phase: 'ready',
      message: 'WSL2 sandbox ready',
      detail: `${wslStatus.distro} - Node.js ${wslStatus.version || 'installed'}`,
      progress: 100,
    });

    return { mode: 'wsl', wslStatus };
  }

  /**
   * Bootstrap Lima on macOS
   */
  private async bootstrapLima(): Promise<SandboxBootstrapResult> {
    // Phase 1: Check Lima availability
    this.reportProgress({
      phase: 'checking',
      message: 'Checking Lima environment...',
      progress: 10,
    });

    let limaStatus = await LimaBridge.checkLimaStatus();
    
    // Cache the status
    this.cachedLimaStatus = limaStatus;

    if (!limaStatus.available) {
      this.reportProgress({
        phase: 'skipped',
        message: 'Lima not detected, using native mode',
        detail: 'Install Lima for better sandbox isolation (brew install lima)',
        progress: 100,
      });
      return { mode: 'native', limaStatus };
    }

    log('[SandboxBootstrap] Lima detected');

    // Phase 2: Create instance if needed
    if (!limaStatus.instanceExists) {
      this.reportProgress({
        phase: 'creating',
        message: 'Creating Lima VM...',
        detail: 'First run requires image download, may take a few minutes',
        progress: 20,
      });

      const created = await LimaBridge.createLimaInstance();
      if (!created) {
        this.reportProgress({
          phase: 'error',
          message: 'Lima VM creation failed',
          error: 'Failed to create Lima instance',
        });
        return { mode: 'native', limaStatus, error: 'Lima instance creation failed' };
      }
      limaStatus.instanceExists = true;
    }

    // Phase 3: Start instance if needed
    if (!limaStatus.instanceRunning) {
      this.reportProgress({
        phase: 'starting',
        message: 'Starting Lima VM...',
        detail: 'VM startup may take a few minutes',
        progress: 40,
      });

      const started = await LimaBridge.startLimaInstance();
      if (!started) {
        this.reportProgress({
          phase: 'error',
          message: 'Lima VM startup failed',
          error: 'Failed to start Lima instance',
        });
        return { mode: 'native', limaStatus, error: 'Lima instance start failed' };
      }
      limaStatus.instanceRunning = true;
      
      // Re-check status after starting
      limaStatus = await LimaBridge.checkLimaStatus();
    }

    // Phase 4: Install Node.js if needed
    if (!limaStatus.nodeAvailable) {
      this.reportProgress({
        phase: 'installing_node',
        message: 'Installing Node.js...',
        detail: 'Installing Node.js runtime in Lima VM',
        progress: 60,
      });

      const nodeInstalled = await LimaBridge.installNodeInLima();
      if (!nodeInstalled) {
        this.reportProgress({
          phase: 'error',
          message: 'Node.js installation failed',
          error: 'Failed to install Node.js in Lima',
        });
        return { mode: 'native', limaStatus, error: 'Node.js installation failed' };
      }
      limaStatus.nodeAvailable = true;
    }

    // Phase 5: Install Python if needed
    if (!limaStatus.pythonAvailable) {
      this.reportProgress({
        phase: 'installing_python',
        message: 'Installing Python...',
        detail: 'Installing Python runtime in Lima VM',
        progress: 80,
      });

      const pythonInstalled = await LimaBridge.installPythonInLima();
      if (pythonInstalled) {
        limaStatus.pythonAvailable = true;
        limaStatus.pipAvailable = true;
      }
    }

    // Ready - update cached status
    this.cachedLimaStatus = limaStatus;
    
    this.reportProgress({
      phase: 'ready',
      message: 'Lima sandbox ready',
      detail: `VM running - Node.js ${limaStatus.version || 'installed'}`,
      progress: 100,
    });

    return { mode: 'lima', limaStatus };
  }
}

// Export singleton getter
export function getSandboxBootstrap(): SandboxBootstrap {
  return SandboxBootstrap.getInstance();
}

