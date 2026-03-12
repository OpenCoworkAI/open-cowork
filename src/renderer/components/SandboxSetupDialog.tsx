/**
 * SandboxSetupDialog - Shows sandbox initialization progress at app startup
 * Supports light/dark theme
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SandboxSetupProgress, SandboxSetupPhase } from '../types';
import { getSandboxSetupDisplayText } from '../utils/sandbox-i18n';

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
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const handleClose = useCallback(() => {
    setFadeOut(true);
    setTimeout(() => {
      setIsVisible(false);
      onComplete?.();
    }, 500);
  }, [onComplete]);

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
  }, [progress?.phase, handleClose]);

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
  const displayText = getSandboxSetupDisplayText(t, progress);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-500 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className="bg-background border border-border-subtle rounded-[2rem] shadow-elevated max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-background-secondary/88 px-6 py-5 border-b border-border-muted">
          <div className="flex items-center gap-3">
            <div className="text-3xl animate-pulse">{config.icon}</div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">{t('sandbox.setupTitle')}</h2>
              <p className="text-sm text-text-secondary">{t('sandbox.setupSubtitle')}</p>
            </div>
          </div>
        </div>

        {/* Progress Content */}
        <div className="px-6 py-5">
          {/* Status Message */}
          <div className="flex items-start gap-3 mb-4">
            <div
              className={`text-xl ${
                isComplete ? 'text-success' : isError ? 'text-error' : 'text-accent'
              }`}
            >
              {config.icon}
            </div>
            <div className="flex-1">
              <p
                className={`font-medium ${
                  isComplete ? 'text-success' : isError ? 'text-error' : 'text-accent'
                }`}
              >
                {displayText.message}
              </p>
              {displayText.detail && (
                <p className="text-sm text-text-muted mt-1">{displayText.detail}</p>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          {progress.progress !== undefined && !isError && (
            <div className="mt-4">
              <div className="h-2 bg-surface-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ease-out rounded-full ${
                    isComplete ? 'bg-success' : 'bg-accent'
                  }`}
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-text-muted">
                <span>{t('sandbox.progressLabel')}</span>
                <span>{progress.progress}%</span>
              </div>
            </div>
          )}

          {/* Error Display */}
          {isError && progress.error && (
            <div className="mt-4 p-3 bg-error/10 border border-error/30 rounded-xl">
              <p className="text-sm text-error">{progress.error}</p>
              <p className="text-xs text-text-muted mt-2">{t('sandbox.continuingNative')}</p>
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
                  {isRetrying ? t('sandbox.retryingLima') : t('sandbox.retryLima')}
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
                {t('sandbox.continueNative')}
              </button>
            </div>
          )}

          {/* Completion Message */}
          {isComplete && (
            <div className="mt-4 p-3 bg-success/10 border border-green-500/30 rounded-xl">
              <p className="text-sm text-success">
                {progress.phase === 'ready'
                  ? t('sandbox.configuredSuccess')
                  : t('sandbox.nativeFallbackSuccess')}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-background-secondary/70 border-t border-border-muted">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>
              {window.electronAPI?.platform === 'win32'
                ? t('sandbox.footerWsl')
                : window.electronAPI?.platform === 'darwin'
                  ? t('sandbox.footerLima')
                  : t('sandbox.footerNative')}
            </span>
            {!isComplete && !isError && (
              <span className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 bg-accent rounded-full animate-pulse" />
                {t('sandbox.configuring')}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
