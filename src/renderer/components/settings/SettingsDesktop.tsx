import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  CircleSlash,
  Loader2,
  Monitor,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';

import { SettingsContentSection } from './shared';
import type { DesktopAccessMode } from '../../types';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

interface DesktopStatus {
  mode: DesktopAccessMode;
  platform: string;
  binaryFound: boolean;
  binaryPath?: string;
  version?: string;
  permissions?: {
    accessibility?: { state: string };
    automation?: { state: string };
    screen_recording?: { state: string };
  };
  error?: string;
}

const MODE_OPTIONS: { value: DesktopAccessMode; icon: typeof Monitor }[] = [
  { value: 'off', icon: CircleSlash },
  { value: 'mcp', icon: Monitor },
  { value: 'mcp+skill', icon: Monitor },
];

/**
 * Estado de uma permissão, mapeado para a classe visual.
 *
 * `granted` → ok; `denied` → erro; `not_required` → neutro;
 * qualquer outro valor (inclusive ausente) → **desconhecido**, nunca "ok".
 */
function permissionTone(state?: string): 'ok' | 'error' | 'neutral' | 'unknown' {
  if (!state) return 'unknown';
  if (state === 'granted') return 'ok';
  if (state === 'denied') return 'error';
  if (state === 'not_required') return 'neutral';
  return 'unknown';
}

const TONE_CLASS: Record<string, string> = {
  ok: 'text-success',
  error: 'text-danger',
  neutral: 'text-text-muted',
  unknown: 'text-text-muted',
};

export function SettingsDesktop() {
  const { t } = useTranslation();

  const [mode, setMode] = useState<DesktopAccessMode>('off');
  const [physicalInput, setPhysicalInput] = useState(false);
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!isElectron) return null;
    setIsChecking(true);
    try {
      const next = await window.electronAPI.desktop.getStatus();
      setStatus(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!isElectron) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function initialize() {
      try {
        const cfg = await window.electronAPI.config.get();
        if (cancelled) return;
        setMode((cfg.desktopAccessMode ?? 'off') as DesktopAccessMode);
        setPhysicalInput(cfg.desktopPhysicalInputEnabled ?? false);
        await refreshStatus();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [refreshStatus]);

  async function persist(next: Partial<{ desktopAccessMode: DesktopAccessMode; desktopPhysicalInputEnabled: boolean }>) {
    if (!isElectron) return;
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await window.electronAPI.config.save(next);
      setSuccess(t('desktop.saved'));
      // O status depende do binário e das permissões, não do modo — mas a
      // permissão física exibida pode mudar, então relemos.
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function changeMode(next: DesktopAccessMode) {
    if (next === mode) return;
    setMode(next);
    await persist({ desktopAccessMode: next });
  }

  async function togglePhysicalInput(next: boolean) {
    setPhysicalInput(next);
    await persist({ desktopPhysicalInputEnabled: next });
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-text-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  const permissionRows: { key: string; labelKey: string; state?: string }[] = [
    { key: 'accessibility', labelKey: 'desktop.permissionAccessibility', state: status?.permissions?.accessibility?.state },
    { key: 'automation', labelKey: 'desktop.permissionAutomation', state: status?.permissions?.automation?.state },
    { key: 'screen_recording', labelKey: 'desktop.permissionScreenRecording', state: status?.permissions?.screen_recording?.state },
  ];

  return (
    <div className="space-y-1">
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/30 text-sm text-danger">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-success/10 border border-success/30 text-sm text-success">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <SettingsContentSection
        title={t('desktop.modeTitle')}
        description={t('desktop.modeDescription')}
      >
        <div className="space-y-2">
          {MODE_OPTIONS.map((option) => {
            const Icon = option.icon;
            const selected = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => void changeMode(option.value)}
                disabled={isSaving}
                className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all disabled:opacity-60 ${
                  selected
                    ? 'border-accent bg-accent/10'
                    : 'border-border-muted hover:border-accent/50'
                }`}
              >
                <Icon className="w-4 h-4 mt-0.5 shrink-0 text-text-secondary" />
                <span className="space-y-1">
                  <span className="block text-sm font-medium text-text-primary">
                    {t(`desktop.mode_${option.value.replace('+', '_')}`)}
                  </span>
                  <span className="block text-xs leading-5 text-text-muted">
                    {t(`desktop.mode_${option.value.replace('+', '_')}Desc`)}
                  </span>
                </span>
              </button>
            );
          })}

          {/* `native` existe no contrato mas depende da camada FFI (Fase 5). */}
          <div className="w-full flex items-start gap-3 p-3 rounded-lg border border-border-muted opacity-60">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-text-secondary" />
            <span className="space-y-1">
              <span className="block text-sm font-medium text-text-primary">
                {t('desktop.mode_native')}
              </span>
              <span className="block text-xs leading-5 text-text-muted">
                {t('desktop.mode_nativeDesc')}
              </span>
            </span>
          </div>
        </div>
      </SettingsContentSection>

      <SettingsContentSection
        title={t('desktop.physicalTitle')}
        description={t('desktop.physicalDescription')}
      >
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={physicalInput}
            disabled={isSaving || mode === 'off'}
            onChange={(e) => void togglePhysicalInput(e.target.checked)}
            className="mt-1 w-4 h-4 accent-[var(--accent)] disabled:opacity-50"
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium text-text-primary">
              {t('desktop.physicalLabel')}
            </span>
            <span className="block text-xs leading-5 text-text-muted">
              {t('desktop.physicalHint')}
            </span>
          </span>
        </label>
      </SettingsContentSection>

      <SettingsContentSection
        title={t('desktop.statusTitle')}
        description={t('desktop.statusDescription')}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm text-text-primary">
                {status?.binaryFound ? t('desktop.binaryFound') : t('desktop.binaryMissing')}
              </p>
              {status?.version && (
                <p className="text-xs text-text-muted">
                  {t('desktop.version')} {status.version}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void refreshStatus()}
              disabled={isChecking}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border-muted text-xs text-text-secondary hover:border-accent/50 hover:text-text-primary transition-all disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
              {t('desktop.checkNow')}
            </button>
          </div>

          {status?.error && (
            <p className="text-xs text-danger">{status.error}</p>
          )}

          <div className="space-y-2">
            {permissionRows.map((row) => {
              const tone = permissionTone(row.state);
              return (
                <div key={row.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-text-secondary">{t(row.labelKey)}</span>
                  <span className={`font-medium ${TONE_CLASS[tone]}`}>
                    {row.state ?? t('desktop.permissionUnknown')}
                  </span>
                </div>
              );
            })}
          </div>

          {!status?.binaryFound && (
            <p className="text-xs leading-5 text-text-muted">{t('desktop.binaryMissingHint')}</p>
          )}
        </div>
      </SettingsContentSection>
    </div>
  );
}
