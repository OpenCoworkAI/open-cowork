/**
 * GatewayControlCard — main status card with toggle button and metrics
 */

import { useTranslation } from 'react-i18next';
import { Power, Smartphone, Loader2 } from 'lucide-react';
import type { GatewayStatus, PairedUser, PairingRequest } from './types';
import { Button } from '../ui';

interface Props {
  status: GatewayStatus | null;
  pairedUsers: PairedUser[];
  pendingPairings: PairingRequest[];
  isTogglingGateway: boolean;
  isFeishuConfigured: boolean;
  onToggle: () => void;
}

export function GatewayControlCard({
  status,
  pairedUsers,
  pendingPairings,
  isTogglingGateway,
  isFeishuConfigured,
  onToggle,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="relative overflow-hidden rounded-4xl border border-border-subtle bg-gradient-to-br from-background/80 to-background-secondary/80">
      <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
      <div className="relative p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div
              className={`p-3 rounded-2xl ${status?.running ? 'bg-success/10' : 'bg-surface-active'}`}
            >
              <Smartphone
                className={`w-8 h-8 ${status?.running ? 'text-success' : 'text-text-muted'}`}
              />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-text-primary">{t('remote.title')}</h2>
              <p className="text-sm text-text-secondary mt-0.5">
                {status?.running ? t('remote.statusRunning') : t('remote.statusStopped')}
              </p>
            </div>
          </div>

          <Button
            variant={status?.running ? 'danger' : 'primary'}
            size="lg"
            onClick={onToggle}
            disabled={isTogglingGateway || !isFeishuConfigured}
          >
            {isTogglingGateway ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Power className="w-4 h-4" />
            )}
            {status?.running ? t('remote.stopService') : t('remote.startService')}
          </Button>
        </div>

        {/* Status metrics — only shown when running */}
        {status?.running && (
          <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-border/50">
            <div className="text-center p-3 rounded-xl bg-surface/50">
              <div className="text-2xl font-bold text-accent">{status.activeSessions}</div>
              <div className="text-xs text-text-muted mt-1">{t('remote.activeSessions')}</div>
            </div>
            <div className="text-center p-3 rounded-xl bg-surface/50">
              <div className="text-2xl font-bold text-success">{pairedUsers.length}</div>
              <div className="text-xs text-text-muted mt-1">{t('remote.authorizedUsers')}</div>
            </div>
            <div className="text-center p-3 rounded-xl bg-surface/50">
              <div className="text-2xl font-bold text-warning">{pendingPairings.length}</div>
              <div className="text-xs text-text-muted mt-1">{t('remote.pendingApprovals')}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
