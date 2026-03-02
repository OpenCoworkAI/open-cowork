/**
 * VM Guest Provisioner - Orchestrates guest OS provisioning after manual install
 *
 * After the user installs the OS from an ISO, this service:
 * 1. Prepares provisioning assets (scripts, config, bundles) and starts an HTTP server
 * 2. Injects a keyboard command into the guest to curl+run the bootstrap script
 * 3. Monitors provisioning status via HTTP POST from the guest
 * 4. Verifies the guest Navi agent is running via TCP port forward
 *
 * Follows the same singleton + progress callback pattern as VMBootstrap.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { log, logError } from '../utils/logger';
import { vmConfigStore } from './vm-config-store';
import { deviceTokenStore } from '../credentials/device-token-store';
import { configStore } from '../config/config-store';
import { ProvisionHTTPServer } from './provision-http-server';
import { NaviMCPPortManager } from './navi-mcp-port-manager';
import { NaviGuestClient } from './navi-guest-client';
import type { VirtualBoxBackend } from './backends/virtualbox-backend';
import type {
  GuestProvisionPhase,
  GuestProvisionProgress,
  GuestProvisionStatus,
  GuestProvisionConfig,
} from './types';

const PROVISION_HTTP_PORT = 9580;
const NAVI_GUEST_MCP_PORT = 9599;
const STATUS_POLL_INTERVAL_MS = 3000;
const PROVISION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Keyboard scancodes for common keys
const SCANCODES = {
  CTRL_PRESS: '1d',
  CTRL_RELEASE: '9d',
  ALT_PRESS: '38',
  ALT_RELEASE: 'b8',
  T_PRESS: '14',
  T_RELEASE: '94',
  ENTER_PRESS: '1c',
  ENTER_RELEASE: '9c',
};

export class VMGuestProvisioner {
  private static instance: VMGuestProvisioner | null = null;
  private progressCallback: ((p: GuestProvisionProgress) => void) | null = null;
  private provisioningStatuses = new Map<string, GuestProvisionStatus>();
  private httpServer: ProvisionHTTPServer | null = null;
  private naviPortManager = new NaviMCPPortManager();
  private naviClients = new Map<string, NaviGuestClient>();
  private vboxBackend: VirtualBoxBackend | null = null;

  // Promise-based wait for user signal (OS install complete)
  private osInstallResolvers = new Map<string, () => void>();

  static getInstance(): VMGuestProvisioner {
    if (!VMGuestProvisioner.instance) {
      VMGuestProvisioner.instance = new VMGuestProvisioner();
    }
    return VMGuestProvisioner.instance;
  }

  setProgressCallback(cb: (p: GuestProvisionProgress) => void): void {
    this.progressCallback = cb;
  }

  setVBoxBackend(backend: VirtualBoxBackend): void {
    this.vboxBackend = backend;
  }

  /** Get the host-side provision directory for a VM */
  getProvisionDir(vmId: string): string {
    return path.join(app.getPath('userData'), 'vm-provision', vmId);
  }

  /** Signal that the user has finished installing the OS */
  notifyOSInstallComplete(vmId: string): void {
    const resolver = this.osInstallResolvers.get(vmId);
    if (resolver) {
      resolver();
      this.osInstallResolvers.delete(vmId);
      log('[GuestProvisioner] User signalled OS install complete for VM:', vmId);
    }
  }

  /** Full provisioning flow for a VM */
  async provisionVM(vmId: string): Promise<GuestProvisionStatus> {
    const config = vmConfigStore.getVM(vmId);
    if (!config) {
      return this.makeError(vmId, 'VM not found in config store');
    }

    if (!this.vboxBackend) {
      return this.makeError(vmId, 'VirtualBox backend not available');
    }

    const status: GuestProvisionStatus = {
      vmId,
      phase: 'preparing',
      startedAt: Date.now(),
    };
    this.provisioningStatuses.set(vmId, status);
    vmConfigStore.updateVM(vmId, { provisionStatus: 'provisioning' });

    try {
      // ── Phase 1: Prepare provision directory + HTTP server ──────────
      this.emitProgress(vmId, 'preparing', 'Preparing provisioning assets...', 5);

      const provisionDir = this.getProvisionDir(vmId);
      await this.prepareProvisionDir(vmId, provisionDir);

      this.httpServer = new ProvisionHTTPServer(provisionDir, PROVISION_HTTP_PORT);
      this.httpServer.setStatusCallback((update) => {
        // Forward guest-side status updates to the renderer
        this.emitProgress(vmId, update.phase, update.message, update.progress);
      });
      await this.httpServer.start();

      // ── Phase 2: Set up NAT port forwarding ────────────────────────
      this.emitProgress(vmId, 'preparing', 'Setting up network port forwarding...', 10);

      const naviHostPort = await this.naviPortManager.allocatePort(vmId);

      // Port forwarding requires VM to be powered off
      const vmStatus = await this.vboxBackend.getVMStatus(config.name);
      if (vmStatus.state === 'running') {
        this.emitProgress(vmId, 'preparing', 'Stopping VM to configure port forwarding...', 12);
        await this.vboxBackend.stopVM(config.name);
        await this.waitForState(config.name, 'powered_off', 30000);
      }

      await this.vboxBackend.addPortForwarding(
        config.name, 'navi-mcp', 'tcp', naviHostPort, NAVI_GUEST_MCP_PORT,
      );

      // Restart VM with GUI
      this.emitProgress(vmId, 'preparing', 'Starting VM...', 15);
      await this.vboxBackend.startVM(config.name, true);
      await this.delay(5000); // Wait for VM to boot

      // ── Phase 3: Wait for user to signal OS install complete ───────
      this.emitProgress(vmId, 'waiting_for_user', 'Waiting for you to finish installing the OS...', 20);

      await new Promise<void>((resolve) => {
        this.osInstallResolvers.set(vmId, resolve);
      });

      // ── Phase 4: Inject bootstrap command ──────────────────────────
      this.emitProgress(vmId, 'injecting_bootstrap', 'Opening terminal in guest VM...', 25);

      await this.injectBootstrapCommand(config.name, config.guestCredentials?.password || 'password');

      // ── Phase 5: Monitor provisioning via HTTP status ──────────────
      this.emitProgress(vmId, 'provisioning', 'Running provisioning scripts in guest VM...', 30);

      const finalStatus = await this.waitForProvisionComplete(vmId);
      if (finalStatus.phase === 'error') {
        throw new Error(finalStatus.error || 'Provisioning failed in guest');
      }

      // ── Phase 6: Verify guest Navi agent ───────────────────────────
      this.emitProgress(vmId, 'verifying', 'Verifying Navi agent connectivity...', 92);

      await this.delay(3000); // Give the agent a moment to start
      const client = new NaviGuestClient({
        vmId,
        vmName: config.name,
        hostPort: naviHostPort,
      });

      let connected = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        connected = await client.connect();
        if (connected) break;
        await this.delay(2000);
      }

      if (!connected) {
        this.emitProgress(vmId, 'error', 'Could not connect to guest Navi agent', 95);
        vmConfigStore.updateVM(vmId, {
          provisionStatus: 'provisioned', // Still mark provisioned, just no MCP connection
          naviMcpPort: naviHostPort,
        });
        status.phase = 'done';
        status.completedAt = Date.now();
        status.naviMcpHostPort = naviHostPort;
        return status;
      }

      // ── Phase 7: MCP handshake ────────────────────────────────────
      this.emitProgress(vmId, 'connecting_agent', 'Connecting to Navi agent...', 97);

      const pong = await client.ping();
      if (pong) {
        this.naviClients.set(vmId, client);
        log('[GuestProvisioner] Navi agent is alive on', config.name);
      }

      // ── Done ──────────────────────────────────────────────────────
      this.emitProgress(vmId, 'done', 'Guest provisioned. Navi agent is running and connected.', 100);

      vmConfigStore.updateVM(vmId, {
        provisionStatus: 'provisioned',
        naviMcpPort: naviHostPort,
      });

      status.phase = 'done';
      status.completedAt = Date.now();
      status.naviMcpHostPort = naviHostPort;
      return status;

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[GuestProvisioner] Provisioning failed:', msg);
      this.emitProgress(vmId, 'error', `Provisioning failed: ${msg}`);
      vmConfigStore.updateVM(vmId, { provisionStatus: 'error' });
      status.phase = 'error';
      status.error = msg;
      return status;
    } finally {
      // Stop HTTP server after provisioning
      if (this.httpServer) {
        await this.httpServer.stop();
        this.httpServer = null;
      }
    }
  }

  /** Get current provisioning status for a VM */
  getStatus(vmId: string): GuestProvisionStatus | null {
    return this.provisioningStatuses.get(vmId) || null;
  }

  /** Check if a VM has been provisioned */
  isProvisioned(vmId: string): boolean {
    const config = vmConfigStore.getVM(vmId);
    return config?.provisionStatus === 'provisioned';
  }

  /** Get the guest Navi client for a VM */
  getNaviClient(vmId: string): NaviGuestClient | null {
    return this.naviClients.get(vmId) || null;
  }

  /** Disconnect all clients and release ports */
  async cleanup(): Promise<void> {
    for (const [vmId, client] of this.naviClients) {
      await client.disconnect();
      this.naviClients.delete(vmId);
    }
    this.naviPortManager.releaseAll();
    if (this.httpServer) {
      await this.httpServer.stop();
      this.httpServer = null;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private async prepareProvisionDir(vmId: string, provisionDir: string): Promise<void> {
    fs.mkdirSync(provisionDir, { recursive: true });

    // Copy shell scripts from resources
    const resourceDir = this.getResourceProvisionDir();
    const bootstrapSrc = path.join(resourceDir, 'bootstrap.sh');
    const provisionSrc = path.join(resourceDir, 'provision.sh');

    if (fs.existsSync(bootstrapSrc)) {
      fs.copyFileSync(bootstrapSrc, path.join(provisionDir, 'bootstrap.sh'));
    }
    if (fs.existsSync(provisionSrc)) {
      fs.copyFileSync(provisionSrc, path.join(provisionDir, 'provision.sh'));
    }

    // Write config.json with device token and API URL
    const deviceToken = deviceTokenStore.getToken() || '';
    const apiUrl = configStore.get('coeadaptApiUrl') as string || 'https://api.coeadapt.com';
    const config = vmConfigStore.getVM(vmId);
    const guestUser = config?.guestCredentials?.username || 'user';

    const provisionConfig: GuestProvisionConfig = {
      deviceToken,
      apiUrl,
      guestUsername: guestUser,
      mcpPort: NAVI_GUEST_MCP_PORT,
      workspacePath: `/home/${guestUser}/.navi/workspace`,
    };

    fs.writeFileSync(
      path.join(provisionDir, 'config.json'),
      JSON.stringify(provisionConfig, null, 2),
    );

    // Copy Node.js bundle if available in resources
    const nodeBundleSrc = path.join(app.getAppPath(), 'resources', 'node');
    if (fs.existsSync(nodeBundleSrc)) {
      // Create a tarball reference — the HTTP server will serve files directly
      log('[GuestProvisioner] Node.js bundle available at:', nodeBundleSrc);
    }

    // Copy Navi agent bundle if built
    const naviBundleSrc = path.join(resourceDir, 'navi-agent');
    if (fs.existsSync(naviBundleSrc)) {
      const naviDest = path.join(provisionDir, 'navi-agent');
      fs.mkdirSync(naviDest, { recursive: true });
      this.copyDirRecursive(naviBundleSrc, naviDest);
    }

    log('[GuestProvisioner] Provision directory prepared:', provisionDir);
  }

  private async injectBootstrapCommand(vmName: string, guestPassword: string): Promise<void> {
    if (!this.vboxBackend) throw new Error('VBox backend not available');

    // Wait for desktop to settle after boot
    await this.delay(2000);

    // Send Ctrl+Alt+T to open terminal
    await this.vboxBackend.keyboardPutScancode(
      vmName,
      SCANCODES.CTRL_PRESS, SCANCODES.ALT_PRESS, SCANCODES.T_PRESS,
      SCANCODES.T_RELEASE, SCANCODES.ALT_RELEASE, SCANCODES.CTRL_RELEASE,
    );

    // Wait for terminal to open
    await this.delay(3000);

    // Type the bootstrap command
    const command = `curl -sL http://10.0.2.2:${PROVISION_HTTP_PORT}/bootstrap.sh | sudo bash`;
    await this.vboxBackend.keyboardPutString(vmName, command);
    await this.delay(500);

    // Press Enter
    await this.vboxBackend.keyboardPutScancode(
      vmName, SCANCODES.ENTER_PRESS, SCANCODES.ENTER_RELEASE,
    );

    // Wait for sudo password prompt
    await this.delay(2000);

    // Type the password
    await this.vboxBackend.keyboardPutString(vmName, guestPassword);
    await this.delay(300);

    // Press Enter
    await this.vboxBackend.keyboardPutScancode(
      vmName, SCANCODES.ENTER_PRESS, SCANCODES.ENTER_RELEASE,
    );

    log('[GuestProvisioner] Bootstrap command injected into', vmName);
  }

  private async waitForProvisionComplete(vmId: string): Promise<GuestProvisionStatus> {
    const status = this.provisioningStatuses.get(vmId)!;
    const startTime = Date.now();

    return new Promise((resolve) => {
      const poll = setInterval(() => {
        const latest = this.httpServer?.getLatestStatus();

        if (latest) {
          status.phase = latest.phase;

          if (latest.phase === 'done') {
            clearInterval(poll);
            status.completedAt = Date.now();
            resolve(status);
          } else if (latest.phase === 'error') {
            clearInterval(poll);
            status.error = latest.message;
            resolve(status);
          }
        }

        // Timeout check
        if (Date.now() - startTime > PROVISION_TIMEOUT_MS) {
          clearInterval(poll);
          status.phase = 'error';
          status.error = 'Provisioning timed out after 10 minutes';
          resolve(status);
        }
      }, STATUS_POLL_INTERVAL_MS);
    });
  }

  private async waitForState(vmName: string, target: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.vboxBackend!.getVMStatus(vmName);
      if (status.state === target) return;
      await this.delay(1000);
    }
  }

  private emitProgress(
    vmId: string,
    phase: GuestProvisionPhase,
    message: string,
    progress?: number,
    error?: string,
  ): void {
    const p: GuestProvisionProgress = { vmId, phase, message, progress, error };
    if (this.progressCallback) {
      this.progressCallback(p);
    }

    // Update internal status
    const status = this.provisioningStatuses.get(vmId);
    if (status) {
      status.phase = phase;
      if (error) status.error = error;
    }
  }

  private makeError(vmId: string, msg: string): GuestProvisionStatus {
    return { vmId, phase: 'error', error: msg };
  }

  private getResourceProvisionDir(): string {
    // In development, resources/ is at project root
    // In production, resources are at app.getAppPath()/resources/
    const devPath = path.join(app.getAppPath(), 'resources', 'provision');
    if (fs.existsSync(devPath)) return devPath;
    return path.join(path.dirname(app.getAppPath()), 'resources', 'provision');
  }

  private copyDirRecursive(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export function getVMGuestProvisioner(): VMGuestProvisioner {
  return VMGuestProvisioner.getInstance();
}
