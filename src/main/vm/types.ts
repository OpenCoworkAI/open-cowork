/**
 * VM Types - Shared types for the managed VM service
 */

/** VM lifecycle states */
export type VMState =
  | 'not_created'
  | 'powered_off'
  | 'starting'
  | 'running'
  | 'paused'
  | 'saving'
  | 'saved'
  | 'stopping'
  | 'error';

/** Display mode for the VM GUI */
export type VMDisplayMode = 'separate_window' | 'embedded';

/** Platform backend type */
export type VMBackendType = 'virtualbox' | 'apple_vz' | 'qemu';

/** Resource configuration for a VM */
export interface VMResourceConfig {
  cpuCount: number;          // 1-16
  memoryMb: number;          // 512-32768
  diskSizeGb: number;        // 10-500
  displayMode: VMDisplayMode;
  vramMb?: number;           // Video RAM (VirtualBox), default 128
  enableEFI?: boolean;       // Use UEFI firmware, default true
}

/** Full VM configuration (persisted) */
export interface VMConfig {
  id: string;
  name: string;
  osImageId: string;
  resources: VMResourceConfig;
  createdAt: string;
  updatedAt: string;
  backendType: VMBackendType;
  backendVmId?: string;       // Backend-specific ID (e.g., VBox UUID)
  diskPath?: string;
  notes?: string;
  /** Guest provisioning status */
  provisionStatus?: 'not_provisioned' | 'provisioning' | 'provisioned' | 'error';
  /** Host port for NAT forwarding to guest Navi MCP server */
  naviMcpPort?: number;
  /** Guest OS credentials (default: user/password) */
  guestCredentials?: { username: string; password: string };
}

/** Runtime VM status (queried live from backend) */
export interface VMStatus {
  id: string;
  name: string;
  state: VMState;
  cpuUsagePercent?: number;
  memoryUsedMb?: number;
  uptimeSeconds?: number;
  guestOs?: string;
  ipAddress?: string;
}

/** OS image in the catalog */
export interface OSImage {
  id: string;
  name: string;
  distro: string;
  version: string;
  arch: 'x64' | 'arm64';
  downloadUrl: string;
  fileSize: number;
  sha256?: string;
  category: 'linux' | 'windows' | 'other';
  requiresLicense?: boolean;
  minDiskGb: number;
  minMemoryMb: number;
  /** VirtualBox ostype id (e.g., 'Ubuntu_64') */
  vboxOsType?: string;
}

/** Download progress for ISO/image downloads */
export interface ImageDownloadProgress {
  imageId: string;
  status: 'downloading' | 'verifying' | 'complete' | 'error';
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  error?: string;
}

/** Backend availability check result */
export interface BackendStatus {
  type: VMBackendType;
  available: boolean;
  version?: string;
  error?: string;
}

/** Result type for VM operations */
export interface VMOperationResult {
  success: boolean;
  error?: string;
}

/** Persisted store schema */
export interface VMStoreSchema {
  vms: VMConfig[];
  defaultResources: VMResourceConfig;
  imageCachePath?: string;
}

// ── Bootstrap types ─────────────────────────────────────────────────

/** Phases of the VM auto-provisioning bootstrap */
export type VMBootstrapPhase =
  | 'checking_backend'    // Detecting VirtualBox
  | 'checking_existing'   // Looking for existing VMs
  | 'prompting_setup'     // No VMs found, opening wizard for user
  | 'starting_vm'         // Auto-starting newly created VM with GUI
  | 'ready'               // Bootstrap complete
  | 'skipped'             // VirtualBox not found or user has VMs
  | 'error';              // Bootstrap failed

export interface VMBootstrapProgress {
  phase: VMBootstrapPhase;
  message: string;
  detail?: string;
  progress?: number; // 0-100
  error?: string;
}

export interface VMBootstrapResult {
  provisioned: boolean;
  vmId?: string;
  vmName?: string;
  skippedReason?: string;
  error?: string;
}

// ── Health monitoring types ─────────────────────────────────────────

export interface VMHealthEvent {
  vmId: string;
  vmName: string;
  type: 'state_changed' | 'crash_detected' | 'auto_restart' | 'health_check';
  previousState?: VMState;
  currentState: VMState;
  timestamp: number;
  message: string;
  autoRestartAttempt?: number;
}

export interface VMHealthSummary {
  vmId: string;
  vmName: string;
  state: VMState;
  healthy: boolean;
  lastChecked: number;
  upSince?: number;
  crashCount: number;
  lastCrash?: number;
  autoRestartEnabled: boolean;
}

// ── Guest provisioning types ────────────────────────────────────────

/** Phases of guest OS provisioning */
export type GuestProvisionPhase =
  | 'idle'
  | 'preparing'                // Setting up provision directory + HTTP server
  | 'waiting_for_user'         // User must signal OS install complete
  | 'injecting_bootstrap'      // Keyboard injection into guest terminal
  | 'provisioning'             // Guest running provision scripts
  | 'installing_deps'          // Installing system packages
  | 'installing_guest_additions' // Installing VirtualBox Guest Additions
  | 'installing_node'          // Installing Node.js runtime
  | 'installing_navi'          // Installing Navi agent
  | 'configuring_service'      // Setting up systemd service
  | 'verifying'                // Testing guest agent connectivity
  | 'connecting_agent'         // MCP handshake with guest Navi
  | 'done'
  | 'error';

/** Progress event sent to renderer during provisioning */
export interface GuestProvisionProgress {
  vmId: string;
  phase: GuestProvisionPhase;
  message: string;
  detail?: string;
  progress?: number; // 0-100
  error?: string;
}

/** Persisted provisioning status per VM */
export interface GuestProvisionStatus {
  vmId: string;
  phase: GuestProvisionPhase;
  startedAt?: number;
  completedAt?: number;
  naviMcpHostPort?: number;
  error?: string;
}

/** Config written to provision directory for the guest script */
export interface GuestProvisionConfig {
  deviceToken: string;
  apiUrl: string;
  guestUsername: string;
  mcpPort: number;
  workspacePath: string;
}
