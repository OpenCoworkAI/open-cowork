/**
 * CoworkDesktopView - Split-pane view with embedded VM desktop and chat
 *
 * Left panel: VM desktop (noVNC viewer) with control bar
 * Right panel: ChatView for interacting with Navi alongside the VM
 * Placeholder shown when no VM is running.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Monitor,
  Play,
  Square,
  Eye,
  EyeOff,
  Cpu,
  HardDrive,
  Server,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useAppStore } from '../store';
import { VMDesktopViewer } from './VMDesktopViewer';

export function CoworkDesktopView() {
  const {
    activeCoworkVM,
    coworkVNCUrl,
    coworkComputerUseEnabled,
    setCoworkComputerUseEnabled,
    setActiveCoworkVM,
    setCoworkVNCUrl,
    vmList,
    setActiveView,
  } = useAppStore();

  const [viewOnly, setViewOnly] = useState(false);
  const [vncConnected, setVncConnected] = useState(false);

  // If we have an active VM and VNC URL, show the desktop
  if (activeCoworkVM && coworkVNCUrl) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* VM Desktop */}
        <div className="flex-1 relative">
          <VMDesktopViewer
            wsUrl={coworkVNCUrl}
            vmId={activeCoworkVM.id}
            vmName={activeCoworkVM.name}
            viewOnly={viewOnly}
            onConnect={() => setVncConnected(true)}
            onDisconnect={() => setVncConnected(false)}
            className="h-full"
          />
        </div>

        {/* Control Bar */}
        <ControlBar
          vmId={activeCoworkVM.id}
          vmName={activeCoworkVM.name}
          vmState={activeCoworkVM.state}
          viewOnly={viewOnly}
          computerUseEnabled={coworkComputerUseEnabled}
          vncConnected={vncConnected}
          onToggleViewOnly={() => setViewOnly(!viewOnly)}
          onToggleComputerUse={async () => {
            const api = (window as any).electronAPI;
            const newEnabled = !coworkComputerUseEnabled;
            await api?.vm?.enableComputerUse(activeCoworkVM.id, newEnabled);
            setCoworkComputerUseEnabled(newEnabled);
          }}
          onStop={async () => {
            const api = (window as any).electronAPI;
            await api?.vm?.stopWithVNC(activeCoworkVM.id);
            setActiveCoworkVM(null);
            setCoworkVNCUrl(null);
            setCoworkComputerUseEnabled(false);
          }}
        />
      </div>
    );
  }

  // No active VM — show placeholder
  return <CoworkDesktopPlaceholder />;
}

// ── Control Bar ───────────────────────────────────────────────────

interface ControlBarProps {
  vmId: string;
  vmName: string;
  vmState: string;
  viewOnly: boolean;
  computerUseEnabled: boolean;
  vncConnected: boolean;
  onToggleViewOnly: () => void;
  onToggleComputerUse: () => void;
  onStop: () => void;
}

function ControlBar({
  vmName,
  vmState,
  viewOnly,
  computerUseEnabled,
  vncConnected,
  onToggleViewOnly,
  onToggleComputerUse,
  onStop,
}: ControlBarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-surface border-t border-border">
      <div className="flex items-center gap-4">
        {/* View-only toggle */}
        <button
          onClick={onToggleViewOnly}
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
          title={viewOnly ? 'Enable input to VM' : 'View only (no mouse/keyboard)'}
        >
          {viewOnly ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {viewOnly ? 'View Only' : 'Interactive'}
        </button>

        {/* Computer Use toggle */}
        <button
          onClick={onToggleComputerUse}
          className={`flex items-center gap-1.5 text-xs transition-colors ${
            computerUseEnabled
              ? 'text-accent hover:text-accent/80'
              : 'text-text-muted hover:text-text-primary'
          }`}
          title={
            computerUseEnabled
              ? 'Navi can see & interact with the VM'
              : 'Enable Navi to see & interact with the VM'
          }
        >
          <Monitor className="w-3.5 h-3.5" />
          {computerUseEnabled ? 'Navi: Active' : 'Navi: Inactive'}
        </button>

        {/* Connection status */}
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <div
            className={`w-2 h-2 rounded-full ${vncConnected ? 'bg-green-500' : 'bg-red-500'}`}
          />
          {vncConnected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onStop}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors"
        >
          <Square className="w-3.5 h-3.5" />
          Stop VM
        </button>
      </div>
    </div>
  );
}

// ── Placeholder ───────────────────────────────────────────────────

function CoworkDesktopPlaceholder() {
  const { vmList, setActiveView, setActiveCoworkVM, setCoworkVNCUrl } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [availableVMs, setAvailableVMs] = useState<Array<{ id: string; name: string; state: string }>>([]);

  // Load VM list on mount
  useEffect(() => {
    const loadVMs = async () => {
      const api = (window as any).electronAPI;
      if (!api?.vm?.listVMs) return;
      try {
        const vms = await api.vm.listVMs();
        setAvailableVMs(vms || []);
      } catch {
        // ignore
      }
    };
    loadVMs();
  }, []);

  const handleStartVM = async (vmId: string, vmName: string) => {
    setLoading(true);
    try {
      const api = (window as any).electronAPI;
      const result = await api.vm.startWithVNC(vmId);
      if (result.success && result.wsUrl) {
        setActiveCoworkVM({ id: vmId, name: vmName, state: 'running' });
        setCoworkVNCUrl(result.wsUrl);
      }
    } finally {
      setLoading(false);
    }
  };

  const poweredOffVMs = availableVMs.filter(
    vm => vm.state === 'powered_off' || vm.state === 'saved',
  );

  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-4">
          <Monitor className="w-8 h-8 text-accent" />
        </div>
        <h2 className="text-lg font-semibold text-text-primary mb-2">
          Cowork Desktop
        </h2>
        <p className="text-sm text-text-muted mb-6">
          Launch a virtual desktop environment where you and Navi can work
          together. Navi can see the screen and interact with applications
          using Computer Use.
        </p>

        {loading && (
          <div className="flex items-center justify-center gap-2 text-accent mb-4">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-sm">Starting VM...</span>
          </div>
        )}

        {/* Available VMs to launch */}
        {poweredOffVMs.length > 0 && !loading && (
          <div className="mb-4">
            <p className="text-xs text-text-muted mb-2">Available desktops:</p>
            <div className="flex flex-col gap-2">
              {poweredOffVMs.map(vm => (
                <button
                  key={vm.id}
                  onClick={() => handleStartVM(vm.id, vm.name)}
                  className="flex items-center gap-3 w-full px-4 py-3 rounded-xl border border-border bg-surface hover:bg-surface-hover transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                    <Server className="w-4 h-4 text-accent" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-text-primary">{vm.name}</div>
                    <div className="text-xs text-text-muted capitalize">{vm.state.replace('_', ' ')}</div>
                  </div>
                  <Play className="w-4 h-4 text-accent" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Create new VM */}
        <button
          onClick={() => setActiveView('vm')}
          className="flex items-center gap-2 mx-auto px-4 py-2 rounded-xl border border-border bg-surface hover:bg-surface-hover transition-colors text-sm text-text-primary"
        >
          <Plus className="w-4 h-4" />
          Create New Desktop
        </button>
      </div>
    </div>
  );
}
