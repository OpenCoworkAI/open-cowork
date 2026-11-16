import { useState } from 'react';
import { CheckCircle, Loader2, LogIn, LogOut, Send, ShieldCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OpenAICodexAuthStatus } from '../types';

interface OpenAICodexAuthCardProps {
  status: OpenAICodexAuthStatus;
  onLogin: () => Promise<void>;
  onCancel: () => Promise<void>;
  onSubmitCode: (value: string) => Promise<void>;
  onLogout: () => Promise<void>;
}

export function OpenAICodexAuthCard({
  status,
  onLogin,
  onCancel,
  onSubmitCode,
  onLogout,
}: OpenAICodexAuthCardProps) {
  const { t } = useTranslation();
  const [manualCode, setManualCode] = useState('');

  return (
    <div className="space-y-3 rounded-xl border border-border-muted bg-background-secondary/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-accent/10 p-2 text-accent">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
              {t('api.codexAuth.title')}
              {status.authenticated && (
                <span className="inline-flex items-center gap-1 text-xs font-normal text-success">
                  <CheckCircle className="h-3.5 w-3.5" />
                  {t('api.codexAuth.connected')}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              {t('api.codexAuth.description')}
            </p>
          </div>
        </div>
      </div>

      {status.authenticating ? (
        <button
          type="button"
          onClick={() => void onCancel()}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary transition-colors hover:bg-surface-hover"
        >
          <X className="h-4 w-4" />
          {t('api.codexAuth.cancel')}
        </button>
      ) : status.authenticated ? (
        <button
          type="button"
          onClick={() => void onLogout()}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary transition-colors hover:bg-surface-hover"
        >
          <LogOut className="h-4 w-4" />
          {t('api.codexAuth.logout')}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void onLogin()}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          <LogIn className="h-4 w-4" />
          {t('api.codexAuth.login')}
        </button>
      )}

      {status.authenticating && (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-xs text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('api.codexAuth.waiting')}
          </p>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!manualCode.trim()) return;
              void onSubmitCode(manualCode);
              setManualCode('');
            }}
          >
            <input
              type="password"
              autoComplete="off"
              value={manualCode}
              onChange={(event) => setManualCode(event.target.value)}
              placeholder={t('api.codexAuth.manualCodePlaceholder')}
              aria-label={t('api.codexAuth.manualCodePlaceholder')}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-text-primary outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={!manualCode.trim()}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs text-text-primary disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              {t('api.codexAuth.submitCode')}
            </button>
          </form>
          <p className="text-[11px] text-text-muted">{t('api.codexAuth.manualCodeHint')}</p>
        </div>
      )}
      <p className="text-[11px] leading-4 text-text-muted">{t('api.codexAuth.unofficial')}</p>
    </div>
  );
}
