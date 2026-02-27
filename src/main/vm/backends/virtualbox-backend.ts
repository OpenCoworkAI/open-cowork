/**
 * VirtualBox Backend - Wraps VBoxManage CLI for VM lifecycle management
 *
 * Follows the same execFile pattern as DockerManager.
 */

import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { log, logError } from '../../utils/logger';
import type { VMBackend } from './vm-backend';
import type {
  VMConfig,
  VMStatus,
  VMState,
  VMOperationResult,
  VMResourceConfig,
  BackendStatus,
} from '../types';

// ── CLI helper ──────────────────────────────────────────────────────

function exec(
  command: string,
  args: string[],
  timeoutMs = 30000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      }
    });
  });
}

// ── VBoxManage path detection ───────────────────────────────────────

const VBOXMANAGE_CANDIDATES: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe',
    'C:\\Program Files (x86)\\Oracle\\VirtualBox\\VBoxManage.exe',
  ],
  darwin: [
    '/usr/local/bin/VBoxManage',
    '/opt/homebrew/bin/VBoxManage',
    '/Applications/VirtualBox.app/Contents/MacOS/VBoxManage',
  ],
  linux: [
    '/usr/bin/VBoxManage',
    '/usr/local/bin/VBoxManage',
  ],
};

async function findVBoxManage(): Promise<string | null> {
  // Try PATH first
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await exec(cmd, ['VBoxManage'], 5000);
    const found = stdout.trim().split('\n')[0].trim();
    if (found) return found;
  } catch {
    // not on PATH
  }

  // Try known locations
  const candidates = VBOXMANAGE_CANDIDATES[process.platform] || [];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

// ── Parse VBoxManage machinereadable output ─────────────────────────

function parseMachineReadable(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const match = line.match(/^"?([^"=]+)"?="?([^"]*)"?$/);
    if (match) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

function mapVBoxState(vboxState: string): VMState {
  const s = vboxState.toLowerCase();
  if (s.includes('running')) return 'running';
  if (s.includes('paused')) return 'paused';
  if (s.includes('saved')) return 'saved';
  if (s.includes('powered off') || s.includes('poweroff')) return 'powered_off';
  if (s.includes('starting')) return 'starting';
  if (s.includes('stopping')) return 'stopping';
  if (s.includes('saving')) return 'saving';
  if (s.includes('aborted') || s.includes('guru')) return 'error';
  return 'powered_off';
}

// ── VirtualBox Backend ──────────────────────────────────────────────

export class VirtualBoxBackend implements VMBackend {
  private vboxManagePath: string | null = null;

  private async vbox(...args: string[]): Promise<{ stdout: string; stderr: string }> {
    if (!this.vboxManagePath) {
      throw new Error('VBoxManage not found');
    }
    log('[VBox]', this.vboxManagePath, args.join(' '));
    return exec(this.vboxManagePath, args, 120000);
  }

  async checkAvailability(): Promise<BackendStatus> {
    try {
      this.vboxManagePath = await findVBoxManage();
      if (!this.vboxManagePath) {
        return { type: 'virtualbox', available: false, error: 'VBoxManage not found' };
      }

      const { stdout } = await this.vbox('--version');
      const version = stdout.trim();
      log('[VBox] Found VirtualBox', version, 'at', this.vboxManagePath);

      return { type: 'virtualbox', available: true, version };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[VBox] Availability check failed:', msg);
      return { type: 'virtualbox', available: false, error: msg };
    }
  }

  async createVM(config: VMConfig, isoPath: string): Promise<VMOperationResult> {
    const vmName = config.name;

    // Validate VM name to prevent VBoxManage issues with special characters
    if (!/^[a-zA-Z0-9 _-]+$/.test(vmName) || vmName.length === 0 || vmName.length > 255) {
      return { success: false, error: 'Invalid VM name. Use only letters, numbers, spaces, dashes, and underscores (max 255 chars).' };
    }

    const { cpuCount, memoryMb, diskSizeGb, vramMb = 128, enableEFI = true } = config.resources;
    const osType = config.backendVmId || 'Ubuntu_64'; // overridden by caller

    try {
      // 1. Create and register the VM
      log('[VBox] Creating VM:', vmName);
      const { stdout: createOut } = await this.vbox(
        'createvm', '--name', vmName, '--ostype', osType, '--register',
      );

      // Extract settings file path to determine VM folder
      const settingsMatch = createOut.match(/Settings file:\s*'(.+)'/);
      const vmFolder = settingsMatch
        ? path.dirname(settingsMatch[1])
        : undefined;

      // 2. Configure hardware
      const modifyArgs = [
        'modifyvm', vmName,
        '--cpus', String(cpuCount),
        '--memory', String(memoryMb),
        '--vram', String(vramMb),
        '--graphicscontroller', 'vmsvga',
        '--nic1', 'nat',
        '--audio-driver', 'default',
        '--clipboard-mode', 'bidirectional',
        '--draganddrop', 'bidirectional',
      ];
      if (enableEFI) {
        modifyArgs.push('--firmware', 'efi');
      }
      await this.vbox(...modifyArgs);

      // 3. Create virtual disk
      const diskPath = vmFolder
        ? path.join(vmFolder, `${vmName}.vdi`)
        : `${vmName}.vdi`;
      const diskSizeMb = diskSizeGb * 1024;
      await this.vbox(
        'createmedium', 'disk',
        '--filename', diskPath,
        '--size', String(diskSizeMb),
        '--format', 'VDI',
      );

      // 4. Add SATA controller and attach disk + ISO
      await this.vbox(
        'storagectl', vmName,
        '--name', 'SATA', '--add', 'sata', '--controller', 'IntelAhci',
      );
      await this.vbox(
        'storageattach', vmName,
        '--storagectl', 'SATA', '--port', '0', '--device', '0',
        '--type', 'hdd', '--medium', diskPath,
      );
      await this.vbox(
        'storageattach', vmName,
        '--storagectl', 'SATA', '--port', '1', '--device', '0',
        '--type', 'dvddrive', '--medium', isoPath,
      );

      // 5. Set boot order: DVD first (for initial install), then disk
      await this.vbox('modifyvm', vmName, '--boot1', 'dvd', '--boot2', 'disk', '--boot3', 'none');

      log('[VBox] VM created successfully:', vmName);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[VBox] Failed to create VM:', msg);
      // Attempt cleanup on failure
      try { await this.vbox('unregistervm', vmName, '--delete'); } catch { /* ignore */ }
      return { success: false, error: msg };
    }
  }

  async startVM(vmId: string, gui = true): Promise<VMOperationResult> {
    try {
      const type = gui ? 'gui' : 'headless';
      await this.vbox('startvm', vmId, '--type', type);
      log('[VBox] Started VM:', vmId, 'type:', type);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[VBox] Failed to start VM:', msg);
      return { success: false, error: msg };
    }
  }

  async stopVM(vmId: string): Promise<VMOperationResult> {
    try {
      await this.vbox('controlvm', vmId, 'acpipowerbutton');
      log('[VBox] Sent ACPI shutdown to VM:', vmId);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[VBox] Failed to stop VM:', msg);
      return { success: false, error: msg };
    }
  }

  async forceStopVM(vmId: string): Promise<VMOperationResult> {
    try {
      await this.vbox('controlvm', vmId, 'poweroff');
      log('[VBox] Force stopped VM:', vmId);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[VBox] Failed to force stop VM:', msg);
      return { success: false, error: msg };
    }
  }

  async pauseVM(vmId: string): Promise<VMOperationResult> {
    try {
      await this.vbox('controlvm', vmId, 'pause');
      log('[VBox] Paused VM:', vmId);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  }

  async resumeVM(vmId: string): Promise<VMOperationResult> {
    try {
      await this.vbox('controlvm', vmId, 'resume');
      log('[VBox] Resumed VM:', vmId);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  }

  async deleteVM(vmId: string): Promise<VMOperationResult> {
    try {
      // Power off first if running
      const status = await this.getVMStatus(vmId);
      if (status.state === 'running' || status.state === 'paused') {
        await this.vbox('controlvm', vmId, 'poweroff');
        // Brief wait for poweroff to settle
        await new Promise(r => setTimeout(r, 2000));
      }

      await this.vbox('unregistervm', vmId, '--delete');
      log('[VBox] Deleted VM:', vmId);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[VBox] Failed to delete VM:', msg);
      return { success: false, error: msg };
    }
  }

  async getVMStatus(vmId: string): Promise<VMStatus> {
    try {
      const { stdout } = await this.vbox('showvminfo', vmId, '--machinereadable');
      const info = parseMachineReadable(stdout);

      return {
        id: vmId,
        name: info['name'] || vmId,
        state: mapVBoxState(info['VMState'] || 'poweroff'),
        guestOs: info['ostype'],
        memoryUsedMb: info['memory'] ? parseInt(info['memory'], 10) : undefined,
      };
    } catch (error) {
      return {
        id: vmId,
        name: vmId,
        state: 'error',
      };
    }
  }

  async modifyVM(vmId: string, resources: Partial<VMResourceConfig>): Promise<VMOperationResult> {
    // Can only modify when powered off
    const status = await this.getVMStatus(vmId);
    if (status.state !== 'powered_off' && status.state !== 'saved') {
      return { success: false, error: 'VM must be powered off to modify resources' };
    }

    try {
      const args: string[] = ['modifyvm', vmId];
      if (resources.cpuCount !== undefined) args.push('--cpus', String(resources.cpuCount));
      if (resources.memoryMb !== undefined) args.push('--memory', String(resources.memoryMb));
      if (resources.vramMb !== undefined) args.push('--vram', String(resources.vramMb));

      if (args.length > 2) {
        await this.vbox(...args);
      }

      log('[VBox] Modified VM:', vmId);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  }

  async listVMs(): Promise<VMStatus[]> {
    try {
      const { stdout } = await this.vbox('list', 'vms');
      const vmNames: string[] = [];
      for (const line of stdout.split('\n')) {
        const match = line.match(/^"(.+)"\s+\{.+\}$/);
        if (match) vmNames.push(match[1]);
      }

      const statuses: VMStatus[] = [];
      for (const name of vmNames) {
        statuses.push(await this.getVMStatus(name));
      }
      return statuses;
    } catch (error) {
      logError('[VBox] Failed to list VMs:', error);
      return [];
    }
  }

  async enableVRDE(vmId: string, port: number): Promise<VMOperationResult> {
    try {
      const status = await this.getVMStatus(vmId);
      if (status.state !== 'powered_off' && status.state !== 'saved') {
        return { success: false, error: 'VM must be powered off to enable VRDE' };
      }
      await this.vbox(
        'modifyvm', vmId,
        '--vrde', 'on',
        '--vrdeport', String(port),
        '--vrdeaddress', '127.0.0.1',
      );
      log('[VBox] Enabled VRDE on port', port, 'for VM:', vmId);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[VBox] Failed to enable VRDE:', msg);
      return { success: false, error: msg };
    }
  }

  async disableVRDE(vmId: string): Promise<VMOperationResult> {
    try {
      const status = await this.getVMStatus(vmId);
      if (status.state !== 'powered_off' && status.state !== 'saved') {
        return { success: false, error: 'VM must be powered off to disable VRDE' };
      }
      await this.vbox('modifyvm', vmId, '--vrde', 'off');
      log('[VBox] Disabled VRDE for VM:', vmId);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[VBox] Failed to disable VRDE:', msg);
      return { success: false, error: msg };
    }
  }

  async screenshotVM(vmId: string, outputPath: string): Promise<VMOperationResult> {
    try {
      await this.vbox('controlvm', vmId, 'screenshotpng', outputPath);
      log('[VBox] Screenshot saved:', outputPath);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[VBox] Failed to take screenshot:', msg);
      return { success: false, error: msg };
    }
  }

  // ── Guest provisioning helpers ───────────────────────────────────

  async addSharedFolder(
    vmName: string,
    folderName: string,
    hostPath: string,
    autoMount = true,
  ): Promise<VMOperationResult> {
    try {
      const args = ['sharedfolder', 'add', vmName, '--name', folderName, '--hostpath', hostPath];
      if (autoMount) args.push('--automount');
      await this.vbox(...args);
      log('[VBox] Added shared folder:', folderName, '->', hostPath);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[VBox] Failed to add shared folder:', msg);
      return { success: false, error: msg };
    }
  }

  async addPortForwarding(
    vmName: string,
    ruleName: string,
    protocol: 'tcp' | 'udp',
    hostPort: number,
    guestPort: number,
  ): Promise<VMOperationResult> {
    try {
      await this.vbox(
        'modifyvm', vmName,
        '--natpf1', `${ruleName},${protocol},,${hostPort},,${guestPort}`,
      );
      log('[VBox] Added port forward:', ruleName, hostPort, '->', guestPort);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[VBox] Failed to add port forward:', msg);
      return { success: false, error: msg };
    }
  }

  async removePortForwarding(vmName: string, ruleName: string): Promise<VMOperationResult> {
    try {
      await this.vbox('modifyvm', vmName, '--natpf1', `delete ${ruleName}`);
      log('[VBox] Removed port forward:', ruleName);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  }

  async keyboardPutString(vmName: string, text: string): Promise<VMOperationResult> {
    try {
      await this.vbox('controlvm', vmName, 'keyboardputstring', text);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[VBox] keyboardputstring failed:', msg);
      return { success: false, error: msg };
    }
  }

  async keyboardPutScancode(vmName: string, ...codes: string[]): Promise<VMOperationResult> {
    try {
      await this.vbox('controlvm', vmName, 'keyboardputscancode', ...codes);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[VBox] keyboardputscancode failed:', msg);
      return { success: false, error: msg };
    }
  }

  /** Get the resolved VBoxManage path (used by provisioner) */
  getVBoxManagePath(): string | null {
    return this.vboxManagePath;
  }

  async openDisplay(vmId: string): Promise<VMOperationResult> {
    try {
      // If VM is already running headless, open a separate GUI window
      const status = await this.getVMStatus(vmId);
      if (status.state === 'running') {
        // Use "separate" type to attach a GUI window to a running VM
        await this.vbox('startvm', vmId, '--type', 'separate');
      } else if (status.state === 'powered_off' || status.state === 'saved') {
        // Start with GUI
        await this.vbox('startvm', vmId, '--type', 'gui');
      } else {
        return { success: false, error: `Cannot open display in state: ${status.state}` };
      }
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  }
}
