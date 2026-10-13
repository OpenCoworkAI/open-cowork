/**
 * AdvancedConfigStep — gateway port, working directory, and auto-approve settings
 */

import { useTranslation } from 'react-i18next';

interface Props {
  defaultWorkingDirectory: string;
  gatewayPort: number;
  autoApproveSafeTools: boolean;
  companionEnabled: boolean;
  onWorkingDirectoryChange: (value: string) => void;
  onGatewayPortChange: (value: number) => void;
  onAutoApproveChange: (value: boolean) => void;
  onCompanionEnabledChange: (value: boolean) => void;
}

export function AdvancedConfigStep({
  defaultWorkingDirectory,
  gatewayPort,
  autoApproveSafeTools,
  companionEnabled,
  onWorkingDirectoryChange,
  onGatewayPortChange,
  onAutoApproveChange,
  onCompanionEnabledChange,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-text-primary mb-1">{t('remote.advancedTitle')}</h3>
        <p className="text-sm text-text-secondary">{t('remote.advancedDesc')}</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            {t('remote.defaultWorkingDirectory')}
          </label>
          <input
            type="text"
            value={defaultWorkingDirectory}
            onChange={(e) => onWorkingDirectoryChange(e.target.value)}
            className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-text-primary focus:border-accent focus:outline-none"
            placeholder={t('remote.defaultWorkingDirectoryPlaceholder')}
          />
          <p className="text-xs text-text-muted mt-1">
            {t('remote.defaultWorkingDirectoryHint')}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            {t('remote.gatewayPort')}
          </label>
          <input
            type="number"
            value={gatewayPort}
            onChange={(e) => onGatewayPortChange(parseInt(e.target.value) || 18789)}
            className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-text-primary focus:border-accent focus:outline-none"
            placeholder="18789"
          />
        </div>

        <div className="flex items-center justify-between p-4 rounded-xl bg-surface-hover">
          <div>
            <div className="font-medium text-text-primary text-sm">
              {t('remote.autoApproveSafeTools')}
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              {t('remote.autoApproveSafeToolsDesc')}
            </p>
          </div>
          <button
            onClick={() => onAutoApproveChange(!autoApproveSafeTools)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              autoApproveSafeTools ? 'bg-accent' : 'bg-surface-active'
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                autoApproveSafeTools ? 'left-5' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between p-4 rounded-xl bg-surface-hover">
          <div>
            <div className="font-medium text-text-primary text-sm">
              {t('remote.companionModule')}
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              {t('remote.companionModuleDesc')}
            </p>
          </div>
          <button
            onClick={() => onCompanionEnabledChange(!companionEnabled)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              companionEnabled ? 'bg-accent' : 'bg-surface-active'
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                companionEnabled ? 'left-5' : 'left-0.5'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
