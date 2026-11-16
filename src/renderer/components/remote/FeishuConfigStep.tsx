/**
 * FeishuConfigStep — Feishu/Lark app credentials and DM policy configuration
 */

import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';

interface Props {
  domain: 'feishu' | 'lark';
  onDomainChange: (value: 'feishu' | 'lark') => void;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuDmPolicy: string;
  onAppIdChange: (value: string) => void;
  onAppSecretChange: (value: string) => void;
  onDmPolicyChange: (value: string) => void;
}

export function FeishuConfigStep({
  domain,
  onDomainChange,
  feishuAppId,
  feishuAppSecret,
  feishuDmPolicy,
  onAppIdChange,
  onAppSecretChange,
  onDmPolicyChange,
}: Props) {
  const { t } = useTranslation();

  const dmPolicies = [
    {
      value: 'pairing',
      label: t('remote.policyPairing'),
      desc: t('remote.policyPairingDesc'),
    },
    {
      value: 'allowlist',
      label: t('remote.policyAllowlist'),
      desc: t('remote.policyAllowlistDesc'),
    },
    {
      value: 'open',
      label: t('remote.policyOpen'),
      desc: t('remote.policyOpenDesc'),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-text-primary mb-1">{t('remote.feishuTitle')}</h3>
        <p className="text-sm text-text-secondary">{t('remote.feishuDesc')}</p>
      </div>

      <div className="grid gap-4">
        <div>
          <label
            htmlFor="feishu-domain"
            className="block text-sm font-medium text-text-secondary mb-2"
          >
            {t('remote.tenantEdition')}
          </label>
          <select
            id="feishu-domain"
            value={domain}
            onChange={(event) => onDomainChange(event.target.value === 'lark' ? 'lark' : 'feishu')}
            className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-text-primary"
          >
            <option value="feishu">{t('remote.feishuEdition')}</option>
            <option value="lark">{t('remote.larkEdition')}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">App ID</label>
          <input
            type="text"
            value={feishuAppId}
            onChange={(e) => onAppIdChange(e.target.value)}
            className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all"
            placeholder="cli_xxxxxxxxxxxxxxxx"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">App Secret</label>
          <input
            type="password"
            value={feishuAppSecret}
            onChange={(e) => onAppSecretChange(e.target.value)}
            className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all"
            placeholder="••••••••••••••••"
          />
        </div>

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
                  feishuDmPolicy === option.value
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
      </div>

      <a
        href={domain === 'lark' ? 'https://open.larksuite.com/app' : 'https://open.feishu.cn/app'}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
      >
        <ExternalLink className="w-4 h-4" />
        {t(domain === 'lark' ? 'remote.openLark' : 'remote.openFeishu')}
      </a>
    </div>
  );
}
