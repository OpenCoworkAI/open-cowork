/**
 * CompanionPairingCard — one-time QR pairing for phone companion clients.
 *
 * Renders a "Pair phone" button that fetches a fresh one-time pairing code
 * through the companion module (main-process IPC) and shows it as a QR code,
 * ready to be scanned by the companion mobile app. Also lists paired phones
 * with a revoke action.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Smartphone, X, RefreshCw, Loader2, Trash2, AlertTriangle } from 'lucide-react';

interface PairStartResult {
  code?: string;
  expiresAt?: number;
  hosts?: string[];
  port?: number;
  qr?: { app: string; v: number; hosts: string[]; port?: number; code: string };
  error?: string;
}

interface PairedDevice {
  tokenPrefix: string;
  createdAt: number;
  lastSeenAt: number;
}

const isElectron =
  typeof window !== 'undefined' && window.electronAPI !== undefined;

export function CompanionPairingCard({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<PairStartResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [devices, setDevices] = useState<PairedDevice[]>([]);

  // Countdown ticker while the dialog is open.
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  const generateQr = async (payload: PairStartResult) => {
    if (!payload.qr || !payload.code) {
      setQrDataUrl(null);
      return;
    }
    const serialized = JSON.stringify(payload.qr);
    const dataUrl = await QRCode.toDataURL(serialized, {
      width: 280,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    setQrDataUrl(dataUrl);
  };

  const refreshDevices = async () => {
    if (!isElectron) return;
    try {
      const list = await window.electronAPI.remote.companion.listTokens();
      setDevices(list);
    } catch (err) {
      console.error('Failed to list companion tokens:', err);
    }
  };

  const openDialog = async () => {
    setIsOpen(true);
    setError(null);
    await startPairing();
    await refreshDevices();
  };

  const startPairing = async () => {
    if (!isElectron) {
      setError(t('remote.companion.notEnabled'));
      return;
    }
    setIsLoading(true);
    try {
      const ready = await window.electronAPI.remote.companion.isReady();
      if (!ready.enabled) {
        setError(t('remote.companion.notEnabled'));
        setResult(null);
        setQrDataUrl(null);
        return;
      }
      const payload = await window.electronAPI.remote.companion.startPairing();
      if (payload.error || !payload.code) {
        setError(payload.error || t('remote.companion.generateFailed'));
        setResult(null);
        setQrDataUrl(null);
        return;
      }
      setResult(payload);
      setError(null);
      await generateQr(payload);
      await refreshDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('remote.companion.generateFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const revokeDevice = async (tokenPrefix: string) => {
    if (!isElectron) return;
    try {
      await window.electronAPI.remote.companion.revokeToken(tokenPrefix);
      await refreshDevices();
    } catch (err) {
      console.error('Failed to revoke companion token:', err);
    }
  };

  const isExpired =
    result?.expiresAt !== undefined && now > result.expiresAt;
  const secondsLeft =
    result?.expiresAt !== undefined
      ? Math.max(0, Math.round((result.expiresAt - now) / 1000))
      : null;

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-border-subtle bg-gradient-to-br from-background/80 to-background-secondary/80">
      <div className="relative p-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-surface-active">
            <Smartphone className="w-8 h-8 text-text-muted" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary">
              {t('remote.companion.title')}
            </h2>
            <p className="text-sm text-text-secondary mt-0.5">
              {t('remote.companion.desc')}
            </p>
          </div>
        </div>

        <button
          onClick={openDialog}
          disabled={!isElectron || !enabled}
          className="flex items-center gap-2 shrink-0 px-5 py-2.5 rounded-xl font-medium transition-all bg-accent hover:bg-accent/90 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          title={!enabled ? t('remote.companion.notEnabled') : undefined}
        >
          <Smartphone className="w-4 h-4" />
          {t('remote.companion.generate')}
        </button>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-surface p-6 border border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4">
              <h3 className="text-lg font-semibold text-text-primary">
                {t('remote.companion.title')}
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 rounded-lg hover:bg-surface-active text-text-muted"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 mb-4 rounded-xl bg-warning/10 text-sm text-warning">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {qrDataUrl && result && !isExpired ? (
              <div className="flex flex-col items-center gap-4">
                <img src={qrDataUrl} alt="Pairing QR code" data-testid="companion-qr-image" />
                <div className="text-center">
                  <div className="text-2xl font-mono font-bold tracking-[0.25em] text-text-primary">
                    {result.code}
                  </div>
                  <div className="text-xs text-text-muted mt-1" data-testid="companion-expires">
                    {t('remote.companion.expiresIn', { seconds: secondsLeft })}
                  </div>
                </div>
              </div>
            ) : (
              result && (
                <div className="text-center text-sm text-text-secondary py-6">
                  {t('remote.companion.expiredNote')}
                </div>
              )
            )}

            <button
              onClick={startPairing}
              disabled={isLoading}
              className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all bg-accent hover:bg-accent/90 text-white disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {t('remote.companion.regenerate')}
            </button>

            <div className="mt-5 pt-4 border-t border-border/50">
              <div className="text-xs font-medium text-text-secondary mb-2">
                {t('remote.companion.pairedDevices')}
              </div>
              {devices.length === 0 ? (
                <div className="text-xs text-text-muted">
                  {t('remote.companion.noDevices')}
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {devices.map((device) => (
                    <li
                      key={device.tokenPrefix}
                      className="flex items-center justify-between px-3 py-2 rounded-xl bg-surface/60"
                    >
                      <span className="font-mono text-xs text-text-primary">
                        {device.tokenPrefix}…
                      </span>
                      <button
                        onClick={() => revokeDevice(device.tokenPrefix)}
                        className="p-1.5 rounded-lg hover:bg-error/10 text-error"
                        title={t('remote.companion.revoke')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
