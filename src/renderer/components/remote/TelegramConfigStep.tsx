import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TelegramChannelConfig } from '../../../shared/ipc-types';
import { getTelegramConfigError } from '../../../shared/telegram-channel-config';

export function TelegramConfigStep({
  config,
  onSaved,
}: {
  config?: TelegramChannelConfig;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [users, setUsers] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    setToken(config?.botToken || '');
    setUsers(config?.dm.allowFrom?.join(', ') || '');
  }, [config]);

  async function save() {
    const next: TelegramChannelConfig | null = token.trim()
      ? {
          type: 'telegram',
          botToken: token.trim(),
          dm: { policy: 'allowlist', allowFrom: users.split(/[,\s]+/).filter(Boolean) },
        }
      : null;
    if (next && getTelegramConfigError(next)) {
      setError(true);
      return;
    }
    setSaving(true);
    setError(false);
    try {
      const result = await window.electronAPI.remote.updateTelegramConfig(next);
      if (!result.success) {
        setError(true);
        return;
      }
      await onSaved();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium text-text-primary">{t('remote.telegramTitle')}</h3>
      <p className="text-sm text-text-secondary">{t('remote.telegramSetup')}</p>
      <a
        href="https://t.me/BotFather"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-accent underline"
      >
        {t('remote.telegramBotFather')}
      </a>
      <label className="block text-sm text-text-secondary">
        {t('remote.telegramToken')}
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="block w-full mt-2 p-3 bg-surface-hover border border-border rounded-xl text-text-primary"
        />
      </label>
      <label className="block text-sm text-text-secondary">
        {t('remote.telegramAllowedUsers')}
        <input
          value={users}
          onChange={(event) => setUsers(event.target.value)}
          className="block w-full mt-2 p-3 bg-surface-hover border border-border rounded-xl text-text-primary"
        />
      </label>
      {error && (
        <p role="alert" className="text-error text-sm">
          {t('remote.telegramSaveError')}
        </p>
      )}
      <button
        onClick={save}
        disabled={saving}
        className="px-4 py-2 bg-accent text-white rounded-xl disabled:opacity-50"
      >
        {t(saving ? 'remote.saving' : 'remote.saveConfig')}
      </button>
    </div>
  );
}
