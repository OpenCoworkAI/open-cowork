/**
 * ConfigStepNav — tab navigation for the three configuration steps
 */

import { useTranslation } from 'react-i18next';
import { MessageSquare, Mail, Link2, Settings2, CheckCircle2 } from 'lucide-react';
import type { ConfigStep } from './types';

interface Props {
  activeStep: ConfigStep;
  isFeishuConfigured: boolean;
  isEmailConfigured: boolean;
  isConnectionConfigured: boolean;
  onStepChange: (step: ConfigStep) => void;
}

export function ConfigStepNav({
  activeStep,
  isFeishuConfigured,
  isEmailConfigured,
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
      id: 'email',
      labelKey: 'remote.stepEmail',
      icon: Mail,
      done: isEmailConfigured,
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
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-all ${
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
          <span className="text-sm font-medium">{t(step.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
