import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import {
  Monitor,
  Play,
  Square,
  Trash2,
  ExternalLink,
  Download,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { CareerBoxConfig } from '../types';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

export function CareerBoxView() {
  const { t } = useTranslation();
  const {
    careerboxStatus,
    careerboxDockerAvailable,
    careerboxPullProgress,
    careerboxHealthy,
    setCareerboxStatus,
    setCareerboxDockerAvailable,
    setCareerboxPullProgress,
    setCareerboxHealthy,
  } = useAppStore();

  const [loading, setLoading] = useState(false);
  const [actionLabel, setActionLabel] = useState('');
  const [config, setConfig] = useState<CareerBoxConfig | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [configDraft, setConfigDraft] = useState<Partial<CareerBoxConfig>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const healthInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Init: check Docker, load status & config ──
  const refresh = useCallback(async () => {
    if (!isElectron) return;
    try {
      const docker = await window.electronAPI.careerbox.checkDocker();
      setCareerboxDockerAvailable(docker.available);

      if (docker.available) {
        const status = await window.electronAPI.careerbox.getStatus();
        setCareerboxStatus(status);
      }

      const cfg = await window.electronAPI.careerbox.getConfig();
      setConfig(cfg);
    } catch (err) {
      console.error('[CareerBox] refresh error:', err);
    }
  }, [setCareerboxDockerAvailable, setCareerboxStatus]);

  useEffect(() => {
    refresh();
    return () => {
      if (healthInterval.current) clearInterval(healthInterval.current);
      if (statusInterval.current) clearInterval(statusInterval.current);
    };
  }, [refresh]);

  // ── Health polling when running ──
  useEffect(() => {
    if (healthInterval.current) {
      clearInterval(healthInterval.current);
      healthInterval.current = null;
    }

    if (careerboxStatus?.status === 'running' && isElectron) {
      const poll = async () => {
        try {
          const res = await window.electronAPI.careerbox.checkHealth();
          setCareerboxHealthy(res.healthy);
        } catch {
          setCareerboxHealthy(false);
        }
      };
      poll();
      healthInterval.current = setInterval(poll, 5000);
    } else {
      setCareerboxHealthy(false);
    }

    return () => {
      if (healthInterval.current) clearInterval(healthInterval.current);
    };
  }, [careerboxStatus?.status, setCareerboxHealthy]);

  // ── Actions ──
  const runAction = useCallback(
    async (label: string, fn: () => Promise<any>) => {
      setLoading(true);
      setActionLabel(label);
      setError(null);
      try {
        const result = await fn();
        if (result && result.success === false && result.error) {
          setError(result.error);
        }
      } catch (err: any) {
        setError(err.message || 'Action failed');
      } finally {
        await refresh();
        setLoading(false);
        setActionLabel('');
      }
    },
    [refresh],
  );

  const handlePull = () =>
    runAction(t('careerbox.pulling'), async () => {
      await window.electronAPI.careerbox.pullImage();
      setCareerboxPullProgress(null);
    });

  const handleCreate = () =>
    runAction(t('careerbox.creating'), () => window.electronAPI.careerbox.createContainer());

  const handleStart = () =>
    runAction(t('careerbox.starting'), () => window.electronAPI.careerbox.startContainer());

  const handleStop = () =>
    runAction(t('careerbox.stopping'), () => window.electronAPI.careerbox.stopContainer());

  const handleRemove = () => {
    if (!window.confirm(t('careerbox.removeConfirm'))) return;
    runAction(t('careerbox.remove'), () => window.electronAPI.careerbox.removeContainer());
  };

  const handleOpen = async () => {
    await window.electronAPI.careerbox.openWorkspace();
  };

  const handleSaveConfig = async () => {
    if (!isElectron) return;
    await window.electronAPI.careerbox.saveConfig(configDraft);
    const cfg = await window.electronAPI.careerbox.getConfig();
    setConfig(cfg);
    setConfigDraft({});
  };

  // ── Derive UI state ──
  const status = careerboxStatus?.status ?? 'not_found';
  const isRunning = status === 'running';
  const isStopped = status === 'exited' || status === 'created' || status === 'paused';
  const isNotCreated = status === 'not_found';

  // Status badge
  const statusBadge = () => {
    if (!careerboxDockerAvailable)
      return <span className="badge badge-error">{t('careerbox.dockerNotDetected')}</span>;
    if (isRunning)
      return <span className="badge badge-running">{t('careerbox.running')}</span>;
    if (isStopped)
      return <span className="badge badge-idle">{t('careerbox.stopped')}</span>;
    return <span className="badge badge-idle">{t('careerbox.notCreated')}</span>;
  };

  // Uptime helper
  const uptime = () => {
    if (!careerboxStatus?.startedAt || !isRunning) return null;
    const start = new Date(careerboxStatus.startedAt).getTime();
    const diff = Date.now() - start;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m`;
    return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
  };

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
              <Monitor className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-text-primary">{t('careerbox.title')}</h1>
              <p className="text-sm text-text-secondary">
                Career development workspace
              </p>
            </div>
          </div>
          {statusBadge()}
        </div>

        {/* ── Error banner ── */}
        {error && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-error/10 border border-error/20">
            <AlertCircle className="w-5 h-5 text-error flex-shrink-0 mt-0.5" />
            <div className="text-sm text-error flex-1">{error}</div>
          </div>
        )}

        {/* ── Docker not available ── */}
        {!careerboxDockerAvailable && (
          <div className="card p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-text-primary">{t('careerbox.dockerNotDetected')}</p>
                <p className="text-sm text-text-secondary mt-1">
                  {t('careerbox.dockerNotDetectedDesc')}
                </p>
              </div>
            </div>
            <button
              onClick={() =>
                window.electronAPI?.openExternal('https://www.docker.com/products/docker-desktop/')
              }
              className="btn btn-secondary"
            >
              <ExternalLink className="w-4 h-4" />
              {t('careerbox.installDocker')}
            </button>
          </div>
        )}

        {/* ── Status Card ── */}
        {careerboxDockerAvailable && (
          <div className="card p-6 space-y-4">
            <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
              {t('careerbox.status')}
            </h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-text-muted">{t('careerbox.container')}</span>
                <p className="text-text-primary font-medium capitalize">{status.replace('_', ' ')}</p>
              </div>
              <div>
                <span className="text-text-muted">{t('careerbox.image')}</span>
                <p className="text-text-primary font-medium truncate">
                  {careerboxStatus?.image || config?.imageName || '—'}
                </p>
              </div>
              {isRunning && (
                <>
                  <div>
                    <span className="text-text-muted">{t('careerbox.uptime')}</span>
                    <p className="text-text-primary font-medium">{uptime() || '—'}</p>
                  </div>
                  <div>
                    <span className="text-text-muted">{t('careerbox.health')}</span>
                    <p className="flex items-center gap-1.5 font-medium">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          careerboxHealthy ? 'bg-success' : 'bg-warning animate-pulse'
                        }`}
                      />
                      {careerboxHealthy ? t('careerbox.healthy') : t('careerbox.unhealthy')}
                    </p>
                  </div>
                </>
              )}
              {careerboxStatus?.id && (
                <div className="col-span-2">
                  <span className="text-text-muted">ID</span>
                  <p className="text-text-primary font-mono text-xs">{careerboxStatus.id}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Pull Progress ── */}
        {careerboxPullProgress && (
          <div className="card p-6 space-y-3">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{careerboxPullProgress.status}</span>
            </div>
            {careerboxPullProgress.percent >= 0 && (
              <div className="w-full h-2 bg-surface-hover rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(careerboxPullProgress.percent, 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* ── Action Buttons ── */}
        {careerboxDockerAvailable && (
          <div className="flex flex-wrap gap-3">
            {/* Pull / Re-pull */}
            <button
              onClick={handlePull}
              disabled={loading}
              className="btn btn-secondary"
            >
              {loading && actionLabel === t('careerbox.pulling') ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {t('careerbox.pullImage')}
            </button>

            {/* Create */}
            {isNotCreated && (
              <button
                onClick={handleCreate}
                disabled={loading}
                className="btn btn-primary"
              >
                {loading && actionLabel === t('careerbox.creating') ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Monitor className="w-4 h-4" />
                )}
                {t('careerbox.createContainer')}
              </button>
            )}

            {/* Start */}
            {isStopped && (
              <button
                onClick={handleStart}
                disabled={loading}
                className="btn btn-primary"
              >
                {loading && actionLabel === t('careerbox.starting') ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {t('careerbox.start')}
              </button>
            )}

            {/* Open Workspace */}
            {isRunning && (
              <button onClick={handleOpen} className="btn btn-primary">
                <ExternalLink className="w-4 h-4" />
                {t('careerbox.openWorkspace')}
              </button>
            )}

            {/* Stop */}
            {isRunning && (
              <button
                onClick={handleStop}
                disabled={loading}
                className="btn btn-secondary"
              >
                {loading && actionLabel === t('careerbox.stopping') ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                {t('careerbox.stop')}
              </button>
            )}

            {/* Remove */}
            {(isStopped || isRunning) && (
              <button
                onClick={handleRemove}
                disabled={loading}
                className="btn btn-ghost text-error hover:text-error"
              >
                <Trash2 className="w-4 h-4" />
                {t('careerbox.remove')}
              </button>
            )}
          </div>
        )}

        {/* ── Quick Info Panel ── */}
        {careerboxDockerAvailable && config && (
          <div className="card p-6 space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-text-muted">{t('careerbox.port')}</span>
                <p className="text-text-primary font-mono">{config.port}</p>
              </div>
              <div>
                <span className="text-text-muted">{t('careerbox.memory')}</span>
                <p className="text-text-primary">{config.memoryMb} MB</p>
              </div>
              <div>
                <span className="text-text-muted">{t('careerbox.volume')}</span>
                <p className="text-text-primary font-mono">{config.volumeName}</p>
              </div>
              <div>
                <span className="text-text-muted">{t('careerbox.password')}</span>
                <p className="text-text-primary font-mono">{'*'.repeat(config.password.length)}</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Config Section (collapsible) ── */}
        {careerboxDockerAvailable && config && (
          <div className="card overflow-hidden">
            <button
              onClick={() => setConfigOpen(!configOpen)}
              className="w-full flex items-center justify-between p-4 hover:bg-surface-hover transition-colors"
            >
              <span className="text-sm font-medium text-text-primary">{t('careerbox.config')}</span>
              {configOpen ? (
                <ChevronUp className="w-4 h-4 text-text-muted" />
              ) : (
                <ChevronDown className="w-4 h-4 text-text-muted" />
              )}
            </button>

            {configOpen && (
              <div className="px-4 pb-4 space-y-4 border-t border-border">
                {/* Memory slider */}
                <div className="pt-4">
                  <label className="text-sm text-text-muted block mb-1">
                    {t('careerbox.memory')}: {configDraft.memoryMb ?? config.memoryMb} MB
                  </label>
                  <input
                    type="range"
                    min={1024}
                    max={8192}
                    step={256}
                    value={configDraft.memoryMb ?? config.memoryMb}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, memoryMb: Number(e.target.value) })
                    }
                    className="w-full accent-accent"
                  />
                  <div className="flex justify-between text-xs text-text-muted">
                    <span>1 GB</span>
                    <span>8 GB</span>
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label className="text-sm text-text-muted block mb-1">{t('careerbox.password')}</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="input pr-10"
                      value={configDraft.password ?? config.password}
                      onChange={(e) =>
                        setConfigDraft({ ...configDraft, password: e.target.value })
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Port */}
                <div>
                  <label className="text-sm text-text-muted block mb-1">{t('careerbox.port')}</label>
                  <input
                    type="number"
                    className="input"
                    value={configDraft.port ?? config.port}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, port: Number(e.target.value) })
                    }
                  />
                </div>

                {/* Save */}
                <button onClick={handleSaveConfig} className="btn btn-primary w-full">
                  <CheckCircle2 className="w-4 h-4" />
                  {t('careerbox.saveConfig')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
