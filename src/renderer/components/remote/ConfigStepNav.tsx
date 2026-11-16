/**
 * ConfigStepNav — tab navigation for Remote Control configuration steps
 */

import { useTranslation } from 'react-i18next';
import { MessageSquare, Hash, Link2, Settings2, CheckCircle2 } from 'lucide-react';
import type { ConfigStep } from './types';

interface Props {
  activeStep: ConfigStep;
  isFeishuConfigured: boolean;
  isSlackConfigured: boolean;
  isConnectionConfigured: boolean;
  onStepChange: (step: ConfigStep) => void;
}

export function ConfigStepNav({
  activeStep,
  isFeishuConfigured,
  isSlackConfigured,
  isConnectionConfigured,
  onStepChange,
}: Props) {
  const { t } = useTranslation();

  const steps: { id: ConfigStep; labelKey: string; icon: React.ElementType; done: boolean }[] = [
    {
      id: 'feishu',
      labelKey: 'remote.stepFeishu',
      icon: MessageSquare,
      done: isFeishuConfigured,
    },
    {
      id: 'slack',
      labelKey: 'remote.stepSlack',
      icon: Hash,
      done: isSlackConfigured,
    },
    {
      id: 'connection',
      labelKey: 'remote.stepConnection',
      icon: Link2,
      done: isConnectionConfigured,
    },
    {
      id: 'advanced',
      labelKey: 'remote.stepAdvanced',
      icon: Settings2,
      done: true,
    },
  ];

  return (
    <div className="flex items-center gap-2 p-1 bg-surface rounded-xl">
      {steps.map((step) => (
        <button
          key={step.id}
          onClick={() => onStepChange(step.id)}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-lg transition-all ${
            activeStep === step.id
              ? 'bg-accent text-white'
              : 'hover:bg-surface-hover text-text-secondary'
          }`}
        >
          {step.done && activeStep !== step.id ? (
            <CheckCircle2 className="w-4 h-4 text-success" />
          ) : (
            <step.icon className="w-4 h-4" />
          )}
          <span className="text-sm font-medium whitespace-nowrap">{t(step.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
