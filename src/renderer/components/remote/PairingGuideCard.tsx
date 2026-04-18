/**
 * PairingGuideCard — step-by-step guide shown when pairing mode is active
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, X } from 'lucide-react';

const DISMISS_KEY = 'open-cowork-pairing-guide-dismissed';

const supportsStorage = typeof window !== 'undefined' && window.localStorage;

export function PairingGuideCard() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() =>
    supportsStorage ? localStorage.getItem(DISMISS_KEY) === 'true' : false
  );

  if (dismissed) return null;

  const steps = [
    t('remote.pairingGuideStep1'),
    t('remote.pairingGuideStep2'),
    t('remote.pairingGuideStep3'),
    t('remote.pairingGuideStep4'),
  ];

  function handleDismiss() {
    setDismissed(true);
    if (supportsStorage) localStorage.setItem(DISMISS_KEY, 'true');
  }

  return (
    <div className="p-5 rounded-2xl border border-accent/30 bg-accent/5 relative">
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 p-1 rounded-lg hover:bg-accent/10 text-text-secondary transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
      <h3 className="font-medium text-accent mb-4 flex items-center gap-2">
        <Link2 className="w-5 h-5" />
        {t('remote.pairingGuideTitle')}
      </h3>
      <ol className="space-y-2 text-sm text-text-secondary">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-accent/10 text-accent text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
