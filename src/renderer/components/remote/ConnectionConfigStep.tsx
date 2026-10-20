/**
 * ConnectionConfigStep — long-connection vs webhook mode selection,
 * including ngrok tunnel configuration and webhook URL display
 */

import { useTranslation } from 'react-i18next';
import { Zap, Link2, Check, Copy, CheckCircle2 } from 'lucide-react';
import type { TunnelStatus } from './types';

interface Props {
  useLongConnection: boolean;
  verificationToken: string;
  encryptKey: string;
  tunnelEnabled: boolean;
  ngrokAuthToken: string;
  gatewayPort: number;
  tunnelStatus: TunnelStatus | null;
  webhookUrl: string | null;
  onLongConnectionChange: (value: boolean) => void;
  onVerificationTokenChange: (value: string) => void;
  onEncryptKeyChange: (value: string) => void;
  onTunnelEnabledChange: (value: boolean) => void;
  onNgrokAuthTokenChange: (value: string) => void;
  onCopy: (text: string) => void;
}

export function ConnectionConfigStep({
  useLongConnection,
  verificationToken,
  encryptKey,
  tunnelEnabled,
  ngrokAuthToken,
  gatewayPort,
  tunnelStatus,
  webhookUrl,
  onLongConnectionChange,
  onVerificationTokenChange,
  onEncryptKeyChange,
  onTunnelEnabledChange,
  onNgrokAuthTokenChange,
  onCopy,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-text-primary mb-1">
          {t('remote.connectionTitle')}
        </h3>
        <p className="text-sm text-text-secondary">{t('remote.connectionDesc')}</p>
      </div>

      {/* Long-connection mode — recommended */}
      <div
        onClick={() => onLongConnectionChange(true)}
        className={`p-5 rounded-xl border-2 cursor-pointer transition-all ${
          useLongConnection
            ? 'border-success bg-success/5'
            : 'border-border hover:border-success/50'
        }`}
      >
        <div className="flex items-start gap-4">
          <div
            className={`p-2 rounded-lg ${useLongConnection ? 'bg-success/10' : 'bg-surface-active'}`}
          >
            <Zap className={`w-6 h-6 ${useLongConnection ? 'text-success' : 'text-text-muted'}`} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-text-primary">{t('remote.longConnection')}</span>
              <span className="px-2 py-0.5 text-xs rounded-full bg-success/10 text-success font-medium">
                {t('remote.recommended')}
              </span>
            </div>
            <p className="text-sm text-text-secondary mt-1">{t('remote.longConnectionDesc')}</p>
            <div className="flex items-center gap-4 mt-3 text-xs text-text-muted">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-success" /> {t('remote.noPublicInternet')}
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-success" /> {t('remote.outOfBox')}
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-success" /> {t('remote.stableReliable')}
              </span>
            </div>
          </div>
          <div
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
              useLongConnection ? 'border-success bg-success' : 'border-border'
            }`}
          >
            {useLongConnection && <Check className="w-3 h-3 text-white" />}
          </div>
        </div>
      </div>

      {/* Webhook mode */}
      <div
        onClick={() => onLongConnectionChange(false)}
        className={`p-5 rounded-xl border-2 cursor-pointer transition-all ${
          !useLongConnection ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'
        }`}
      >
        <div className="flex items-start gap-4">
          <div
            className={`p-2 rounded-lg ${!useLongConnection ? 'bg-accent/10' : 'bg-surface-active'}`}
          >
            <Link2
              className={`w-6 h-6 ${!useLongConnection ? 'text-accent' : 'text-text-muted'}`}
            />
          </div>
          <div className="flex-1">
            <div className="font-medium text-text-primary">{t('remote.webhookMode')}</div>
            <p className="text-sm text-text-secondary mt-1">{t('remote.webhookDesc')}</p>
          </div>
          <div
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
              !useLongConnection ? 'border-accent bg-accent' : 'border-border'
            }`}
          >
            {!useLongConnection && <Check className="w-3 h-3 text-white" />}
          </div>
        </div>

        {/* Webhook URL and ngrok settings — shown only in webhook mode */}
        {!useLongConnection && (
          <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">
                {t('remote.localWebhookUrl')}
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-surface-hover rounded-lg text-sm font-mono text-text-secondary truncate">
                  http://127.0.0.1:{gatewayPort}/webhook/feishu
                </code>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopy(`http://127.0.0.1:${gatewayPort}/webhook/feishu`);
                  }}
                  className="p-2 rounded-lg hover:bg-surface-active transition-colors"
                >
                  <Copy className="w-4 h-4 text-text-muted" />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1">{t('remote.encryptKey')}</label>
              <input
                type="password"
                value={encryptKey}
                onChange={(e) => onEncryptKeyChange(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full px-3 py-2 bg-surface-hover border border-border rounded-lg text-sm text-text-primary focus:border-accent focus:outline-none"
                placeholder={t('remote.encryptKeyPlaceholder')}
              />
              <p className="text-xs text-text-muted mt-2">{t('remote.encryptKeyHint')}</p>
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1">
                {t('remote.verificationToken')}
              </label>
              <input
                type="password"
                value={verificationToken}
                onChange={(e) => onVerificationTokenChange(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full px-3 py-2 bg-surface-hover border border-border rounded-lg text-sm text-text-primary focus:border-accent focus:outline-none"
                placeholder={t('remote.verificationTokenPlaceholder')}
              />
              <p className="text-xs text-text-muted mt-2">{t('remote.verificationTokenHint')}</p>
            </div>

            {/* Built-in ngrok tunnel */}
            <div className="p-4 rounded-lg bg-surface-hover">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-text-primary">
                  {t('remote.useBuiltInNgrok')}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTunnelEnabledChange(!tunnelEnabled);
                  }}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    tunnelEnabled ? 'bg-accent' : 'bg-surface-active'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      tunnelEnabled ? 'left-5' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>

              {tunnelEnabled && (
                <div>
                  <input
                    type="password"
                    value={ngrokAuthToken}
                    onChange={(e) => onNgrokAuthTokenChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary focus:border-accent focus:outline-none"
                    placeholder="ngrok authtoken"
                  />
                  <p className="text-xs text-text-muted mt-2">
                    {t('remote.ngrokHelpPrefix')}{' '}
                    <a
                      href="https://ngrok.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      ngrok.com
                    </a>{' '}
                    {t('remote.ngrokHelpSuffix')}
                  </p>
                </div>
              )}

              {tunnelStatus?.connected && webhookUrl && (
                <div className="mt-3 p-2 rounded-lg bg-success/10">
                  <div className="flex items-center gap-2 text-success text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{t('remote.tunnelConnected')}</span>
                  </div>
                  <code className="block mt-1 text-xs font-mono text-text-secondary truncate">
                    {webhookUrl}
                  </code>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {useLongConnection && (
        <div className="p-4 rounded-xl bg-accent-muted border border-accent/20">
          <p className="text-sm text-accent">{t('remote.longConnectionHint')}</p>
        </div>
      )}
    </div>
  );
}
