/**
 * SandboxRepairDialog - Guides users through fixing Ubuntu 24.04 sandbox issues
 *
 * Shown when WSL detects Ubuntu 24.04 with AppArmor not enabled or
 * unprivileged user namespace restrictions active. Provides step-by-step
 * fix instructions and a "copy command" button.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Copy, Check, X, RefreshCw } from 'lucide-react';

interface Props {
  issues: string[];
  distro?: string;
  onDismiss: () => void;
  onRetry: () => void;
}

const WSLCONFIG_FIX = `# Add to %USERPROFILE%\\.wslconfig
[wsl2]
kernelCommandLine = apparmor=1 security=apparmor`;

const USERNS_FIX = `# Run inside WSL to disable unprivileged userns restriction:
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0

# To persist across reboots:
echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/99-sandbox.conf`;

export function SandboxRepairDialog({ issues, distro, onDismiss, onRetry }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);

  const hasAppArmorNotEnabled = issues.includes('apparmor_not_enabled');
  const hasUsernsRestricted = issues.includes('apparmor_userns_restricted');

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl shadow-elevated max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center text-warning">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-text-primary">
              {t('sandbox.repairTitle')}
            </h2>
            <p className="text-xs text-text-muted">
              Ubuntu 24.04 {distro ? `(${distro})` : ''}
            </p>
          </div>
          <button
            onClick={onDismiss}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          <p className="text-sm text-text-secondary">
            {t('sandbox.repairDescription')}
          </p>

          {/* Issue: AppArmor not enabled in WSL kernel */}
          {hasAppArmorNotEnabled && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-text-primary">
                {t('sandbox.repairAppArmorTitle')}
              </h3>
              <p className="text-xs text-text-muted">
                {t('sandbox.repairAppArmorDesc')}
              </p>
              <div className="relative">
                <pre className="p-3 rounded-lg bg-surface-muted text-xs text-text-secondary font-mono overflow-x-auto">
                  {WSLCONFIG_FIX}
                </pre>
                <button
                  onClick={() => handleCopy(WSLCONFIG_FIX, 'wslconfig')}
                  className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 text-text-muted hover:text-text-primary transition-colors"
                  title={t('common.copy')}
                >
                  {copied === 'wslconfig' ? (
                    <Check className="w-3.5 h-3.5 text-success" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              <p className="text-xs text-text-muted">
                {t('sandbox.repairAppArmorRestart')}
              </p>
            </div>
          )}

          {/* Issue: Unprivileged userns restricted */}
          {hasUsernsRestricted && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-text-primary">
                {t('sandbox.repairUsernsTitle')}
              </h3>
              <p className="text-xs text-text-muted">
                {t('sandbox.repairUsernsDesc')}
              </p>
              <div className="relative">
                <pre className="p-3 rounded-lg bg-surface-muted text-xs text-text-secondary font-mono overflow-x-auto">
                  {USERNS_FIX}
                </pre>
                <button
                  onClick={() => handleCopy(USERNS_FIX, 'userns')}
                  className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 text-text-muted hover:text-text-primary transition-colors"
                  title={t('common.copy')}
                >
                  {copied === 'userns' ? (
                    <Check className="w-3.5 h-3.5 text-success" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-surface/50">
          <button
            onClick={onDismiss}
            className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-hover transition-colors"
          >
            {t('sandbox.repairLater')}
          </button>
          <button
            onClick={onRetry}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            {t('sandbox.repairRetry')}
          </button>
        </div>
      </div>
    </div>
  );
}
