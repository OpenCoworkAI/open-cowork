/**
 * VMBackend Interface - Contract for platform-specific hypervisor backends
 */

import type {
  VMConfig,
  VMStatus,
  VMOperationResult,
  VMResourceConfig,
  BackendStatus,
} from '../types';

export interface VMBackend {
  /** Check if this backend's hypervisor is installed and available */
  checkAvailability(): Promise<BackendStatus>;

  /** Create a new VM from an ISO image path */
  createVM(config: VMConfig, isoPath: string): Promise<VMOperationResult>;

  /** Start a VM with GUI display */
  startVM(vmId: string, gui: boolean): Promise<VMOperationResult>;

  /** Stop a VM (graceful ACPI poweroff) */
  stopVM(vmId: string): Promise<VMOperationResult>;

  /** Force power off a VM */
  forceStopVM(vmId: string): Promise<VMOperationResult>;

  /** Pause a running VM */
  pauseVM(vmId: string): Promise<VMOperationResult>;

  /** Resume a paused VM */
  resumeVM(vmId: string): Promise<VMOperationResult>;

  /** Delete a VM and its disk files */
  deleteVM(vmId: string): Promise<VMOperationResult>;

  /** Get live status of a VM */
  getVMStatus(vmId: string): Promise<VMStatus>;

  /** Modify VM resources (only when powered off) */
  modifyVM(vmId: string, resources: Partial<VMResourceConfig>): Promise<VMOperationResult>;

  /** List all VMs managed by this backend */
  listVMs(): Promise<VMStatus[]>;

  /** Open the VM's display in a separate window */
  openDisplay(vmId: string): Promise<VMOperationResult>;

  /** Enable VRDE (VNC/RDP) remote display on the specified port. VM must be powered off. */
  enableVRDE(vmId: string, port: number): Promise<VMOperationResult>;

  /** Disable VRDE remote display. VM must be powered off. */
  disableVRDE(vmId: string): Promise<VMOperationResult>;

  /** Take a PNG screenshot of the VM display. VM must be running. */
  screenshotVM(vmId: string, outputPath: string): Promise<VMOperationResult>;
}
