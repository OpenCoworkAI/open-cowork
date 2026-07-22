/**
 * QuickStartGuide — step-by-step setup guide for Feishu/Lark bot integration
 */

import { useTranslation } from 'react-i18next';

interface Props {
  permissionScopes: string[];
  permissionSeparator: string;
}

export function QuickStartGuide({ permissionScopes, permissionSeparator }: Props) {
  const { t } = useTranslation();

  const steps = [
    { key: '1', content: <span>{t('remote.quickStartStep1')}</span> },
    { key: '2', content: <span>{t('remote.quickStartStep2')}</span> },
    {
      key: '3',
      content: (
        <span>
          {t('remote.quickStartStep3')}
          {permissionScopes.map((scope, index) => (
            <span key={scope}>
              <code className="px-1 py-0.5 bg-surface rounded ml-1">{scope}</code>
              {index < permissionScopes.length - 1 ? permissionSeparator : ''}
            </span>
          ))}
        </span>
      ),
    },
    { key: '4', content: <span>{t('remote.quickStartStep4')}</span> },
    {
      key: '5',
      content: (
        <span>
          {t('remote.quickStartStep5Prefix')}{' '}
          <code className="px-1 py-0.5 bg-surface rounded">im.message.receive_v1</code>{' '}
          {t('remote.quickStartStep5Suffix')}
        </span>
      ),
    },
    { key: '6', content: <span>{t('remote.quickStartStep6')}</span> },
  ];

  return (
    <div className="p-5 rounded-4xl border border-border-subtle bg-background/55">
      <h4 className="font-medium text-text-primary mb-3">{t('remote.quickStart')}</h4>
      <ol className="space-y-2 text-sm text-text-secondary">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-accent/10 text-accent text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
              {step.key}
            </span>
            {step.content}
          </li>
        ))}
      </ol>
    </div>
  );
}
