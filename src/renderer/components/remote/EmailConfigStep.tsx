/**
 * EmailConfigStep — Email (IMAP/SMTP) credentials and DM policy configuration.
 *
 * Presentational component; state is owned by the parent panel (mirrors
 * SlackConfigStep / FeishuConfigStep). Provider metadata is kept renderer-local
 * so this file never imports from the main process.
 */

import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';

/** Provider presets for the UI (labels + help links only). */
const PROVIDERS: Array<{
  value: string;
  label: string;
  requiresAppPassword: boolean;
  helpUrl?: string;
}> = [
  {
    value: 'gmail',
    label: 'Gmail / Google Workspace',
    requiresAppPassword: true,
    helpUrl: 'https://support.google.com/accounts/answer/185833',
  },
  {
    value: 'outlook',
    label: 'Outlook / Microsoft 365',
    requiresAppPassword: true,
    helpUrl: 'https://support.microsoft.com/account-billing/5896164f-1c2b-4d99-90e6-58b90bda9c48',
  },
  {
    value: 'yahoo',
    label: 'Yahoo Mail',
    requiresAppPassword: true,
    helpUrl: 'https://help.yahoo.com/kb/SLN15241.html',
  },
  {
    value: 'icloud',
    label: 'iCloud Mail',
    requiresAppPassword: true,
    helpUrl: 'https://support.apple.com/en-us/102654',
  },
  {
    value: 'gmx',
    label: 'GMX',
    requiresAppPassword: false,
    helpUrl: 'https://hilfe.gmx.net/pop-imap/imap/index.html',
  },
  {
    value: 'webde',
    label: 'WEB.DE',
    requiresAppPassword: false,
    helpUrl: 'https://hilfe.web.de/pop-imap/imap/index.html',
  },
  {
    value: 'zoho',
    label: 'Zoho Mail',
    requiresAppPassword: true,
    helpUrl: 'https://www.zoho.com/mail/help/imap-access.html',
  },
  { value: 'custom', label: 'Custom (IMAP/SMTP)', requiresAppPassword: false },
];

interface Props {
  provider: string;
  address: string;
  password: string;
  fromName: string;
  imapHost: string;
  imapPort: string;
  smtpHost: string;
  smtpPort: string;
  dmPolicy: string;
  allowFrom: string;
  onProviderChange: (value: string) => void;
  onAddressChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onFromNameChange: (value: string) => void;
  onImapHostChange: (value: string) => void;
  onImapPortChange: (value: string) => void;
  onSmtpHostChange: (value: string) => void;
  onSmtpPortChange: (value: string) => void;
  onDmPolicyChange: (value: string) => void;
  onAllowFromChange: (value: string) => void;
}

export function EmailConfigStep({
  provider,
  address,
  password,
  fromName,
  imapHost,
  imapPort,
  smtpHost,
  smtpPort,
  dmPolicy,
  allowFrom,
  onProviderChange,
  onAddressChange,
  onPasswordChange,
  onFromNameChange,
  onImapHostChange,
  onImapPortChange,
  onSmtpHostChange,
  onSmtpPortChange,
  onDmPolicyChange,
  onAllowFromChange,
}: Props) {
  const { t } = useTranslation();

  const selected = PROVIDERS.find((p) => p.value === provider) ?? PROVIDERS[0];
  const isCustom = provider === 'custom';

  const dmPolicies = [
    { value: 'pairing', label: t('remote.policyPairing'), desc: t('remote.policyPairingDesc') },
    {
      value: 'allowlist',
      label: t('remote.policyAllowlist'),
      desc: t('remote.policyAllowlistDesc'),
    },
    { value: 'open', label: t('remote.policyOpen'), desc: t('remote.policyOpenDesc') },
  ];

  const inputClass =
    'w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all';

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-text-primary mb-1">{t('remote.emailTitle')}</h3>
        <p className="text-sm text-text-secondary">{t('remote.emailDesc')}</p>
      </div>

      <div className="grid gap-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            {t('remote.emailProvider')}
          </label>
          <select
            value={provider}
            onChange={(e) => onProviderChange(e.target.value)}
            className={inputClass}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            {t('remote.emailAddress')}
          </label>
          <input
            type="email"
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            className={inputClass}
            placeholder="assistant@example.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            {t('remote.emailPassword')}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            className={inputClass}
            placeholder="••••••••••••"
          />
          {selected.requiresAppPassword && (
            <p className="text-xs text-text-muted mt-1">{t('remote.emailPasswordHint')}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            {t('remote.emailFromName')}
          </label>
          <input
            type="text"
            value={fromName}
            onChange={(e) => onFromNameChange(e.target.value)}
            className={inputClass}
            placeholder="Open Cowork Assistant"
          />
        </div>

        {isCustom && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                {t('remote.emailImapHost')}
              </label>
              <input
                type="text"
                value={imapHost}
                onChange={(e) => onImapHostChange(e.target.value)}
                className={inputClass}
                placeholder="imap.example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                {t('remote.emailImapPort')}
              </label>
              <input
                type="number"
                value={imapPort}
                onChange={(e) => onImapPortChange(e.target.value)}
                className={inputClass}
                placeholder="993"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                {t('remote.emailSmtpHost')}
              </label>
              <input
                type="text"
                value={smtpHost}
                onChange={(e) => onSmtpHostChange(e.target.value)}
                className={inputClass}
                placeholder="smtp.example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                {t('remote.emailSmtpPort')}
              </label>
              <input
                type="number"
                value={smtpPort}
                onChange={(e) => onSmtpPortChange(e.target.value)}
                className={inputClass}
                placeholder="587"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            {t('remote.dmPolicy')}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {dmPolicies.map((option) => (
              <button
                key={option.value}
                onClick={() => onDmPolicyChange(option.value)}
                className={`p-3 rounded-xl border-2 text-left transition-all ${
                  dmPolicy === option.value
                    ? 'border-accent bg-accent/5'
                    : 'border-border hover:border-accent/50'
                }`}
              >
                <div className="font-medium text-text-primary text-sm">{option.label}</div>
                <div className="text-xs text-text-muted mt-0.5">{option.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {dmPolicy === 'allowlist' && (
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {t('remote.emailAllowFrom')}
            </label>
            <input
              type="text"
              value={allowFrom}
              onChange={(e) => onAllowFromChange(e.target.value)}
              className={inputClass}
              placeholder="me@example.com, teammate@example.com"
            />
          </div>
        )}
      </div>

      {selected.helpUrl && (
        <a
          href={selected.helpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
        >
          <ExternalLink className="w-4 h-4" />
          {t('remote.emailProviderHelp')}
        </a>
      )}
    </div>
  );
}
