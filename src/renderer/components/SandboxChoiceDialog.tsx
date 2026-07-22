import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, ShieldAlert } from 'lucide-react';
import {
  Button,
  DialogOverlay,
  DialogPanel,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from './ui';

const CHOICE_KEY = 'sandbox-choice-made';

export function shouldOfferSandboxChoice(isElectron: boolean, platform?: string): boolean {
  if (!isElectron) return false;
  if (localStorage.getItem(CHOICE_KEY)) return false;
  // Only platforms with a VM backend get the offer.
  return platform === 'darwin' || platform === 'win32';
}

/**
 * One-time first-run choice: enable VM isolation (informed opt-in, image
 * download disclosed) or start without it. Replaces the previous silent
 * default-off, which left users unaware they were running unprotected.
 * Provisioning progress surfaces through the existing SandboxSetupDialog.
 */
export function SandboxChoiceDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const finish = () => {
    localStorage.setItem(CHOICE_KEY, '1');
    onDone();
  };

  const handleEnable = async () => {
    setBusy(true);
    try {
      await window.electronAPI?.config?.save?.({ sandboxEnabled: true });
      // Kick off provisioning right away; progress renders via the
      // sandbox-setup events the app already listens to.
      await window.electronAPI?.sandbox?.retrySetup?.();
    } catch (error) {
      console.error('[SandboxChoice] enable failed:', error);
    } finally {
      finish();
    }
  };

  return (
    <DialogOverlay closeOnScrim={false}>
      <DialogPanel size="md">
        <DialogHeader>
          <DialogTitle>{t('sandboxChoice.title')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm leading-6 text-text-secondary">{t('sandboxChoice.body')}</p>
          <div className="mt-4 space-y-2.5">
            <div className="flex items-start gap-2.5 rounded-xl border border-success/25 bg-success/8 px-3 py-2.5">
              <Shield className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
              <p className="text-xs leading-5 text-text-secondary">
                {t('sandboxChoice.enableHint')}
              </p>
            </div>
            <div className="flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning/8 px-3 py-2.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
              <p className="text-xs leading-5 text-text-secondary">{t('sandboxChoice.skipHint')}</p>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={finish}>
            {t('sandboxChoice.skip')}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              void handleEnable();
            }}
          >
            {busy ? t('sandboxChoice.enabling') : t('sandboxChoice.enable')}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </DialogOverlay>
  );
}
