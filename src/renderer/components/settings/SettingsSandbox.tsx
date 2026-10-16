import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, AlertCircle, CheckCircle, Settings, Loader2 } from 'lucide-react';
import { renderLocalizedBannerMessage } from './shared';
import type { LocalizedBanner } from './shared';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

interface SandboxStatus {
  platform: string;
  mode: string;
  initialized: boolean;
  wsl?: {
    available: boolean;
    distro?: string;
    nodeAvailable?: boolean;
    version?: string;
    pythonAvailable?: boolean;
    pythonVersion?: string;
    pipAvailable?: boolean;
    claudeCodeAvailable?: boolean;
  };
  lima?: {
    available: boolean;
    instanceExists?: boolean;
    instanceRunning?: boolean;
    instanceName?: string;
    nodeAvailable?: boolean;
    version?: string;
    pythonAvailable?: boolean;
    pythonVersion?: string;
    pipAvailable?: boolean;
    claudeCodeAvailable?: boolean;
  };
  error?: string;
}

export function SettingsSandbox() {
  const { t } = useTranslation();
  const [sandboxEnabled, setSandboxEnabled] = useState(true);
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState<string | null>(null);
  const [error, setError] = useState<LocalizedBanner | null>(null);
  const [success, setSuccess] = useState<LocalizedBanner | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isTogglingSandbox, setIsTogglingSandbox] = useState(false);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const reloadTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
      if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    };
  }, []);

  const platform = window.electronAPI?.platform || 'unknown';
  const isWindows = platform === 'win32';
  const isMac = platform === 'darwin';

  // Single initialization effect - load config and status together
  useEffect(() => {
    if (!isElectron) {
      setIsLoading(false);
      setIsInitialized(true);
      return;
    }

    let cancelled = false;

    async function initialize() {
      try {
        // Load both config and status in parallel
        const [cfg, s] = await Promise.all([
          window.electronAPI.config.get(),
          window.electronAPI.sandbox.getStatus(),
        ]);

        if (cancelled) return;

        setSandboxEnabled(cfg.sandboxEnabled !== false);
        setStatus(s);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to initialize sandbox tab:', err);
        setError({ text: t('sandbox.failedToLoad') });
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsInitialized(true);
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, [t]);

  async function loadStatus() {
    try {
      const s = await window.electronAPI.sandbox.getStatus();
      setStatus(s);
      setError(null);
    } catch (err) {
      console.error('Failed to load sandbox status:', err);
      setError({ text: t('sandbox.failedToLoad') });
    }
  }

  async function handleToggleSandbox() {
    if (!isElectron) return;
    if (isTogglingSandbox) return;
    setIsTogglingSandbox(true);
    setError(null);
    setSuccess(null);

    const nextEnabled = !sandboxEnabled;
    try {
      const result = await window.electronAPI.config.save({ sandboxEnabled: nextEnabled });
      if (result.success) {
        setSandboxEnabled(result.config.sandboxEnabled !== false);
        setSuccess({
          text: nextEnabled ? t('sandbox.enabledWillSetup') : t('sandbox.disabled'),
        });
        // Backend reloads the sandbox bridge on change; refresh status once that settles.
        if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = setTimeout(async () => {
          await loadStatus();
        }, 500);
        if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = setTimeout(() => setSuccess(null), 3000);
      } else {
        setError({ text: t('sandbox.failedToSave') });
      }
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('sandbox.failedToSave') });
    } finally {
      setIsTogglingSandbox(false);
    }
  }

  async function handleCheckStatus() {
    if (isChecking) return; // Prevent double-click

    setIsChecking(true);
    setError(null);
    setSuccess(null);

    try {
      // Fresh check based on platform - this forces a re-check on the backend
      if (isWindows) {
        await window.electronAPI.sandbox.checkWSL();
      } else if (isMac) {
        await window.electronAPI.sandbox.checkLima();
      }

      // Get full status after check
      const fullStatus = await window.electronAPI.sandbox.getStatus();
      setStatus(fullStatus);

      setSuccess({ text: t('sandbox.statusRefreshed') });
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('sandbox.checkFailed') });
    } finally {
      setIsChecking(false);
    }
  }

  async function handleInstallNode() {
    if (!status || isInstalling) return;
    setIsInstalling('node');
    setError(null);
    setSuccess(null);

    try {
      let result = false;
      if (isWindows && status.wsl?.distro) {
        result = await window.electronAPI.sandbox.installNodeInWSL(status.wsl.distro);
      } else if (isMac) {
        result = await window.electronAPI.sandbox.installNodeInLima();
      }

      if (result) {
        setSuccess({ text: t('sandbox.nodeInstalled') });
        // Refresh status after a short delay to allow backend to update
        setTimeout(async () => {
          await loadStatus();
        }, 500);
      } else {
        setError({ text: t('sandbox.nodeInstallFailed') });
      }
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('sandbox.nodeInstallFailed') });
    } finally {
      setIsInstalling(null);
    }
  }

  async function handleInstallPython() {
    if (!status || isInstalling) return;
    setIsInstalling('python');
    setError(null);
    setSuccess(null);

    try {
      let result = false;
      if (isWindows && status.wsl?.distro) {
        result = await window.electronAPI.sandbox.installPythonInWSL(status.wsl.distro);
      } else if (isMac) {
        result = await window.electronAPI.sandbox.installPythonInLima();
      }

      if (result) {
        setSuccess({ text: t('sandbox.pythonInstalled') });
        setTimeout(async () => {
          await loadStatus();
        }, 500);
      } else {
        setError({ text: t('sandbox.pythonInstallFailed') });
      }
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('sandbox.pythonInstallFailed') });
    } finally {
      setIsInstalling(null);
    }
  }

  async function handleRetrySetup() {
    if (isInstalling) return;
    setIsInstalling('setup');
    setError(null);
    setSuccess(null);

    try {
      const result = await window.electronAPI.sandbox.retrySetup();
      if (result.success) {
        setSuccess({ text: t('sandbox.setupComplete') });
        setTimeout(async () => {
          await loadStatus();
        }, 500);
      } else {
        setError({ text: result.error || t('sandbox.setupFailed') });
      }
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('sandbox.setupFailed') });
    } finally {
      setIsInstalling(null);
    }
  }

  async function handleStartLima() {
    if (isInstalling) return;
    setIsInstalling('start');
    setError(null);
    setSuccess(null);

    try {
      const result = await window.electronAPI.sandbox.startLimaInstance();
      if (result) {
        setSuccess({ text: t('sandbox.limaStarted') });
        setTimeout(async () => {
          await loadStatus();
        }, 500);
      } else {
        setError({ text: t('sandbox.limaStartFailed') });
      }
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('sandbox.limaStartFailed') });
    } finally {
      setIsInstalling(null);
    }
  }

  async function handleStopLima() {
    if (isInstalling) return;
    setIsInstalling('stop');
    setError(null);
    setSuccess(null);

    try {
      const result = await window.electronAPI.sandbox.stopLimaInstance();
      if (result) {
        setSuccess({ text: t('sandbox.limaStopped') });
        setTimeout(async () => {
          await loadStatus();
        }, 500);
      } else {
        setError({ text: t('sandbox.limaStopFailed') });
      }
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('sandbox.limaStopFailed') });
    } finally {
      setIsInstalling(null);
    }
  }

  // Show loading only on initial load
  if (isLoading && !isInitialized) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
        <span className="ml-2 text-text-secondary">{t('common.loading')}</span>
      </div>
    );
  }

  const sandboxAvailable = isWindows
    ? status?.wsl?.available
    : isMac
      ? status?.lima?.available
      : status?.initialized === true; // Linux: available once backend adapter reports initialized
  const sandboxReady = isWindows
    ? status?.wsl?.available && status?.wsl?.nodeAvailable
    : isMac
      ? status?.lima?.available && status?.lima?.instanceRunning && status?.lima?.nodeAvailable
      : status?.initialized === true; // Linux: ready once backend adapter reports initialized
  const sandboxStatusText = !sandboxEnabled
    ? t('sandbox.disabledStatus')
    : sandboxReady
      ? t('sandbox.readyStatus')
      : t('sandbox.notReadyStatus');

  return (
    <div className="space-y-4">
      {/* Error/Success Messages */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {renderLocalizedBannerMessage(error, t)}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-success/10 text-success text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {renderLocalizedBannerMessage(success, t)}
        </div>
      )}

      {/* Sandbox overview */}
      <div className="p-6 rounded-lg bg-surface border border-border text-center space-y-4">
        <div className="w-16 h-16 rounded-lg flex items-center justify-center mx-auto bg-surface-muted text-text-muted">
          <Shield className="w-8 h-8" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-text-primary">
            {t('sandbox.enableSandbox')}
          </h3>
          <p className="text-sm text-text-muted mt-1">
            {isWindows
              ? t('sandbox.wslDesc')
              : isMac
                ? t('sandbox.limaDesc')
                : t('sandbox.nativeDesc')}
          </p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={handleToggleSandbox}
            disabled={isTogglingSandbox}
            role="switch"
            aria-checked={sandboxEnabled}
            aria-label={t('sandbox.enableSandbox')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-50 flex-shrink-0 ${
              sandboxEnabled ? 'bg-accent' : 'bg-surface-muted'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-text-primary transition-transform ${
                sandboxEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          {isTogglingSandbox && <Loader2 className="w-4 h-4 animate-spin text-text-muted" />}
        </div>
        <div
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            sandboxReady
              ? 'bg-success/10 text-success'
              : sandboxEnabled
                ? 'bg-warning/10 text-warning'
                : 'bg-surface-muted text-text-muted'
          }`}
        >
          {sandboxReady ? (
            <CheckCircle className="w-3.5 h-3.5" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5" />
          )}
          <span>{sandboxStatusText}</span>
        </div>
        <p className="text-xs text-text-muted max-w-sm mx-auto">
          {t('sandbox.helpText1')} {t('sandbox.helpText2')}
        </p>
      </div>

      {/* Status Details */}
      {sandboxEnabled && (
        <div className="p-4 rounded-lg bg-surface border border-border space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-text-primary">
              {t('sandbox.environmentStatus')}
            </h3>
            <button
              onClick={handleCheckStatus}
              disabled={isChecking || isInstalling !== null}
              className="px-3 py-1.5 rounded-lg bg-surface-hover text-text-secondary text-xs hover:bg-surface-active transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {isChecking ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Settings className="w-3.5 h-3.5" />
              )}
              {t('sandbox.checkStatus')}
            </button>
          </div>

          {/* Platform Info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-surface-muted">
              <div className="text-xs text-text-muted mb-1">{t('sandbox.platform')}</div>
              <div className="text-sm font-medium text-text-primary">
                {isWindows ? 'Windows' : isMac ? 'macOS' : 'Linux'}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-surface-muted">
              <div className="text-xs text-text-muted mb-1">{t('sandbox.mode')}</div>
              <div className="text-sm font-medium text-text-primary">
                {status?.mode === 'wsl'
                  ? 'WSL2'
                  : status?.mode === 'lima'
                    ? 'Lima VM'
                    : t('sandbox.native')}
              </div>
            </div>
          </div>

          {/* WSL Status (Windows) */}
          {isWindows && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                WSL2 {t('sandbox.status')}
              </div>
              <div className="space-y-2">
                <StatusItem
                  label={t('sandbox.wslAvailable')}
                  available={status?.wsl?.available || false}
                  detail={status?.wsl?.distro}
                />
                <StatusItem
                  label="Node.js"
                  available={status?.wsl?.nodeAvailable || false}
                  detail={status?.wsl?.version}
                  action={
                    !status?.wsl?.nodeAvailable && status?.wsl?.available
                      ? {
                          label: t('common.install'),
                          onClick: handleInstallNode,
                          loading: isInstalling === 'node',
                        }
                      : undefined
                  }
                />
                <StatusItem
                  label="Python"
                  available={status?.wsl?.pythonAvailable || false}
                  detail={status?.wsl?.pythonVersion}
                  optional
                  action={
                    !status?.wsl?.pythonAvailable && status?.wsl?.available
                      ? {
                          label: t('common.install'),
                          onClick: handleInstallPython,
                          loading: isInstalling === 'python',
                        }
                      : undefined
                  }
                />
                <StatusItem label="pip" available={status?.wsl?.pipAvailable || false} optional />
              </div>

              {!status?.wsl?.available && (
                <div className="mt-3 p-3 rounded-lg bg-warning/10 text-warning text-xs">
                  <p className="font-medium mb-1">{t('sandbox.wslNotInstalled')}</p>
                  <p className="opacity-80">{t('sandbox.wslInstallHint')}</p>
                  <code className="block mt-2 p-2 rounded bg-background font-mono text-xs">
                    wsl --install
                  </code>
                </div>
              )}
            </div>
          )}

          {/* Lima Status (macOS) */}
          {isMac && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                Lima VM {t('sandbox.status')}
              </div>
              <div className="space-y-2">
                <StatusItem
                  label={t('sandbox.limaAvailable')}
                  available={status?.lima?.available || false}
                />
                <StatusItem
                  label={t('sandbox.vmCreated')}
                  available={status?.lima?.instanceExists || false}
                  detail={status?.lima?.instanceName}
                />
                <StatusItem
                  label={t('sandbox.vmRunning')}
                  available={status?.lima?.instanceRunning || false}
                  action={
                    status?.lima?.instanceExists && !status?.lima?.instanceRunning
                      ? {
                          label: t('sandbox.start'),
                          onClick: handleStartLima,
                          loading: isInstalling === 'start',
                        }
                      : status?.lima?.instanceRunning
                        ? {
                            label: t('sandbox.stop'),
                            onClick: handleStopLima,
                            loading: isInstalling === 'stop',
                            variant: 'secondary',
                          }
                        : undefined
                  }
                />
                <StatusItem
                  label="Node.js"
                  available={status?.lima?.nodeAvailable || false}
                  detail={status?.lima?.version}
                  action={
                    !status?.lima?.nodeAvailable && status?.lima?.instanceRunning
                      ? {
                          label: t('common.install'),
                          onClick: handleInstallNode,
                          loading: isInstalling === 'node',
                        }
                      : undefined
                  }
                />
                <StatusItem
                  label="Python"
                  available={status?.lima?.pythonAvailable || false}
                  detail={status?.lima?.pythonVersion}
                  optional
                  action={
                    !status?.lima?.pythonAvailable && status?.lima?.instanceRunning
                      ? {
                          label: t('common.install'),
                          onClick: handleInstallPython,
                          loading: isInstalling === 'python',
                        }
                      : undefined
                  }
                />
              </div>

              {!status?.lima?.available && (
                <div className="mt-3 p-3 rounded-lg bg-warning/10 text-warning text-xs">
                  <p className="font-medium mb-1">{t('sandbox.limaNotInstalled')}</p>
                  <p className="opacity-80">{t('sandbox.limaInstallHint')}</p>
                  <code className="block mt-2 p-2 rounded bg-background font-mono text-xs">
                    brew install lima
                  </code>
                </div>
              )}
            </div>
          )}

          {/* Linux - Native Mode */}
          {!isWindows && !isMac && (
            <div className="p-3 rounded-lg bg-surface-muted text-text-secondary text-sm">
              {t('sandbox.linuxNative')}
            </div>
          )}
        </div>
      )}

      {/* Retry Setup Button */}
      {sandboxEnabled && sandboxAvailable && !sandboxReady && (
        <button
          onClick={handleRetrySetup}
          disabled={isInstalling !== null}
          className="w-full py-3 px-4 rounded-lg bg-accent text-white font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
        >
          {isInstalling === 'setup' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('sandbox.settingUp')}
            </>
          ) : (
            <>
              <Settings className="w-4 h-4" />
              {t('sandbox.retrySetup')}
            </>
          )}
        </button>
      )}
    </div>
  );
}

function StatusItem({
  label,
  available,
  detail,
  optional,
  action,
}: {
  label: string;
  available: boolean;
  detail?: string;
  optional?: boolean;
  action?: {
    label: string;
    onClick: () => void;
    loading?: boolean;
    variant?: 'primary' | 'secondary';
  };
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background">
      <div className="flex items-center gap-2">
        <div
          className={`w-5 h-5 rounded-full flex items-center justify-center ${
            available
              ? 'bg-success/10 text-success'
              : optional
                ? 'bg-surface-muted text-text-muted'
                : 'bg-error/10 text-error'
          }`}
        >
          {available ? (
            <CheckCircle className="w-3.5 h-3.5" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5" />
          )}
        </div>
        <span className="text-sm text-text-primary">{label}</span>
        {detail && <span className="text-xs text-text-muted">({detail})</span>}
        {optional && !available && (
          <span className="text-xs text-text-muted">({t('common.optional')})</span>
        )}
      </div>
      {action && (
        <button
          onClick={action.onClick}
          disabled={action.loading}
          className={`px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1 ${
            action.variant === 'secondary'
              ? 'bg-surface-muted text-text-secondary hover:bg-surface-active'
              : 'bg-accent text-white hover:bg-accent-hover'
          }`}
        >
          {action.loading && <Loader2 className="w-3 h-3 animate-spin" />}
          {action.label}
        </button>
      )}
    </div>
  );
}
