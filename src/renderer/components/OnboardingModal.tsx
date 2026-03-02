/**
 * OnboardingModal - First-launch modal asking the user where they prefer to work.
 * Navi uses this preference to tailor instructions (real machine vs VM).
 */

import { useState } from 'react';
import { Monitor, Server } from 'lucide-react';
import { useAppStore } from '../store';

interface Props {
  onComplete: () => void;
}

export function OnboardingModal({ onComplete }: Props) {
  const [selected, setSelected] = useState<'real-machine' | 'vm' | null>(null);
  const [saving, setSaving] = useState(false);
  const { setWorkEnvironment, setShowOnboardingModal } = useAppStore();

  const handleContinue = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await window.electronAPI.onboarding.setWorkEnvironment(selected);
      setWorkEnvironment(selected);
      setShowOnboardingModal(false);
      onComplete();
    } catch (err) {
      console.error('[OnboardingModal] Failed to save preference:', err);
    } finally {
      setSaving(false);
    }
  };

  const options = [
    {
      value: 'real-machine' as const,
      icon: Monitor,
      title: 'My Computer',
      description: 'Navi will guide you through actions on your real machine with step-by-step instructions.',
    },
    {
      value: 'vm' as const,
      icon: Server,
      title: 'Virtual Machine',
      description: 'Navi will guide you through actions inside a VM — isolated and safe for experimentation.',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-3xl shadow-xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-accent-muted px-6 py-5 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">
            Where do you work?
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Navi will tailor instructions based on your preferred environment. You can change this later in settings.
          </p>
        </div>

        {/* Options */}
        <div className="px-6 py-5 space-y-3">
          {options.map((opt) => {
            const isSelected = selected === opt.value;
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSelected(opt.value)}
                className={`w-full flex items-start gap-4 p-4 rounded-2xl border-2 transition-all text-left ${
                  isSelected
                    ? 'border-accent bg-accent-muted'
                    : 'border-border bg-surface hover:border-text-muted'
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  isSelected ? 'bg-accent text-white' : 'bg-surface-muted text-text-muted'
                }`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${
                    isSelected ? 'text-accent' : 'text-text-primary'
                  }`}>
                    {opt.title}
                  </p>
                  <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
                    {opt.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end">
          <button
            type="button"
            onClick={handleContinue}
            disabled={!selected || saving}
            className={`px-6 py-2 rounded-xl text-sm font-medium transition-all ${
              selected && !saving
                ? 'bg-accent text-white hover:bg-accent-hover'
                : 'bg-surface-muted text-text-muted cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving...' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
