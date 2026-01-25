/**
 * SandboxSetupDialog - Shows sandbox initialization progress at app startup
 * Supports light/dark theme
 */

import { useEffect, useState } from 'react';
import type { SandboxSetupProgress, SandboxSetupPhase } from '../types';

interface Props {
  progress: SandboxSetupProgress | null;
  onComplete?: () => void;
}

// Phase display configuration
const phaseConfig: Record<SandboxSetupPhase, { icon: string }> = {
  checking: { icon: '🔍' },
  creating: { icon: '📦' },
  starting: { icon: '🚀' },
  installing_node: { icon: '💚' },
  installing_python: { icon: '🐍' },
  installing_pip: { icon: '📦' },
  installing_deps: { icon: '📚' },
  ready: { icon: '✅' },
  skipped: { icon: '⚡' },
  error: { icon: '❌' },
};

export function SandboxSetupDialog({ progress, onComplete }: Props) {
  const [isVisible, setIsVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const handleClose = () => {
    setFadeOut(true);
    setTimeout(() => {
      setIsVisible(false);
      onComplete?.();
    }, 500);
  };

  const handleRetryLima = async () => {
    if (!window.electronAPI?.sandbox?.retryLimaSetup) {
      return;
    }
    setIsRetrying(true);
    try {
      const result = await window.electronAPI.sandbox.retryLimaSetup();
      if (!result?.success) {
        setIsRetrying(false);
      }
    } catch (error) {
      console.error('[SandboxSetupDialog] Retry Lima failed:', error);
      setIsRetrying(false);
    }
  };

  useEffect(() => {
    if (progress?.phase === 'ready' || progress?.phase === 'skipped') {
      // Delay before fade out for success states
      const timer = setTimeout(() => {
        handleClose();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [progress?.phase, onComplete]);

  useEffect(() => {
    if (progress && progress.phase !== 'error') {
      setIsRetrying(false);
    }
  }, [progress]);

  if (!progress || !isVisible) {
    return null;
  }

  const config = phaseConfig[progress.phase];
  const isComplete = progress.phase === 'ready' || progress.phase === 'skipped';
  const isError = progress.phase === 'error';
  const isMac = window.electronAPI?.platform === 'darwin';

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-500 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className="bg-surface border border-border rounded-3xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-accent-muted px-6 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="text-3xl animate-pulse">{config.icon}</div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">
                Setting Up Sandbox
              </h2>
              <p className="text-sm text-text-secondary">
                First run requires configuring secure execution environment
              </p>
            </div>
          </div>
        </div>

        {/* Progress Content */}
        <div className="px-6 py-5">
          {/* Status Message */}
          <div className="flex items-start gap-3 mb-4">
            <div className={`text-xl ${
              isComplete ? 'text-green-500' :
              isError ? 'text-red-500' :
              'text-accent'
            }`}>
              {config.icon}
            </div>
            <div className="flex-1">
              <p className={`font-medium ${
                isComplete ? 'text-green-500' :
                isError ? 'text-red-500' :
                'text-accent'
              }`}>
                {progress.message}
              </p>
              {progress.detail && (
                <p className="text-sm text-text-muted mt-1">
                  {progress.detail}
                </p>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          {progress.progress !== undefined && !isError && (
            <div className="mt-4">
              <div className="h-2 bg-surface-muted rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-500 ease-out rounded-full ${
                    isComplete 
                      ? 'bg-green-500' 
                      : 'bg-accent'
                  }`}
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-text-muted">
                <span>Progress</span>
                <span>{progress.progress}%</span>
              </div>
            </div>
          )}

          {/* Error Display */}
          {isError && progress.error && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
              <p className="text-sm text-red-500">
                {progress.error}
              </p>
              <p className="text-xs text-text-muted mt-2">
                Continuing with native execution mode
              </p>
            </div>
          )}

          {/* Continue / Retry Buttons for Error State */}
          {isError && (
            <div className="mt-4 flex flex-col gap-3">
              {isMac && (
                <button
                  onClick={handleRetryLima}
                  disabled={isRetrying}
                  className="w-full py-2.5 px-4 bg-accent hover:bg-accent/90 text-white rounded-xl font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isRetrying ? 'Restarting Lima...' : 'Try Restarting Lima'}
                </button>
              )}
              <button
                onClick={handleClose}
                className={`w-full py-2.5 px-4 rounded-xl font-medium transition-colors ${
                  isMac
                    ? 'bg-surface hover:bg-surface-muted text-text-primary border border-border'
                    : 'bg-accent hover:bg-accent/90 text-white'
                }`}
              >
                Continue with Native Mode
              </button>
            </div>
          )}

          {/* Completion Message */}
          {isComplete && (
            <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-xl">
              <p className="text-sm text-green-600 dark:text-green-400">
                {progress.phase === 'ready' 
                  ? 'Sandbox configured. Code can now be executed safely.' 
                  : 'Using native system environment for command execution.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-surface-muted border-t border-border">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>
              {window.electronAPI?.platform === 'win32' ? 'WSL2 Sandbox' : window.electronAPI?.platform === 'darwin' ? 'Lima Sandbox' : 'Native Mode'}
            </span>
            {!isComplete && !isError && (
              <span className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 bg-accent rounded-full animate-pulse" />
                Configuring...
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
