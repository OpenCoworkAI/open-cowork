/**
 * SandboxSyncToast - Shows sandbox sync progress as a floating toast
 * Appears when syncing files to WSL/Lima sandbox (only for new sessions)
 * Supports light/dark theme
 */

import { useEffect, useState } from 'react';
import type { SandboxSyncStatus, SandboxSyncPhase } from '../types';

interface Props {
  status: SandboxSyncStatus | null;
}

// Phase display configuration
const phaseConfig: Record<SandboxSyncPhase, { icon: string }> = {
  starting_agent: { icon: '🚀' },
  syncing_files: { icon: '📂' },
  syncing_skills: { icon: '🔧' },
  ready: { icon: '✅' },
  error: { icon: '❌' },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SandboxSyncToast({ status }: Props) {
  const [isVisible, setIsVisible] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    if (status && status.phase !== 'ready') {
      setIsVisible(true);
      setFadeOut(false);
    } else if (status?.phase === 'ready') {
      // Show completion briefly then fade out
      const timer = setTimeout(() => {
        setFadeOut(true);
        setTimeout(() => {
          setIsVisible(false);
        }, 300);
      }, 1500);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [status]);

  if (!status || !isVisible) {
    return null;
  }

  const config = phaseConfig[status.phase];
  const isComplete = status.phase === 'ready';
  const isError = status.phase === 'error';

  return (
    <div 
      className={`fixed bottom-4 right-4 z-40 transition-all duration-300 ${
        fadeOut ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
      }`}
    >
      <div className="bg-surface/95 backdrop-blur-sm border border-border rounded-2xl shadow-xl max-w-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className={`text-xl ${isComplete ? '' : 'animate-pulse'}`}>
            {config.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`font-medium text-sm ${
              isComplete ? 'text-green-500' : 
              isError ? 'text-red-500' : 
              'text-accent'
            }`}>
              {status.message}
            </p>
            {status.detail && (
              <p className="text-xs text-text-muted mt-0.5 truncate">
                {status.detail}
              </p>
            )}
          </div>
          {!isComplete && !isError && (
            <div className="flex-shrink-0">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>

        {/* File info bar */}
        {status.fileCount !== undefined && status.totalSize !== undefined && (
          <div className="px-4 py-2 bg-surface-muted border-t border-border flex items-center justify-between text-xs text-text-muted">
            <span>{status.fileCount} files</span>
            <span>{formatSize(status.totalSize)}</span>
          </div>
        )}

        {/* Explanation for slow sync */}
        {status.phase === 'syncing_files' && (
          <div className="px-4 py-2.5 bg-accent-muted/50 border-t border-border">
            <p className="text-xs text-text-secondary leading-relaxed">
              Syncing project files to isolated sandbox for secure code execution.
              <span className="text-accent font-medium"> First sync is slower</span>, incremental syncs will be faster.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
