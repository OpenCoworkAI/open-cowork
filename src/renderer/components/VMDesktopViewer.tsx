/**
 * VMDesktopViewer - Embeds a noVNC viewer for a running VirtualBox VM
 *
 * Connects to a WebSocket proxy that bridges to the VM's VRDE/VNC port.
 * Used inside CoworkDesktopView for the embedded co-working experience.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { VncScreen } from 'react-vnc';
import { Monitor, Maximize2, Minimize2, Eye, RefreshCw } from 'lucide-react';

interface VMDesktopViewerProps {
  wsUrl: string;
  vmId: string;
  vmName: string;
  viewOnly?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  className?: string;
}

export function VMDesktopViewer({
  wsUrl,
  vmId: _vmId,
  vmName,
  viewOnly = false,
  onConnect,
  onDisconnect,
  className = '',
}: VMDesktopViewerProps) {
  const vncRef = useRef<any>(null);
  const [connected, setConnected] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleConnect = useCallback(() => {
    setConnected(true);
    onConnect?.();
  }, [onConnect]);

  const handleDisconnect = useCallback(() => {
    setConnected(false);
    onDisconnect?.();
  }, [onDisconnect]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!fullscreen) {
      containerRef.current.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setFullscreen(!fullscreen);
  }, [fullscreen]);

  // Listen for fullscreen changes
  useEffect(() => {
    const handler = () => {
      setFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col rounded-xl overflow-hidden border border-border bg-black ${className}`}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface border-b border-border z-10">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-accent" />
          <span className="text-xs font-medium text-text-primary">{vmName}</span>
          <span
            className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
            title={connected ? 'Connected' : 'Disconnected'}
          />
          {!connected && (
            <span className="text-xs text-text-muted">Connecting...</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {viewOnly && (
            <div className="flex items-center gap-1 text-text-muted" title="View only mode">
              <Eye className="w-3.5 h-3.5" />
              <span className="text-xs">View only</span>
            </div>
          )}
          <button
            onClick={toggleFullscreen}
            className="p-1 hover:bg-surface-hover rounded transition-colors"
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? (
              <Minimize2 className="w-3.5 h-3.5 text-text-secondary" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5 text-text-secondary" />
            )}
          </button>
        </div>
      </div>

      {/* VNC Canvas */}
      <div className="flex-1 relative">
        <VncScreen
          url={wsUrl}
          scaleViewport
          clipViewport={false}
          resizeSession={false}
          viewOnly={viewOnly}
          background="#000000"
          style={{ width: '100%', height: '100%' }}
          ref={vncRef}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          retryDuration={3000}
          debug={false}
        />

        {/* Disconnected overlay */}
        {!connected && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="flex flex-col items-center gap-3 text-text-muted">
              <RefreshCw className="w-8 h-8 animate-spin" />
              <span className="text-sm">Connecting to VM display...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
