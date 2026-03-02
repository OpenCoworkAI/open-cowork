import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import { NaviLabCard } from './NaviLabCard';
import type { NaviLab, CareerTrack, ContentBlock } from '../types';
import {
  Sparkles,
  Brain,
  Cloud,
  Code2,
  Database,
  Shield,
  Bot,
  Trophy,
  Zap,
  Target,
  ArrowLeft,
  TrendingUp,
  Filter,
} from 'lucide-react';

const TRACK_CONFIG: Record<CareerTrack, { icon: typeof Brain; label: string; color: string; bgColor: string }> = {
  genai: { icon: Bot, label: 'GenAI & LLMs', color: 'text-violet-400', bgColor: 'bg-violet-500/10' },
  fullstack: { icon: Code2, label: 'Full-Stack Dev', color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
  'cloud-devops': { icon: Cloud, label: 'Cloud & DevOps', color: 'text-orange-400', bgColor: 'bg-orange-500/10' },
  'ai-ml': { icon: Brain, label: 'AI / ML', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10' },
  'data-engineering': { icon: Database, label: 'Data Engineering', color: 'text-indigo-400', bgColor: 'bg-indigo-500/10' },
  cybersecurity: { icon: Shield, label: 'Cybersecurity', color: 'text-red-400', bgColor: 'bg-red-500/10' },
};

export function CareerBox() {
  const { t } = useTranslation();
  const {
    careerProfile,
    naviLabs,
    activeTrackFilter,
    setActiveTrackFilter,
    updateLabStatus,
    setShowCareerBox,
  } = useAppStore();
  const { startSession } = useIPC();
  const workingDir = useAppStore((state) => state.workingDir);

  const [isStartingLab, setIsStartingLab] = useState<string | null>(null);

  // Filter labs by track
  const filteredLabs = useMemo(() => {
    if (activeTrackFilter === 'all') return naviLabs;
    return naviLabs.filter((lab) => lab.track === activeTrackFilter);
  }, [naviLabs, activeTrackFilter]);

  // Group labs by track for the "all" view
  const labsByTrack = useMemo(() => {
    const groups: Record<string, NaviLab[]> = {};
    for (const lab of filteredLabs) {
      if (!groups[lab.track]) groups[lab.track] = [];
      groups[lab.track].push(lab);
    }
    return groups;
  }, [filteredLabs]);

  // Stats
  const totalLabs = naviLabs.length;
  const completedCount = naviLabs.filter((l) => l.status === 'completed').length;
  const totalXP = careerProfile.totalXP;

  // Get track counts
  const trackCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const lab of naviLabs) {
      counts[lab.track] = (counts[lab.track] || 0) + 1;
    }
    return counts;
  }, [naviLabs]);

  // Handle starting a lab
  const handleStartLab = async (lab: NaviLab) => {
    if (isStartingLab) return;
    setIsStartingLab(lab.id);

    try {
      updateLabStatus(lab.id, 'in_progress');

      const naviSystemPrompt = `You are Navi, an expert career coach and technical mentor AI. You are running an interactive lab session for the user. Your personality is encouraging, precise, and hands-on. You provide real code exercises, evaluate the user's work, and give constructive feedback.

Lab: ${lab.title}
Track: ${TRACK_CONFIG[lab.track].label}
Difficulty: ${lab.difficulty}
Skills covered: ${lab.skills.join(', ')}

IMPORTANT INSTRUCTIONS:
1. Start by welcoming the user to the lab and explaining what they'll learn
2. Break the lab into 3-5 clear exercises/steps
3. For each exercise, provide context, then a hands-on coding challenge
4. Wait for the user's response before moving to the next exercise
5. Score each exercise (1-10) and provide specific feedback
6. At the end, give an overall lab score and summary of skills demonstrated
7. Use markdown formatting for code blocks and structure
8. Keep the tone professional but encouraging — like a senior engineer mentoring a junior`;

      const contentBlocks: ContentBlock[] = [
        {
          type: 'text',
          text: `${naviSystemPrompt}\n\n---\n\n${lab.naviPrompt}`,
        },
      ];

      const sessionTitle = `Navi Lab: ${lab.title}`;
      await startSession(sessionTitle, contentBlocks, workingDir || undefined);
    } finally {
      setIsStartingLab(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowCareerBox(false)}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-text-primary">
                  {t('career.title')}
                </h1>
                <p className="text-xs text-text-muted">
                  {t('career.subtitle')}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <Trophy className="w-4 h-4 text-accent" />
            </div>
            <div>
              <p className="text-xs text-text-muted">{t('career.labsCompleted')}</p>
              <p className="text-sm font-semibold text-text-primary">
                {completedCount}/{totalLabs}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <p className="text-xs text-text-muted">{t('career.totalXP')}</p>
              <p className="text-sm font-semibold text-text-primary">{totalXP} XP</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Target className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-text-muted">{t('career.focus')}</p>
              <p className="text-sm font-semibold text-text-primary">
                {t('career.techJobs')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Track filter bar */}
      <div className="shrink-0 px-6 py-3 border-b border-border overflow-x-auto">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-text-muted flex-shrink-0" />
          <button
            onClick={() => setActiveTrackFilter('all')}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTrackFilter === 'all'
                ? 'bg-accent text-white'
                : 'bg-surface-muted text-text-secondary hover:bg-surface-hover'
            }`}
          >
            {t('career.allTracks')} ({totalLabs})
          </button>
          {(Object.entries(TRACK_CONFIG) as [CareerTrack, typeof TRACK_CONFIG[CareerTrack]][]).map(
            ([trackId, config]) => {
              const Icon = config.icon;
              const count = trackCounts[trackId] || 0;
              if (count === 0) return null;
              return (
                <button
                  key={trackId}
                  onClick={() => setActiveTrackFilter(trackId)}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    activeTrackFilter === trackId
                      ? 'bg-accent text-white'
                      : `bg-surface-muted text-text-secondary hover:bg-surface-hover`
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {config.label} ({count})
                </button>
              );
            }
          )}
        </div>
      </div>

      {/* Labs grid */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {activeTrackFilter === 'all' ? (
          // Grouped by track
          <div className="space-y-6">
            {(Object.entries(labsByTrack) as [string, NaviLab[]][]).map(
              ([trackId, labs]) => {
                const config = TRACK_CONFIG[trackId as CareerTrack];
                if (!config) return null;
                const Icon = config.icon;
                return (
                  <section key={trackId}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-7 h-7 rounded-lg ${config.bgColor} flex items-center justify-center`}>
                        <Icon className={`w-4 h-4 ${config.color}`} />
                      </div>
                      <h2 className="text-sm font-semibold text-text-primary">
                        {config.label}
                      </h2>
                      <span className="flex items-center gap-1 ml-2 text-[11px] text-emerald-400">
                        <TrendingUp className="w-3 h-3" />
                        {t('career.highDemand')}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {labs.map((lab) => (
                        <NaviLabCard
                          key={lab.id}
                          lab={lab}
                          onStart={handleStartLab}
                        />
                      ))}
                    </div>
                  </section>
                );
              }
            )}
          </div>
        ) : (
          // Flat filtered view
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredLabs.map((lab) => (
              <NaviLabCard key={lab.id} lab={lab} onStart={handleStartLab} />
            ))}
          </div>
        )}

        {filteredLabs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <Brain className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">{t('career.noLabs')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
