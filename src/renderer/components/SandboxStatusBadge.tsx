import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, ShieldAlert } from 'lucide-react';
import { useAppStore } from '../store';
import { cn } from './ui';

type SandboxMode = 'wsl' | 'lima' | 'native' | 'none' | string;

/**
 * Persistent isolation indicator. The sandbox can silently fall back to
 * native (host) execution, so the user must always be able to see whether
 * commands run inside a VM or directly on their machine — a one-time
 * dialog at setup is not enough. Clicking opens the sandbox settings.
 */
export function SandboxStatusBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const showSettings = useAppStore((s) => s.showSettings);
  const [mode, setMode] = useState<SandboxMode | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await window.electronAPI?.sandbox?.getStatus?.();
        if (!cancelled && status) setMode(status.mode ?? 'none');
      } catch {
        /* status stays unknown; render nothing rather than guess */
      }
    };
    void refresh();
    const interval = setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Re-check when settings close — the user may have toggled the sandbox.
  }, [showSettings]);

  if (!mode) return null;

  const isolated = mode === 'wsl' || mode === 'lima';
  return (
    <button
      onClick={() => {
        setSettingsTab('sandbox');
        setShowSettings(true);
      }}
      title={
        isolated
          ? t('sandboxBadge.isolatedTitle', { mode: mode.toUpperCase() })
          : t('sandboxBadge.nativeTitle')
      }
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        isolated
          ? 'bg-success/12 text-success hover:bg-success/20'
          : 'bg-warning/12 text-warning hover:bg-warning/20',
        className
      )}
    >
      {isolated ? <Shield className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
      {isolated ? t('sandboxBadge.isolated') : t('sandboxBadge.native')}
    </button>
  );
}
