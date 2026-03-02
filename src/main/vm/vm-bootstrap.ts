/**
 * VM Bootstrap Service
 *
 * Handles first-run VM setup at app startup.
 * Detects VirtualBox, checks for existing VMs, and if none exist,
 * signals the renderer to open the VMCreateWizard for the user.
 * After the user creates their first VM, auto-starts it with GUI.
 *
 * Follows the SandboxBootstrap singleton/idempotent pattern.
 */

import { log, logError } from '../utils/logger';
import { vmManager } from './vm-manager';
import type { VMBootstrapProgress, VMBootstrapResult } from './types';

type ProgressCallback = (progress: VMBootstrapProgress) => void;

export class VMBootstrap {
  private static instance: VMBootstrap | null = null;
  private bootstrapPromise: Promise<VMBootstrapResult> | null = null;
  private progressCallback: ProgressCallback | null = null;
  private result: VMBootstrapResult | null = null;

  /** Resolve function for the "waiting for user to create VM" step */
  private createdResolve: ((vmId: string) => void) | null = null;

  static getInstance(): VMBootstrap {
    if (!VMBootstrap.instance) {
      VMBootstrap.instance = new VMBootstrap();
    }
    return VMBootstrap.instance;
  }

  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  private reportProgress(progress: VMBootstrapProgress): void {
    log(`[VMBootstrap] ${progress.phase}: ${progress.message}`);
    if (progress.detail) {
      log(`[VMBootstrap]   Detail: ${progress.detail}`);
    }
    this.progressCallback?.(progress);
  }

  isComplete(): boolean {
    return this.result !== null;
  }

  getResult(): VMBootstrapResult | null {
    return this.result;
  }

  /**
   * Called by the renderer (via IPC) when VMCreateWizard finishes creating a VM.
   * This unblocks the bootstrap flow so it can auto-start the VM.
   */
  notifyVMCreated(vmId: string): void {
    if (this.createdResolve) {
      this.createdResolve(vmId);
      this.createdResolve = null;
    }
  }

  /** Start bootstrap (idempotent — returns existing promise if running) */
  async bootstrap(): Promise<VMBootstrapResult> {
    if (this.bootstrapPromise) {
      return this.bootstrapPromise;
    }

    this.bootstrapPromise = this._bootstrap();
    this.result = await this.bootstrapPromise;
    return this.result;
  }

  private async _bootstrap(): Promise<VMBootstrapResult> {
    log('[VMBootstrap] Starting VM bootstrap...');

    try {
      // Phase 1: Check backend availability
      this.reportProgress({
        phase: 'checking_backend',
        message: 'Detecting VirtualBox...',
        progress: 10,
      });

      const backendStatus = vmManager.getBackendStatus()
        ?? await vmManager.initialize();

      if (!backendStatus.available) {
        this.reportProgress({
          phase: 'skipped',
          message: 'VirtualBox not detected',
          detail: 'Install VirtualBox to create virtual machines',
          progress: 100,
        });
        return { provisioned: false, skippedReason: 'VirtualBox not available' };
      }

      log('[VMBootstrap] VirtualBox detected:', backendStatus.version);

      // Phase 2: Check for existing VMs
      this.reportProgress({
        phase: 'checking_existing',
        message: 'Checking for existing VMs...',
        progress: 30,
      });

      const existingVMs = vmManager.getAllVMConfigs();
      if (existingVMs.length > 0) {
        log('[VMBootstrap] Found', existingVMs.length, 'existing VMs, skipping provisioning');
        this.reportProgress({
          phase: 'ready',
          message: 'VMs already configured',
          detail: `${existingVMs.length} VM(s) found`,
          progress: 100,
        });
        return { provisioned: false, skippedReason: 'VMs already exist' };
      }

      // Phase 3: No VMs found — prompt user to create one
      this.reportProgress({
        phase: 'prompting_setup',
        message: 'No VMs found — opening setup wizard',
        detail: 'Choose your operating system to get started',
        progress: 40,
      });

      // Wait for the user to create a VM via the wizard
      const vmId = await new Promise<string>((resolve) => {
        this.createdResolve = resolve;
      });

      log('[VMBootstrap] User created VM:', vmId);

      // Phase 4: Auto-start the newly created VM with GUI
      this.reportProgress({
        phase: 'starting_vm',
        message: 'Starting your new VM...',
        detail: 'VirtualBox window will open for OS installation',
        progress: 80,
      });

      const startResult = await vmManager.startVM(vmId);
      if (!startResult.success) {
        logError('[VMBootstrap] Failed to auto-start VM:', startResult.error);
        this.reportProgress({
          phase: 'error',
          message: 'VM created but failed to start',
          detail: startResult.error,
          error: startResult.error,
        });
        return { provisioned: true, vmId, error: startResult.error };
      }

      const config = vmManager.getVMConfig(vmId);

      this.reportProgress({
        phase: 'ready',
        message: 'VM is running',
        detail: `${config?.name || 'VM'} started with VirtualBox GUI`,
        progress: 100,
      });

      return { provisioned: true, vmId, vmName: config?.name };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logError('[VMBootstrap] Bootstrap failed:', error);
      this.reportProgress({
        phase: 'error',
        message: 'VM bootstrap failed',
        detail: errorMsg,
        error: errorMsg,
      });
      return { provisioned: false, error: errorMsg };
    }
  }
}

export function getVMBootstrap(): VMBootstrap {
  return VMBootstrap.getInstance();
}
