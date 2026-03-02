/**
 * VM Manager - Orchestrator for the managed VM service
 *
 * Delegates to a platform-specific backend (VirtualBox for Phase 1).
 * Includes VNC proxy orchestration, Computer Use adapter management,
 * and health monitoring for the Cowork Desktop feature.
 */

import { v4 as uuidv4 } from 'uuid';
import { log, logError } from '../utils/logger';
import { vmConfigStore } from './vm-config-store';
import { VMImageRegistry } from './vm-image-registry';
import type { VMBackend } from './backends/vm-backend';
import { VirtualBoxBackend } from './backends/virtualbox-backend';
import { VNCPortManager } from './vnc-port-manager';
import { VNCWebSocketProxy } from './vnc-ws-proxy';
import { ComputerUseAdapter } from './computer-use-adapter';
import type {
  VMConfig,
  VMStatus,
  VMState,
  VMOperationResult,
  VMResourceConfig,
  BackendStatus,
  ImageDownloadProgress,
  OSImage,
  GuestProvisionStatus,
} from './types';
import type { ServerEvent } from '../../renderer/types';
import { getVMGuestProvisioner } from './vm-guest-provisioner';
import { NaviGuestClient } from './navi-guest-client';

const HEALTH_POLL_INTERVAL_MS = 5000;

export class VMManager {
  private backend: VMBackend | null = null;
  private vboxBackend: VirtualBoxBackend | null = null; // typed reference for VRDE/screenshot
  private backendStatus: BackendStatus | null = null;
  private imageRegistry: VMImageRegistry | null = null;

  // VNC infrastructure
  private portManager = new VNCPortManager();
  private vncProxies: Map<string, VNCWebSocketProxy> = new Map();
  private healthTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private lastKnownStates: Map<string, VMState> = new Map();

  // Computer Use
  private computerUseAdapters: Map<string, ComputerUseAdapter> = new Map();
  private computerUseEnabledSet: Set<string> = new Set();

  // Guard against concurrent cleanup
  private cleaningUp: Set<string> = new Set();

  // Guest Navi agent connections
  private naviClients: Map<string, NaviGuestClient> = new Map();

  // Event callback for pushing state changes to the renderer
  private eventCallback: ((event: ServerEvent) => void) | null = null;

  /** Set the callback for emitting ServerEvents to the renderer */
  setEventCallback(cb: (event: ServerEvent) => void): void {
    this.eventCallback = cb;
  }

  private emitEvent(event: ServerEvent): void {
    if (this.eventCallback) {
      this.eventCallback(event);
    }
  }

  /** Detect and initialise the appropriate backend */
  async initialize(): Promise<BackendStatus> {
    // Phase 1: VirtualBox on all platforms
    const vbox = new VirtualBoxBackend();
    const status = await vbox.checkAvailability();

    if (status.available) {
      this.backend = vbox;
      this.vboxBackend = vbox;
      this.backendStatus = status;
      this.imageRegistry = new VMImageRegistry();
      log('[VMManager] Initialised with VirtualBox', status.version);
    } else {
      this.backendStatus = status;
      log('[VMManager] No backend available:', status.error);
    }

    return status;
  }

  // ── VM Lifecycle ────────────────────────────────────────────────

  async createVM(
    name: string,
    osImageId: string,
    resources: VMResourceConfig,
  ): Promise<VMOperationResult & { vmId?: string }> {
    if (!this.backend || !this.imageRegistry) {
      return { success: false, error: 'VM backend not available' };
    }

    // Resolve the ISO path
    const isoPath = this.imageRegistry.getImagePath(osImageId);
    if (!isoPath) {
      return { success: false, error: 'OS image not downloaded yet' };
    }

    // Look up vboxOsType from catalog
    const catalog = this.imageRegistry.getAvailableCatalog();
    const osImage = catalog.find(img => img.id === osImageId);

    const id = uuidv4();
    const now = new Date().toISOString();
    const config: VMConfig = {
      id,
      name,
      osImageId,
      resources,
      createdAt: now,
      updatedAt: now,
      backendType: 'virtualbox',
      backendVmId: osImage?.vboxOsType || 'Linux_64',
    };

    const result = await this.backend.createVM(config, isoPath);
    if (result.success) {
      // Persist config after successful creation
      vmConfigStore.addVM(config);
      log('[VMManager] Created VM:', name, id);
      return { ...result, vmId: id };
    }
    return result;
  }

  async startVM(vmId: string): Promise<VMOperationResult> {
    if (!this.backend) return { success: false, error: 'VM backend not available' };
    const config = vmConfigStore.getVM(vmId);
    if (!config) return { success: false, error: 'VM not found' };

    const gui = config.resources.displayMode === 'separate_window';
    return this.backend.startVM(config.name, gui);
  }

  /** Start a VM with VRDE enabled and a WebSocket proxy for embedded noVNC display */
  async startWithVNC(vmId: string): Promise<VMOperationResult & { wsUrl?: string }> {
    if (!this.backend || !this.vboxBackend) {
      return { success: false, error: 'VM backend not available' };
    }

    const config = vmConfigStore.getVM(vmId);
    if (!config) return { success: false, error: 'VM not found' };

    try {
      // 1. Allocate VNC port
      const vncPort = await this.portManager.allocatePort(vmId);

      // 2. Enable VRDE (VM must be powered off)
      const vrdeResult = await this.vboxBackend.enableVRDE(config.name, vncPort);
      if (!vrdeResult.success) {
        this.portManager.releasePort(vmId);
        return { success: false, error: `Failed to enable VRDE: ${vrdeResult.error}` };
      }

      // 3. Start VM in headless mode (VRDE takes over display)
      const startResult = await this.backend.startVM(config.name, false);
      if (!startResult.success) {
        // Roll back VRDE configuration so next retry gets a clean port
        await this.vboxBackend.disableVRDE(config.name).catch(() => {});
        this.portManager.releasePort(vmId);
        return { success: false, error: `Failed to start VM: ${startResult.error}` };
      }

      // 4. Brief delay for VRDE to initialize
      await new Promise(r => setTimeout(r, 2000));

      // 5. Start WebSocket proxy for noVNC
      const proxy = new VNCWebSocketProxy(vncPort);
      await proxy.start();
      this.vncProxies.set(vmId, proxy);
      const wsUrl = proxy.getWebSocketUrl();

      // 6. Start health monitor
      this.startHealthMonitor(vmId, config.name);

      // 7. Emit state change event
      this.lastKnownStates.set(vmId, 'running');
      this.emitEvent({
        type: 'vm.stateChanged',
        payload: { vmId, state: 'running', wsUrl },
      });

      log('[VMManager] VM started with VNC:', config.name, 'wsUrl:', wsUrl);
      return { success: true, wsUrl };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[VMManager] startWithVNC failed:', msg);
      // Cleanup on failure
      this.portManager.releasePort(vmId);
      const proxy = this.vncProxies.get(vmId);
      if (proxy) {
        try { await proxy.stop(); } catch (err) { logError('[VMManager] Error stopping proxy during cleanup:', err); }
        this.vncProxies.delete(vmId);
      }
      return { success: false, error: msg };
    }
  }

  async stopVM(vmId: string): Promise<VMOperationResult> {
    if (!this.backend) return { success: false, error: 'VM backend not available' };
    const config = vmConfigStore.getVM(vmId);
    if (!config) return { success: false, error: 'VM not found' };
    return this.backend.stopVM(config.name);
  }

  /** Stop a VM and clean up all VNC/computer-use infrastructure */
  async stopWithVNC(vmId: string): Promise<VMOperationResult> {
    if (!this.backend) return { success: false, error: 'VM backend not available' };
    const config = vmConfigStore.getVM(vmId);
    if (!config) return { success: false, error: 'VM not found' };

    try {
      // 1. Stop health monitor
      this.stopHealthMonitor(vmId);

      // 2. Stop WebSocket proxy
      const proxy = this.vncProxies.get(vmId);
      if (proxy) {
        await proxy.stop();
        this.vncProxies.delete(vmId);
      }

      // 3. Release VNC port
      this.portManager.releasePort(vmId);

      // 4. Remove computer use adapter
      this.computerUseAdapters.delete(vmId);
      this.computerUseEnabledSet.delete(vmId);

      // 5. Stop VM (graceful ACPI)
      const result = await this.backend.stopVM(config.name);

      // 6. Emit state change
      this.lastKnownStates.set(vmId, 'stopping');
      this.emitEvent({
        type: 'vm.stateChanged',
        payload: { vmId, state: 'stopping' },
      });

      log('[VMManager] VM stop initiated:', config.name);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[VMManager] stopWithVNC failed:', msg);
      return { success: false, error: msg };
    }
  }

  async forceStopVM(vmId: string): Promise<VMOperationResult> {
    if (!this.backend) return { success: false, error: 'VM backend not available' };
    const config = vmConfigStore.getVM(vmId);
    if (!config) return { success: false, error: 'VM not found' };
    return this.backend.forceStopVM(config.name);
  }

  async pauseVM(vmId: string): Promise<VMOperationResult> {
    if (!this.backend) return { success: false, error: 'VM backend not available' };
    const config = vmConfigStore.getVM(vmId);
    if (!config) return { success: false, error: 'VM not found' };
    return this.backend.pauseVM(config.name);
  }

  async resumeVM(vmId: string): Promise<VMOperationResult> {
    if (!this.backend) return { success: false, error: 'VM backend not available' };
    const config = vmConfigStore.getVM(vmId);
    if (!config) return { success: false, error: 'VM not found' };
    return this.backend.resumeVM(config.name);
  }

  async deleteVM(vmId: string): Promise<VMOperationResult> {
    if (!this.backend) return { success: false, error: 'VM backend not available' };
    const config = vmConfigStore.getVM(vmId);
    if (!config) return { success: false, error: 'VM not found' };

    // Stop VNC infrastructure if active
    const proxy = this.vncProxies.get(vmId);
    if (proxy) {
      this.stopHealthMonitor(vmId);
      await proxy.stop();
      this.vncProxies.delete(vmId);
      this.portManager.releasePort(vmId);
    }
    this.computerUseAdapters.delete(vmId);
    this.computerUseEnabledSet.delete(vmId);

    const result = await this.backend.deleteVM(config.name);
    if (result.success) {
      vmConfigStore.removeVM(vmId);
      this.lastKnownStates.delete(vmId);
    }
    return result;
  }

  async openDisplay(vmId: string): Promise<VMOperationResult> {
    if (!this.backend) return { success: false, error: 'VM backend not available' };
    const config = vmConfigStore.getVM(vmId);
    if (!config) return { success: false, error: 'VM not found' };
    return this.backend.openDisplay(config.name);
  }

  // ── Status ──────────────────────────────────────────────────────

  async getVMStatus(vmId: string): Promise<VMStatus | null> {
    if (!this.backend) return null;
    const config = vmConfigStore.getVM(vmId);
    if (!config) return null;
    const status = await this.backend.getVMStatus(config.name);
    return { ...status, id: vmId };
  }

  async listVMs(): Promise<VMStatus[]> {
    const configs = vmConfigStore.getVMs();
    if (!this.backend || configs.length === 0) {
      return configs.map(c => ({
        id: c.id,
        name: c.name,
        state: 'powered_off' as const,
      }));
    }

    const statuses: VMStatus[] = [];
    for (const config of configs) {
      try {
        const status = await this.backend.getVMStatus(config.name);
        statuses.push({ ...status, id: config.id });
      } catch {
        statuses.push({ id: config.id, name: config.name, state: 'error' });
      }
    }
    return statuses;
  }

  getVNCWebSocketUrl(vmId: string): string | null {
    const proxy = this.vncProxies.get(vmId);
    if (!proxy || !proxy.isRunning()) return null;
    try {
      return proxy.getWebSocketUrl();
    } catch {
      return null;
    }
  }

  // ── Configuration ───────────────────────────────────────────────

  async modifyVM(vmId: string, resources: Partial<VMResourceConfig>): Promise<VMOperationResult> {
    if (!this.backend) return { success: false, error: 'VM backend not available' };
    const config = vmConfigStore.getVM(vmId);
    if (!config) return { success: false, error: 'VM not found' };

    const result = await this.backend.modifyVM(config.name, resources);
    if (result.success) {
      vmConfigStore.updateVM(vmId, {
        resources: { ...config.resources, ...resources },
      });
    }
    return result;
  }

  getVMConfig(vmId: string): VMConfig | undefined {
    return vmConfigStore.getVM(vmId);
  }

  getAllVMConfigs(): VMConfig[] {
    return vmConfigStore.getVMs();
  }

  // ── Image Management ────────────────────────────────────────────

  getAvailableImages(): OSImage[] {
    return this.imageRegistry?.getAvailableCatalog() || [];
  }

  getDownloadedImages(): OSImage[] {
    return this.imageRegistry?.getDownloadedImages() || [];
  }

  async downloadImage(
    imageId: string,
    onProgress: (p: ImageDownloadProgress) => void,
  ): Promise<string> {
    if (!this.imageRegistry) throw new Error('Image registry not initialised');
    const progressCb = (p: ImageDownloadProgress) => {
      onProgress(p);
      this.emitEvent({
        type: 'vm.downloadProgress',
        payload: { ...p },
      });
    };
    return this.imageRegistry.downloadImage(imageId, progressCb);
  }

  cancelImageDownload(): void {
    this.imageRegistry?.cancelDownload();
  }

  deleteImage(imageId: string): VMOperationResult {
    if (!this.imageRegistry) return { success: false, error: 'Image registry not initialised' };
    const deleted = this.imageRegistry.deleteImage(imageId);
    return { success: deleted, error: deleted ? undefined : 'Image not found or already deleted' };
  }

  isImageDownloaded(imageId: string): boolean {
    return this.imageRegistry?.isDownloaded(imageId) || false;
  }

  importISO(filePath: string, name: string): OSImage | null {
    return this.imageRegistry?.importISO(filePath, name) || null;
  }

  // ── Computer Use ────────────────────────────────────────────────

  setComputerUseEnabled(vmId: string, enabled: boolean): void {
    if (enabled) {
      this.computerUseEnabledSet.add(vmId);
      if (!this.computerUseAdapters.has(vmId) && this.vboxBackend) {
        const config = vmConfigStore.getVM(vmId);
        if (config) {
          this.computerUseAdapters.set(
            vmId,
            new ComputerUseAdapter(vmId, config.name, this.vboxBackend),
          );
        }
      }
      log('[VMManager] Computer Use enabled for VM:', vmId);
    } else {
      this.computerUseEnabledSet.delete(vmId);
      this.computerUseAdapters.delete(vmId);
      log('[VMManager] Computer Use disabled for VM:', vmId);
    }
  }

  isComputerUseEnabled(vmId: string): boolean {
    return this.computerUseEnabledSet.has(vmId);
  }

  /** Synchronously get VMs that have active VNC sessions (running in cowork mode) */
  getActiveCoworkVMs(): Array<{ id: string; name: string; state: string }> {
    const results: Array<{ id: string; name: string; state: string }> = [];
    for (const [vmId, proxy] of this.vncProxies.entries()) {
      if (!proxy.isRunning()) continue;
      const config = vmConfigStore.getVM(vmId);
      const state = this.lastKnownStates.get(vmId) || 'running';
      results.push({ id: vmId, name: config?.name || vmId, state });
    }
    return results;
  }

  getComputerUseAdapter(vmId: string): ComputerUseAdapter | null {
    if (!this.computerUseEnabledSet.has(vmId)) return null;
    return this.computerUseAdapters.get(vmId) ?? null;
  }

  async executeComputerUse(vmId: string, action: unknown): Promise<unknown> {
    const adapter = this.getComputerUseAdapter(vmId);
    if (!adapter) {
      return { type: 'error', error: 'Computer Use not enabled for this VM' };
    }
    return adapter.execute(action as any);
  }

  // ── Health Monitor ──────────────────────────────────────────────

  private startHealthMonitor(vmId: string, vmName: string): void {
    this.stopHealthMonitor(vmId);

    const timer = setInterval(async () => {
      if (!this.backend) return;
      try {
        const status = await this.backend.getVMStatus(vmName);
        const lastState = this.lastKnownStates.get(vmId);

        if (status.state !== lastState) {
          this.lastKnownStates.set(vmId, status.state);
          this.emitEvent({
            type: 'vm.stateChanged',
            payload: {
              vmId,
              state: status.state,
              wsUrl: this.getVNCWebSocketUrl(vmId) ?? undefined,
            },
          });

          // Auto-cleanup if VM powers off externally
          if (status.state === 'powered_off' || status.state === 'error') {
            if (this.cleaningUp.has(vmId)) return;
            this.cleaningUp.add(vmId);
            this.stopHealthMonitor(vmId);
            try {
              const proxy = this.vncProxies.get(vmId);
              if (proxy) {
                try { await proxy.stop(); } catch (err) { logError('[VMManager] Error stopping proxy during auto-cleanup:', err); }
                this.vncProxies.delete(vmId);
              }
              this.portManager.releasePort(vmId);
              this.computerUseAdapters.delete(vmId);
              this.computerUseEnabledSet.delete(vmId);
            } finally {
              this.cleaningUp.delete(vmId);
            }
          }
        }
      } catch {
        // Ignore transient errors during polling
      }
    }, HEALTH_POLL_INTERVAL_MS);

    this.healthTimers.set(vmId, timer);
  }

  private stopHealthMonitor(vmId: string): void {
    const timer = this.healthTimers.get(vmId);
    if (timer) {
      clearInterval(timer);
      this.healthTimers.delete(vmId);
    }
  }

  // ── Guest Provisioning ─────────────────────────────────────────

  /** Start guest provisioning for a VM */
  async provisionGuest(vmId: string): Promise<GuestProvisionStatus> {
    const provisioner = getVMGuestProvisioner();
    if (this.vboxBackend) {
      provisioner.setVBoxBackend(this.vboxBackend);
    }
    return provisioner.provisionVM(vmId);
  }

  /** Get provisioning status */
  getProvisionStatus(vmId: string): GuestProvisionStatus | null {
    return getVMGuestProvisioner().getStatus(vmId);
  }

  /** Check if VM is provisioned */
  isVMProvisioned(vmId: string): boolean {
    return getVMGuestProvisioner().isProvisioned(vmId);
  }

  /** Signal that user finished OS install */
  notifyOSInstallComplete(vmId: string): void {
    getVMGuestProvisioner().notifyOSInstallComplete(vmId);
  }

  /** Connect to guest Navi agent */
  async connectGuestNavi(vmId: string): Promise<boolean> {
    const config = vmConfigStore.getVM(vmId);
    if (!config?.naviMcpPort) return false;

    const client = new NaviGuestClient({
      vmId,
      vmName: config.name,
      hostPort: config.naviMcpPort,
    });

    const connected = await client.connect();
    if (connected) {
      this.naviClients.set(vmId, client);
    }
    return connected;
  }

  /** Get the guest Navi client for a VM */
  getGuestNaviClient(vmId: string): NaviGuestClient | null {
    return this.naviClients.get(vmId) || null;
  }

  /** Get the VirtualBox backend (for provisioner) */
  getVBoxBackend(): VirtualBoxBackend | null {
    return this.vboxBackend;
  }

  // ── Backend Info ────────────────────────────────────────────────

  getBackendStatus(): BackendStatus | null {
    return this.backendStatus;
  }

  /** Gracefully stop all VNC proxies and running VMs on app exit */
  async shutdownAll(): Promise<void> {
    log('[VMManager] Shutting down...');

    // Stop all health monitors
    for (const vmId of this.healthTimers.keys()) {
      this.stopHealthMonitor(vmId);
    }

    // Stop all WebSocket proxies
    for (const [vmId, proxy] of this.vncProxies) {
      try {
        await proxy.stop();
      } catch (err) {
        logError('[VMManager] Error stopping proxy for VM:', vmId, err);
      }
    }
    this.vncProxies.clear();
    this.portManager.releaseAll();
    this.computerUseAdapters.clear();
    this.computerUseEnabledSet.clear();

    // Disconnect guest Navi clients
    for (const [vmId, client] of this.naviClients) {
      try {
        await client.disconnect();
      } catch (err) {
        logError('[VMManager] Error disconnecting Navi client for VM:', vmId, err);
      }
    }
    this.naviClients.clear();

    // Cleanup guest provisioner
    await getVMGuestProvisioner().cleanup();

    // Stop running VMs
    if (this.backend) {
      const configs = vmConfigStore.getVMs();
      for (const config of configs) {
        try {
          const status = await this.backend.getVMStatus(config.name);
          if (status.state === 'running' || status.state === 'paused') {
            log('[VMManager] Stopping VM on shutdown:', config.name);
            await this.backend.stopVM(config.name);
          }
        } catch {
          // Best effort
        }
      }
    }

    log('[VMManager] Shutdown complete');
  }
}

/** Singleton instance */
export const vmManager = new VMManager();
