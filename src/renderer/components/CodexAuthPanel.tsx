import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle,
  Loader2,
  LogIn,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CodexAuthStatus } from '../types';

interface CodexAuthPanelProps {
  codexPath: string;
  setCodexPath: (value: string) => void;
}

type CodexAction = 'status' | 'login' | 'device-login' | 'logout' | null;

export function CodexAuthPanel({ codexPath, setCodexPath }: CodexAuthPanelProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CodexAuthStatus | null>(null);
  const [activeAction, setActiveAction] = useState<CodexAction>(null);

  const loadStatus = useCallback(async () => {
    setActiveAction('status');
    try {
      const nextStatus = await window.electronAPI.config.getCodexAuthStatus(
        codexPath.trim() || undefined
      );
      setStatus(nextStatus);
    } finally {
      setActiveAction(null);
    }
  }, [codexPath]);

  const runAction = useCallback(
    async (action: Exclude<CodexAction, 'status' | null>) => {
      setActiveAction(action);
      try {
        const result =
          action === 'login'
            ? await window.electronAPI.config.codexLogin(codexPath.trim() || undefined)
            : action === 'device-login'
              ? await window.electronAPI.config.codexDeviceLogin(codexPath.trim() || undefined)
              : await window.electronAPI.config.codexLogout(codexPath.trim() || undefined);

        setStatus({
          ok: result.ok,
          loggedIn: action === 'logout' ? false : result.ok,
          cliFound: result.cliFound,
          message: result.message,
          stdout: result.stdout,
          stderr: result.stderr,
        });

        await loadStatus();
      } finally {
        setActiveAction(null);
      }
    },
    [codexPath, loadStatus]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [loadStatus]);

  const statusTone = useMemo(() => {
    if (!status) {
      return 'border-border-subtle bg-background/60 text-text-secondary';
    }
    if (status.ok && status.loggedIn) {
      return 'border-success/30 bg-success/10 text-success';
    }
    return 'border-warning/30 bg-warning/10 text-warning';
  }, [status]);

  return (
    <div className="space-y-3 py-5 border-b border-border-muted">
      <label
        htmlFor="codex-path-input"
        className="flex items-center gap-2 text-sm font-medium text-text-primary"
      >
        <Terminal className="w-4 h-4" />
        {t('api.codex.cliPath')}
      </label>
      <p className="text-xs leading-5 text-text-muted">{t('api.codex.description')}</p>
      <input
        id="codex-path-input"
        type="text"
        value={codexPath}
        onChange={(e) => setCodexPath(e.target.value)}
        placeholder={t('api.codex.cliPathPlaceholder')}
        className="w-full px-4 py-3 rounded-lg bg-background border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
      />
      <p className="text-xs text-text-muted">{t('api.codex.cliPathHint')}</p>

      <div className={`rounded-xl border px-3 py-3 text-xs leading-5 ${statusTone}`}>
        <div className="flex items-start gap-2">
          {status?.ok && status.loggedIn ? (
            <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          ) : (
            <MonitorSmartphone className="mt-0.5 h-4 w-4 flex-shrink-0" />
          )}
          <div>
            <div className="font-medium">{t('api.codex.statusLabel')}</div>
            <div>{status?.message || t('api.codex.statusChecking')}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
        <button
          type="button"
          onClick={() => void loadStatus()}
          disabled={activeAction !== null}
          className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-surface-hover disabled:opacity-50"
        >
          {activeAction === 'status' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t('api.codex.refreshStatus')}
        </button>
        <button
          type="button"
          onClick={() => void runAction('login')}
          disabled={activeAction !== null}
          className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-surface-hover disabled:opacity-50"
        >
          {activeAction === 'login' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogIn className="h-4 w-4" />
          )}
          {t('api.codex.login')}
        </button>
        <button
          type="button"
          onClick={() => void runAction('device-login')}
          disabled={activeAction !== null}
          className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-surface-hover disabled:opacity-50"
        >
          {activeAction === 'device-login' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MonitorSmartphone className="h-4 w-4" />
          )}
          {t('api.codex.deviceLogin')}
        </button>
        <button
          type="button"
          onClick={() => void runAction('logout')}
          disabled={activeAction !== null}
          className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-surface-hover disabled:opacity-50"
        >
          {activeAction === 'logout' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4" />
          )}
          {t('api.codex.logout')}
        </button>
      </div>

      <div className="space-y-1 text-xs text-text-muted">
        <p>{t('api.codex.officialOnly')}</p>
        <p>{t('api.codex.manualLoginHint')}</p>
        <p>{t('api.codex.deviceLoginHint')}</p>
        <p>{t('api.codex.logHint')}</p>
        <p>{t('api.codex.logoutHint')}</p>
      </div>
    </div>
  );
}
