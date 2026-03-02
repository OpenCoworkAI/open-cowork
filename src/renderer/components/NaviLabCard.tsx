import { useTranslation } from 'react-i18next';
import {
  Clock,
  Zap,
  TrendingUp,
  Lock,
  Play,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import type { NaviLab } from '../types';

interface NaviLabCardProps {
  lab: NaviLab;
  onStart: (lab: NaviLab) => void;
}

const difficultyColors: Record<string, string> = {
  beginner: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  intermediate: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  advanced: 'bg-red-500/10 text-red-500 border-red-500/20',
};

const trackColors: Record<string, string> = {
  genai: 'from-violet-500/20 to-purple-600/10',
  fullstack: 'from-blue-500/20 to-cyan-500/10',
  'cloud-devops': 'from-orange-500/20 to-amber-500/10',
  'ai-ml': 'from-emerald-500/20 to-teal-500/10',
  'data-engineering': 'from-indigo-500/20 to-blue-500/10',
  cybersecurity: 'from-red-500/20 to-rose-500/10',
};

function getDemandLabel(score: number): { label: string; color: string } {
  if (score >= 90) return { label: 'Very High Demand', color: 'text-emerald-400' };
  if (score >= 80) return { label: 'High Demand', color: 'text-green-400' };
  if (score >= 70) return { label: 'Moderate Demand', color: 'text-amber-400' };
  return { label: 'Growing', color: 'text-text-muted' };
}

export function NaviLabCard({ lab, onStart }: NaviLabCardProps) {
  const { t } = useTranslation();
  const demand = getDemandLabel(lab.demandScore);
  const isLocked = lab.status === 'locked';
  const isCompleted = lab.status === 'completed';
  const isInProgress = lab.status === 'in_progress';

  return (
    <div
      className={`group relative rounded-2xl border transition-all duration-200 overflow-hidden ${
        isLocked
          ? 'border-border/50 opacity-60'
          : isCompleted
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-border hover:border-accent/40 hover:shadow-elevated'
      }`}
    >
      {/* Gradient header stripe */}
      <div
        className={`h-1.5 bg-gradient-to-r ${trackColors[lab.track] || 'from-accent/20 to-accent/10'}`}
      />

      <div className="p-4 space-y-3">
        {/* Header: title + status */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-text-primary leading-snug flex-1">
            {lab.title}
          </h3>
          {isCompleted && (
            <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
          )}
          {isLocked && (
            <Lock className="w-4 h-4 text-text-muted flex-shrink-0" />
          )}
          {isInProgress && (
            <Loader2 className="w-4 h-4 text-accent flex-shrink-0 animate-spin" />
          )}
        </div>

        {/* Description */}
        <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">
          {lab.description}
        </p>

        {/* Skills tags */}
        <div className="flex flex-wrap gap-1.5">
          {lab.skills.slice(0, 4).map((skill) => (
            <span
              key={skill}
              className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-medium bg-surface-muted text-text-secondary border border-border-muted"
            >
              {skill}
            </span>
          ))}
        </div>

        {/* Meta row: difficulty, time, XP, demand */}
        <div className="flex items-center gap-3 text-[11px]">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full border font-medium capitalize ${
              difficultyColors[lab.difficulty]
            }`}
          >
            {t(`career.difficulty.${lab.difficulty}`)}
          </span>
          <span className="flex items-center gap-1 text-text-muted">
            <Clock className="w-3 h-3" />
            {lab.estimatedMinutes}m
          </span>
          <span className="flex items-center gap-1 text-accent">
            <Zap className="w-3 h-3" />
            {lab.xpReward} XP
          </span>
          <span className={`flex items-center gap-1 ml-auto ${demand.color}`}>
            <TrendingUp className="w-3 h-3" />
            {demand.label}
          </span>
        </div>

        {/* Action button */}
        {!isLocked && !isCompleted && (
          <button
            onClick={() => onStart(lab)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 bg-accent/10 text-accent hover:bg-accent hover:text-white"
          >
            <Play className="w-3.5 h-3.5" />
            {isInProgress
              ? t('career.continueLab')
              : t('career.startLab')}
          </button>
        )}

        {isCompleted && (
          <div className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-emerald-500/10 text-emerald-500">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {t('career.completed')}
          </div>
        )}

        {isLocked && (
          <div className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm text-text-muted bg-surface-muted">
            <Lock className="w-3.5 h-3.5" />
            {t('career.locked')}
          </div>
        )}
      </div>
    </div>
  );
}
