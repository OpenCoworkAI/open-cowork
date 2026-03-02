/**
 * VMCards - Generative UI cards for VM Cowork Desktop
 *
 * Three card types emitted by Navi as ```json:vm-* blocks:
 * - vm-status: Shows current VM state with inline controls
 * - vm-provision: Shows OS/resource suggestion with "Create VM" CTA
 * - vm-suggestion: Navi suggesting launching a VM for the current task
 */

import {
  Monitor,
  Play,
  Square,
  Cpu,
  HardDrive,
  Eye,
  Rocket,
  Server,
  ArrowRight,
} from 'lucide-react';
import { useAppStore } from '../store';
import type {
  VMStatusCardData,
  VMProvisionCardData,
  VMSuggestionCardData,
} from '../types/career';

// ── VM Status Card ────────────────────────────────────────────────

export function VMStatusCard({ data }: { data: VMStatusCardData }) {
  const { setActiveView } = useAppStore();

  const stateColors: Record<string, string> = {
    running: 'text-green-500',
    powered_off: 'text-text-muted',
    paused: 'text-yellow-500',
    starting: 'text-blue-400',
    stopping: 'text-orange-400',
    error: 'text-red-500',
  };

  const stateLabels: Record<string, string> = {
    running: 'Running',
    powered_off: 'Powered Off',
    paused: 'Paused',
    starting: 'Starting...',
    stopping: 'Stopping...',
    error: 'Error',
    saved: 'Saved',
    not_created: 'Not Created',
  };

  const handleStartVM = async () => {
    const api = (window as any).electronAPI;
    if (!api?.vm?.startWithVNC) return;
    const result = await api.vm.startWithVNC(data.vmId);
    if (result.success && result.wsUrl) {
      const store = useAppStore.getState();
      store.setActiveCoworkVM({ id: data.vmId, name: data.vmName, state: 'running' });
      store.setCoworkVNCUrl(result.wsUrl);
      store.setActiveView('cowork-desktop');
    }
  };

  const handleStopVM = async () => {
    const api = (window as any).electronAPI;
    if (!api?.vm?.stopWithVNC) return;
    await api.vm.stopWithVNC(data.vmId);
  };

  const handleOpenDesktop = () => {
    setActiveView('cowork-desktop');
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-4 my-2">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
            <Monitor className="w-4 h-4 text-accent" />
          </div>
          <div>
            <h4 className="text-sm font-medium text-text-primary">{data.vmName}</h4>
            <span className={`text-xs ${stateColors[data.state] || 'text-text-muted'}`}>
              {stateLabels[data.state] || data.state}
            </span>
          </div>
        </div>
        {data.computerUseEnabled && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs">
            <Eye className="w-3 h-3" />
            Navi can see
          </div>
        )}
      </div>

      {/* Resources */}
      {(data.cpuCount || data.memoryMb) && (
        <div className="flex gap-4 mb-3 text-xs text-text-muted">
          {data.cpuCount && (
            <div className="flex items-center gap-1">
              <Cpu className="w-3 h-3" />
              {data.cpuCount} CPU{data.cpuCount > 1 ? 's' : ''}
            </div>
          )}
          {data.memoryMb && (
            <div className="flex items-center gap-1">
              <HardDrive className="w-3 h-3" />
              {data.memoryMb >= 1024 ? `${(data.memoryMb / 1024).toFixed(1)} GB` : `${data.memoryMb} MB`} RAM
            </div>
          )}
          {data.os && (
            <div className="flex items-center gap-1">
              <Server className="w-3 h-3" />
              {data.os}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {data.state === 'running' && (
          <>
            <button
              onClick={handleOpenDesktop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors"
            >
              <Monitor className="w-3.5 h-3.5" />
              Open Desktop
            </button>
            <button
              onClick={handleStopVM}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-hover text-text-secondary text-xs font-medium hover:text-red-500 transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
          </>
        )}
        {(data.state === 'powered_off' || data.state === 'saved') && (
          <button
            onClick={handleStartVM}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            Start Desktop
          </button>
        )}
      </div>
    </div>
  );
}

// ── VM Provision Card ─────────────────────────────────────────────

export function VMProvisionCard({ data }: { data: VMProvisionCardData }) {
  const handleCreateVM = async () => {
    const api = (window as any).electronAPI;
    if (!api?.vm?.createVM) return;

    const resources = data.suggestedResources || { cpuCount: 2, memoryMb: 4096, diskSizeGb: 25 };
    const osImageId = data.suggestedOs || 'ubuntu-24.04-desktop-x64';

    const result = await api.vm.createVM({
      name: `Cowork-${Date.now()}`,
      osImageId,
      resources: {
        ...resources,
        displayMode: 'separate_window',
        vramMb: 128,
        enableEFI: true,
      },
    });

    if (result.success && result.vmId) {
      // Start the VM with VNC after creation
      const startResult = await api.vm.startWithVNC(result.vmId);
      if (startResult.success && startResult.wsUrl) {
        const store = useAppStore.getState();
        store.setActiveCoworkVM({ id: result.vmId, name: `Cowork-${Date.now()}`, state: 'running' });
        store.setCoworkVNCUrl(startResult.wsUrl);
        store.setActiveView('cowork-desktop');
      }
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-4 my-2">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <Rocket className="w-4 h-4 text-blue-500" />
        </div>
        <div>
          <h4 className="text-sm font-medium text-text-primary">Create Cowork Desktop</h4>
          {data.reason && (
            <p className="text-xs text-text-muted">{data.reason}</p>
          )}
        </div>
      </div>

      {/* Suggested config */}
      <div className="flex gap-4 mb-3 text-xs text-text-muted">
        {data.suggestedOs && (
          <div className="flex items-center gap-1">
            <Server className="w-3 h-3" />
            {data.suggestedOs}
          </div>
        )}
        {data.suggestedResources && (
          <>
            <div className="flex items-center gap-1">
              <Cpu className="w-3 h-3" />
              {data.suggestedResources.cpuCount} CPUs
            </div>
            <div className="flex items-center gap-1">
              <HardDrive className="w-3 h-3" />
              {(data.suggestedResources.memoryMb / 1024).toFixed(0)} GB RAM
            </div>
          </>
        )}
      </div>

      <button
        onClick={handleCreateVM}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors"
      >
        <Rocket className="w-3.5 h-3.5" />
        Create & Launch
      </button>
    </div>
  );
}

// ── VM Suggestion Card ────────────────────────────────────────────

export function VMSuggestionCard({ data }: { data: VMSuggestionCardData }) {
  const handleLaunch = async () => {
    const store = useAppStore.getState();

    if (data.existingVmId) {
      // Start existing VM
      const api = (window as any).electronAPI;
      if (!api?.vm?.startWithVNC) return;
      const result = await api.vm.startWithVNC(data.existingVmId);
      if (result.success && result.wsUrl) {
        store.setActiveCoworkVM({
          id: data.existingVmId,
          name: data.existingVmName || 'VM',
          state: 'running',
        });
        store.setCoworkVNCUrl(result.wsUrl);
        store.setActiveView('cowork-desktop');
      }
    } else {
      // Open VM management view to create one
      store.setActiveView('vm');
      store.setVmCreateWizardOpen(true);
    }
  };

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 my-2">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Monitor className="w-4 h-4 text-accent" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-medium text-text-primary mb-1">
            Desktop Environment Suggested
          </h4>
          <p className="text-xs text-text-muted mb-3">{data.reason}</p>

          <button
            onClick={handleLaunch}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors"
          >
            {data.existingVmId ? (
              <>
                <Play className="w-3.5 h-3.5" />
                Launch {data.existingVmName || 'Desktop'}
              </>
            ) : (
              <>
                <ArrowRight className="w-3.5 h-3.5" />
                Set Up Desktop
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
