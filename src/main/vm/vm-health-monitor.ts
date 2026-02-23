/**
 * VM Health Monitor
 *
 * Background service that periodically polls VM state, detects crashes,
 * tracks state transitions, and can auto-restart failed VMs.
 *
 * Runs in the main process alongside VMManager.
 */

import { log, logError } from '../utils/logger';
import { vmManager } from './vm-manager';
import type { VMState, VMHealthEvent, VMHealthSummary } from './types';

const POLL_INTERVAL_MS = 15_000;
const MAX_RESTART_ATTEMPTS = 3;

type HealthEventCallback = (event: VMHealthEvent) => void;

export class VMHealthMonitor {
  private static instance: VMHealthMonitor | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private eventCallback: HealthEventCallback | null = null;

  /** Tracked state per VM */
  private previousStates = new Map<string, VMState>();
  private crashCounts = new Map<string, number>();
  private lastCrash = new Map<string, number>();
  private autoRestartEnabled = new Map<string, boolean>();
  private upSince = new Map<string, number>();
  private lastChecked = 0;

  static getInstance(): VMHealthMonitor {
    if (!VMHealthMonitor.instance) {
      VMHealthMonitor.instance = new VMHealthMonitor();
    }
    return VMHealthMonitor.instance;
  }

  /** Start the polling loop */
  start(callback: HealthEventCallback): void {
    if (this.interval) {
      log('[VMHealthMonitor] Already running');
      return;
    }
    this.eventCallback = callback;
    log('[VMHealthMonitor] Starting health monitor (interval:', POLL_INTERVAL_MS, 'ms)');

    // Run the first poll immediately
    this.poll();
    this.interval = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  /** Stop the polling loop */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      log('[VMHealthMonitor] Stopped');
    }
  }

  /** Toggle auto-restart for a specific VM */
  setAutoRestart(vmId: string, enabled: boolean): void {
    this.autoRestartEnabled.set(vmId, enabled);
    if (enabled) {
      // Reset crash count when re-enabling
      this.crashCounts.set(vmId, 0);
    }
    log('[VMHealthMonitor] Auto-restart for', vmId, ':', enabled);
  }

  /** Get health summaries for all VMs */
  getHealthSummary(): VMHealthSummary[] {
    const configs = vmManager.getAllVMConfigs();
    return configs.map((config) => ({
      vmId: config.id,
      vmName: config.name,
      state: this.previousStates.get(config.id) || 'powered_off',
      healthy: this.isHealthy(config.id),
      lastChecked: this.lastChecked,
      upSince: this.upSince.get(config.id),
      crashCount: this.crashCounts.get(config.id) || 0,
      lastCrash: this.lastCrash.get(config.id),
      autoRestartEnabled: this.autoRestartEnabled.get(config.id) ?? true,
    }));
  }

  private isHealthy(vmId: string): boolean {
    const state = this.previousStates.get(vmId);
    if (!state) return true; // Unknown = assume OK
    return state !== 'error';
  }

  private emit(event: VMHealthEvent): void {
    log(`[VMHealthMonitor] ${event.type}: ${event.vmName} (${event.currentState})`);
    this.eventCallback?.(event);
  }

  private async poll(): Promise<void> {
    try {
      const statuses = await vmManager.listVMs();
      this.lastChecked = Date.now();

      for (const status of statuses) {
        const prevState = this.previousStates.get(status.id);
        const currState = status.state;

        // First time seeing this VM
        if (prevState === undefined) {
          this.previousStates.set(status.id, currState);
          if (currState === 'running') {
            this.upSince.set(status.id, Date.now());
          }
          // Default auto-restart to true for all VMs
          if (!this.autoRestartEnabled.has(status.id)) {
            this.autoRestartEnabled.set(status.id, true);
          }
          continue;
        }

        // No change
        if (prevState === currState) continue;

        // State transition detected
        this.previousStates.set(status.id, currState);

        // Track upSince
        if (currState === 'running' && prevState !== 'running') {
          this.upSince.set(status.id, Date.now());
        } else if (currState !== 'running') {
          this.upSince.delete(status.id);
        }

        // Detect crash: running → error or running → powered_off (unexpected)
        const isCrash =
          (prevState === 'running' && currState === 'error') ||
          (prevState === 'running' && currState === 'powered_off');

        if (isCrash) {
          const count = (this.crashCounts.get(status.id) || 0) + 1;
          this.crashCounts.set(status.id, count);
          this.lastCrash.set(status.id, Date.now());

          this.emit({
            vmId: status.id,
            vmName: status.name,
            type: 'crash_detected',
            previousState: prevState,
            currentState: currState,
            timestamp: Date.now(),
            message: `VM "${status.name}" crashed (${prevState} → ${currState}). Crash count: ${count}`,
          });

          // Auto-restart if enabled and under limit
          const autoRestart = this.autoRestartEnabled.get(status.id) ?? true;
          if (autoRestart && count <= MAX_RESTART_ATTEMPTS) {
            this.emit({
              vmId: status.id,
              vmName: status.name,
              type: 'auto_restart',
              currentState: 'starting',
              timestamp: Date.now(),
              message: `Auto-restarting "${status.name}" (attempt ${count}/${MAX_RESTART_ATTEMPTS})`,
              autoRestartAttempt: count,
            });

            try {
              const result = await vmManager.startVM(status.id);
              if (!result.success) {
                logError('[VMHealthMonitor] Auto-restart failed:', result.error);
              }
            } catch (err) {
              logError('[VMHealthMonitor] Auto-restart error:', err);
            }
          }
        } else {
          // Normal state transition
          this.emit({
            vmId: status.id,
            vmName: status.name,
            type: 'state_changed',
            previousState: prevState,
            currentState: currState,
            timestamp: Date.now(),
            message: `VM "${status.name}": ${prevState} → ${currState}`,
          });
        }
      }
    } catch (err) {
      logError('[VMHealthMonitor] Poll error:', err);
    }
  }
}

export function getVMHealthMonitor(): VMHealthMonitor {
  return VMHealthMonitor.getInstance();
}
