import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../store';
import {
  Monitor,
  Play,
  Square,
  Pause,
  RotateCcw,
  Trash2,
  ExternalLink,
  AlertCircle,
  Loader2,
  Plus,
  HardDrive,
  MemoryStick,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import type { VMStatus, VMState, VMHealthSummary } from '../types';
import { VMCreateWizard } from './VMCreateWizard';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function stateLabel(state: VMState): string {
  const map: Record<VMState, string> = {
    not_created: 'Not Created',
    powered_off: 'Stopped',
    starting: 'Starting',
    running: 'Running',
    paused: 'Paused',
    saving: 'Saving',
    saved: 'Saved',
    stopping: 'Stopping',
    error: 'Error',
  };
  return map[state] || state;
}

function stateBadgeClass(state: VMState): string {
  switch (state) {
    case 'running':
      return 'bg-green-500/20 text-green-400';
    case 'paused':
    case 'saved':
      return 'bg-yellow-500/20 text-yellow-400';
    case 'starting':
    case 'stopping':
    case 'saving':
      return 'bg-blue-500/20 text-blue-400';
    case 'error':
      return 'bg-red-500/20 text-red-400';
    default:
      return 'bg-zinc-500/20 text-zinc-400';
  }
}

export function VMView() {
  const {
    vmBackendStatus,
    vmList,
    vmImageDownloadProgress,
    vmCreateWizardOpen,
    vmBootstrapProgress,
    vmHealthSummaries,
    vmHealthEvents,
    setVmBackendStatus,
    setVmList,
    setVmCreateWizardOpen,
    setVmHealthSummaries,
  } = useAppStore();

  const [loading, setLoading] = useState(false);
  const [actionLabel, setActionLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-open wizard when bootstrap triggers first-run setup
  useEffect(() => {
    if (vmBootstrapProgress?.phase === 'prompting_setup' && !vmCreateWizardOpen) {
      setVmCreateWizardOpen(true);
    }
  }, [vmBootstrapProgress?.phase, vmCreateWizardOpen, setVmCreateWizardOpen]);

  // Fetch health summaries alongside VM list
  const fetchHealthSummaries = useCallback(async () => {
    if (!isElectron) return;
    try {
      const summaries = await window.electronAPI.vm.getHealthSummary();
      setVmHealthSummaries(summaries);
    } catch { /* ignore */ }
  }, [setVmHealthSummaries]);

  // ── Init: check backend and load VMs ──
  const refresh = useCallback(async () => {
    if (!isElectron) return;
    try {
      const status = await window.electronAPI.vm.checkBackend();
      setVmBackendStatus(status);

      if (status.available) {
        const vms = await window.electronAPI.vm.listVMs();
        setVmList(vms);
        fetchHealthSummaries();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check VM backend');
    }
  }, [setVmBackendStatus, setVmList, fetchHealthSummaries]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll VM status when VMs exist
  useEffect(() => {
    if (!vmBackendStatus?.available || vmList.length === 0) return;

    pollInterval.current = setInterval(async () => {
      try {
        const vms = await window.electronAPI.vm.listVMs();
        setVmList(vms);
      } catch { /* ignore polling errors */ }
    }, 5000);

    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, [vmBackendStatus?.available, vmList.length, setVmList]);

  // Listen for download progress events
  useEffect(() => {
    if (!isElectron) return;
    // The useIPC hook in App.tsx handles server events.
    // For download progress, we rely on the store being updated by the IPC handler.
  }, []);

  // ── VM Actions ──
  const doAction = useCallback(async (label: string, fn: () => Promise<{ success: boolean; error?: string }>) => {
    setLoading(true);
    setActionLabel(label);
    setError(null);
    try {
      const result = await fn();
      if (!result.success) {
        setError(result.error || 'Operation failed');
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setLoading(false);
      setActionLabel('');
    }
  }, [refresh]);

  const startVM = (vmId: string) => doAction('Starting VM...', () => window.electronAPI.vm.startVM(vmId));
  const stopVM = (vmId: string) => doAction('Stopping VM...', () => window.electronAPI.vm.stopVM(vmId));
  const forceStopVM = (vmId: string) => doAction('Force stopping VM...', () => window.electronAPI.vm.forceStopVM(vmId));
  const pauseVM = (vmId: string) => doAction('Pausing VM...', () => window.electronAPI.vm.pauseVM(vmId));
  const resumeVM = (vmId: string) => doAction('Resuming VM...', () => window.electronAPI.vm.resumeVM(vmId));
  const openDisplay = (vmId: string) => doAction('Opening display...', () => window.electronAPI.vm.openDisplay(vmId));

  const deleteVM = async (vmId: string, vmName: string) => {
    // Simple confirmation
    if (!confirm(`Delete VM "${vmName}"? This will remove the VM and its disk files permanently.`)) return;
    doAction('Deleting VM...', () => window.electronAPI.vm.deleteVM(vmId));
  };

  // ── Render ──

  // Backend not available
  if (vmBackendStatus && !vmBackendStatus.available) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="max-w-lg w-full bg-surface rounded-2xl border border-border p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-yellow-500/10 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-yellow-400" />
          </div>
          <h2 className="text-xl font-semibold text-text-primary mb-2">VirtualBox Not Found</h2>
          <p className="text-text-secondary mb-6">
            Virtual Machines require Oracle VirtualBox to be installed on your system.
            VirtualBox is free and works on Windows, macOS, and Linux.
          </p>
          <button
            onClick={() => window.electronAPI.openExternal('https://www.virtualbox.org/wiki/Downloads')}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-xl font-medium hover:bg-accent/90 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Download VirtualBox
          </button>
          <p className="text-xs text-text-tertiary mt-4">
            After installing VirtualBox, restart the app and come back here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Monitor className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-text-primary">Virtual Machines</h1>
            <p className="text-xs text-text-secondary">
              {vmBackendStatus?.available
                ? `VirtualBox ${vmBackendStatus.version || ''}`
                : 'Checking backend...'}
            </p>
          </div>
        </div>
        <button
          onClick={() => setVmCreateWizardOpen(true)}
          disabled={!vmBackendStatus?.available}
          className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-xl font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4" />
          New VM
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <p className="text-sm text-red-400 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 text-xs">
            Dismiss
          </button>
        </div>
      )}

      {/* Loading overlay */}
      {loading && (
        <div className="mx-6 mt-4 px-4 py-3 bg-accent/10 border border-accent/20 rounded-xl flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-accent animate-spin shrink-0" />
          <p className="text-sm text-accent">{actionLabel}</p>
        </div>
      )}

      {/* Bootstrap progress */}
      {vmBootstrapProgress && vmBootstrapProgress.phase !== 'ready' && vmBootstrapProgress.phase !== 'skipped' && (
        <div className="mx-6 mt-4 px-4 py-3 bg-accent/10 border border-accent/20 rounded-xl">
          <div className="flex items-center gap-3 mb-2">
            {vmBootstrapProgress.phase === 'error' ? (
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            ) : (
              <Loader2 className="w-5 h-5 text-accent animate-spin shrink-0" />
            )}
            <p className="text-sm text-text-primary">{vmBootstrapProgress.message}</p>
          </div>
          {vmBootstrapProgress.detail && (
            <p className="text-xs text-text-secondary ml-8">{vmBootstrapProgress.detail}</p>
          )}
          {vmBootstrapProgress.progress != null && vmBootstrapProgress.phase !== 'error' && (
            <div className="w-full bg-accent/20 rounded-full h-1.5 mt-2">
              <div
                className="bg-accent h-1.5 rounded-full transition-all"
                style={{ width: `${vmBootstrapProgress.progress}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Recent crash alert */}
      {vmHealthEvents.length > 0 && vmHealthEvents[vmHealthEvents.length - 1].type === 'crash_detected' && (
        <div className="mx-6 mt-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
          <p className="text-sm text-red-400 flex-1">
            {vmHealthEvents[vmHealthEvents.length - 1].message}
          </p>
        </div>
      )}

      {/* Download progress */}
      {vmImageDownloadProgress && vmImageDownloadProgress.status === 'downloading' && (
        <div className="mx-6 mt-4 px-4 py-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-blue-400">Downloading OS image...</p>
            <p className="text-xs text-blue-400">
              {formatBytes(vmImageDownloadProgress.bytesDownloaded)} / {formatBytes(vmImageDownloadProgress.totalBytes)}
            </p>
          </div>
          <div className="w-full bg-blue-500/20 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: `${vmImageDownloadProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* VM List */}
      <div className="flex-1 overflow-y-auto p-6">
        {!vmBackendStatus ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-8 h-8 text-accent animate-spin" />
          </div>
        ) : vmList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-20 h-20 rounded-2xl bg-surface-hover flex items-center justify-center mb-4">
              <Monitor className="w-10 h-10 text-text-tertiary" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary mb-2">No Virtual Machines</h2>
            <p className="text-sm text-text-secondary mb-6 max-w-sm">
              Create your first VM to get started. Choose from popular Linux distributions
              or import your own ISO image.
            </p>
            <button
              onClick={() => setVmCreateWizardOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-xl font-medium hover:bg-accent/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create VM
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {vmList.map((vm) => {
              const health = vmHealthSummaries.find(h => h.vmId === vm.id);
              return (
                <VMCard
                  key={vm.id}
                  vm={vm}
                  health={health}
                  loading={loading}
                  onStart={() => startVM(vm.id)}
                  onStop={() => stopVM(vm.id)}
                  onForceStop={() => forceStopVM(vm.id)}
                  onPause={() => pauseVM(vm.id)}
                  onResume={() => resumeVM(vm.id)}
                  onOpenDisplay={() => openDisplay(vm.id)}
                  onDelete={() => deleteVM(vm.id, vm.name)}
                  onToggleAutoRestart={async (enabled) => {
                    await window.electronAPI.vm.setAutoRestart(vm.id, enabled);
                    fetchHealthSummaries();
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Create Wizard Modal */}
      {vmCreateWizardOpen && (
        <VMCreateWizard
          onClose={() => setVmCreateWizardOpen(false)}
          onCreated={() => {
            setVmCreateWizardOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ── VM Card Component ──

interface VMCardProps {
  vm: VMStatus;
  health?: VMHealthSummary;
  loading: boolean;
  onStart: () => void;
  onStop: () => void;
  onForceStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onOpenDisplay: () => void;
  onDelete: () => void;
  onToggleAutoRestart: (enabled: boolean) => void;
}

function VMCard({ vm, health, loading, onStart, onStop, onForceStop, onPause, onResume, onOpenDisplay, onDelete, onToggleAutoRestart }: VMCardProps) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5 hover:border-border-hover transition-colors">
      <div className="flex items-center justify-between">
        {/* Left: VM info */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center relative">
            <Monitor className="w-6 h-6 text-accent" />
            {/* Health dot */}
            {health && (
              <span
                className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-surface ${
                  health.healthy ? 'bg-green-400' : 'bg-red-400'
                }`}
                title={health.healthy ? 'Healthy' : `Unhealthy — ${health.crashCount} crash(es)`}
              />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-text-primary">{vm.name}</h3>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${stateBadgeClass(vm.state)}`}>
                {stateLabel(vm.state)}
              </span>
              {health && health.crashCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400" title="Crash count">
                  {health.crashCount} crash{health.crashCount > 1 ? 'es' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-text-tertiary">
              {vm.guestOs && (
                <span className="flex items-center gap-1">
                  <HardDrive className="w-3 h-3" />
                  {vm.guestOs}
                </span>
              )}
              {vm.memoryUsedMb && (
                <span className="flex items-center gap-1">
                  <MemoryStick className="w-3 h-3" />
                  {vm.memoryUsedMb} MB
                </span>
              )}
              {health && (
                <button
                  onClick={() => onToggleAutoRestart(!health.autoRestartEnabled)}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
                    health.autoRestartEnabled
                      ? 'text-green-400 hover:bg-green-500/10'
                      : 'text-text-tertiary hover:bg-surface-hover'
                  }`}
                  title={health.autoRestartEnabled ? 'Auto-restart enabled' : 'Auto-restart disabled'}
                >
                  {health.autoRestartEnabled ? (
                    <ShieldCheck className="w-3 h-3" />
                  ) : (
                    <ShieldAlert className="w-3 h-3" />
                  )}
                  Auto-restart {health.autoRestartEnabled ? 'on' : 'off'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {vm.state === 'powered_off' || vm.state === 'saved' ? (
            <button
              onClick={onStart}
              disabled={loading}
              className="p-2 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors disabled:opacity-50"
              title="Start VM"
            >
              <Play className="w-4 h-4" />
            </button>
          ) : vm.state === 'running' ? (
            <>
              <button
                onClick={onOpenDisplay}
                disabled={loading}
                className="p-2 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
                title="Open Display"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
              <button
                onClick={onPause}
                disabled={loading}
                className="p-2 rounded-lg bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
                title="Pause VM"
              >
                <Pause className="w-4 h-4" />
              </button>
              <button
                onClick={onStop}
                disabled={loading}
                className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                title="Stop VM (ACPI Shutdown)"
              >
                <Square className="w-4 h-4" />
              </button>
            </>
          ) : vm.state === 'paused' ? (
            <>
              <button
                onClick={onResume}
                disabled={loading}
                className="p-2 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors disabled:opacity-50"
                title="Resume VM"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={onForceStop}
                disabled={loading}
                className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                title="Force Stop"
              >
                <Square className="w-4 h-4" />
              </button>
            </>
          ) : null}

          {(vm.state === 'powered_off' || vm.state === 'error') && (
            <button
              onClick={onDelete}
              disabled={loading}
              className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
              title="Delete VM"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
