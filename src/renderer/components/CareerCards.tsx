import { useMemo, type ReactNode } from 'react';
import {
  Target,
  Briefcase,
  GraduationCap,
  MapPin,
  DollarSign,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  Clock,
  Star,
  BookOpen,
  Trophy,
  AlertCircle,
  Lightbulb,
  ArrowRight,
  Flame,
} from 'lucide-react';
import type {
  GoalProgressData,
  SkillGapData,
  JobSuggestionData,
  CareerPathData,
  WeeklyReflectionData,
  HabitTrackerData,
  LearningResourceData,
  MarketInsightData,
} from '../types/career';

// ─── Career Card Renderer ────────────────────────────────────────────
// Splits assistant text on ```json:card-type blocks and renders rich cards
// inline with the normal Markdown content.

const CARD_REGEX = /```json:([a-z-]+)\n([\s\S]*?)\n```/g;

interface CareerCardRendererProps {
  text: string;
  isStreaming?: boolean;
  renderMarkdown: (content: string, isLast?: boolean) => ReactNode;
}

export function CareerCardRenderer({ text, isStreaming, renderMarkdown }: CareerCardRendererProps) {
  const parts = useMemo(() => {
    // Quick check: if no career card pattern, skip regex work
    if (!text.includes('```json:')) {
      return null;
    }

    const result: Array<{ type: 'text'; content: string } | { type: 'card'; cardType: string; data: unknown }> = [];
    let lastIndex = 0;

    // Reset regex state
    CARD_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = CARD_REGEX.exec(text)) !== null) {
      // Add text before this match
      if (match.index > lastIndex) {
        const before = text.slice(lastIndex, match.index);
        if (before.trim()) {
          result.push({ type: 'text', content: before });
        }
      }

      // Try to parse the JSON card
      const cardType = match[1];
      const jsonContent = match[2];
      try {
        const data = JSON.parse(jsonContent);
        result.push({ type: 'card', cardType, data });
      } catch {
        // Invalid JSON — render as plain text
        result.push({ type: 'text', content: match[0] });
      }

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text after last match
    if (lastIndex < text.length) {
      const remaining = text.slice(lastIndex);
      if (remaining.trim()) {
        result.push({ type: 'text', content: remaining });
      }
    }

    return result.length > 0 ? result : null;
  }, [text]);

  // No career cards found — delegate entirely to existing Markdown renderer
  if (!parts) {
    return <>{renderMarkdown(text, true)}</>;
  }

  return (
    <div className="space-y-3">
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1;
        if (part.type === 'text') {
          return <div key={i}>{renderMarkdown(part.content, isLast && !!isStreaming)}</div>;
        }
        return <CareerCard key={i} type={part.cardType} data={part.data} />;
      })}
    </div>
  );
}

// ─── Card Dispatcher ─────────────────────────────────────────────────

function CareerCard({ type, data }: { type: string; data: unknown }) {
  switch (type) {
    case 'goal-progress':
      return <GoalProgressCard data={data as GoalProgressData} />;
    case 'skill-gap':
      return <SkillGapCard data={data as SkillGapData} />;
    case 'job-suggestion':
      return <JobSuggestionCard data={data as JobSuggestionData} />;
    case 'career-path':
      return <CareerPathCard data={data as CareerPathData} />;
    case 'weekly-reflection':
      return <WeeklyReflectionCard data={data as WeeklyReflectionData} />;
    case 'habit-tracker':
      return <HabitTrackerCard data={data as HabitTrackerData} />;
    case 'learning-resource':
      return <LearningResourceCard data={data as LearningResourceData} />;
    case 'market-insight':
      return <MarketInsightCard data={data as MarketInsightData} />;
    default:
      return (
        <div className="card p-3 text-xs text-text-muted">
          Unknown card type: {type}
        </div>
      );
  }
}

// ─── 1. Goal Progress Card ───────────────────────────────────────────

function GoalProgressCard({ data }: { data: GoalProgressData }) {
  const progress = Math.min(Math.max(data.progress || 0, 0), 100);

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent-muted flex items-center justify-center">
            <Target className="w-4 h-4 text-accent" />
          </div>
          <span className="text-sm font-semibold text-text-primary">{data.title}</span>
        </div>
        <div className="flex items-center gap-2">
          {data.status && (
            <span className="badge badge-running">{data.status}</span>
          )}
          {data.targetDate && (
            <span className="badge badge-idle">{data.targetDate}</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-2 bg-surface-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-text-muted">
          <span>{progress}% complete</span>
          {data.milestones && (
            <span>
              {data.milestones.filter((m) => m.completed).length}/{data.milestones.length} milestones
            </span>
          )}
        </div>
      </div>

      {/* Milestones */}
      {data.milestones && data.milestones.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-border">
          {data.milestones.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {m.completed ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-success flex-shrink-0" />
              ) : (
                <div className="w-3.5 h-3.5 rounded-full border-2 border-border flex-shrink-0" />
              )}
              <span
                className={
                  m.completed
                    ? 'text-text-muted line-through'
                    : 'text-text-primary'
                }
              >
                {m.title}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 2. Skill Gap Card ──────────────────────────────────────────────

function SkillGapCard({ data }: { data: SkillGapData }) {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center">
          <GraduationCap className="w-4 h-4 text-indigo-500" />
        </div>
        <span className="text-sm font-semibold text-text-primary">
          {data.role ? `Skill Gap: ${data.role}` : 'Skill Gap Analysis'}
        </span>
      </div>

      <div className="space-y-2.5">
        {data.skills.map((skill, i) => {
          const gap = skill.required - skill.current;
          const gapColor = gap > 30 ? 'text-error' : gap > 15 ? 'text-warning' : 'text-success';
          return (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-primary font-medium">{skill.name}</span>
                <span className={`font-medium ${gapColor}`}>
                  {gap > 0 ? `−${gap}` : 'Met'}
                </span>
              </div>
              <div className="relative h-2 bg-surface-muted rounded-full overflow-hidden">
                {/* Required level (background) */}
                <div
                  className="absolute inset-y-0 left-0 bg-accent/20 rounded-full"
                  style={{ width: `${Math.min(skill.required, 100)}%` }}
                />
                {/* Current level (foreground) */}
                <div
                  className="absolute inset-y-0 left-0 bg-indigo-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(skill.current, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-text-muted">
                <span>Current: {skill.current}</span>
                <span>Required: {skill.required}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-text-muted pt-1 border-t border-border">
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-sm bg-indigo-500" />
          <span>Current</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-sm bg-accent/20" />
          <span>Required</span>
        </div>
      </div>
    </div>
  );
}

// ─── 3. Job Suggestion Card ─────────────────────────────────────────

function JobSuggestionCard({ data }: { data: JobSuggestionData }) {
  const matchColor =
    (data.matchScore ?? 0) >= 80
      ? 'bg-success/10 text-success'
      : (data.matchScore ?? 0) >= 60
        ? 'bg-warning/10 text-warning'
        : 'bg-surface-muted text-text-muted';

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Briefcase className="w-4 h-4 text-blue-500" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{data.title}</p>
            <p className="text-xs text-text-secondary">{data.company}</p>
          </div>
        </div>
        {data.matchScore != null && (
          <span className={`badge ${matchColor} flex-shrink-0`}>
            {data.matchScore}% match
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
        {data.location && (
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {data.location}
          </span>
        )}
        {data.salary && (
          <span className="flex items-center gap-1">
            <DollarSign className="w-3 h-3" />
            {data.salary}
          </span>
        )}
      </div>

      {data.skills && data.skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.skills.map((skill, i) => (
            <span key={i} className="tag text-[10px] py-1 px-2 rounded-lg">
              {skill}
            </span>
          ))}
        </div>
      )}

      {data.url && (
        <a
          href={data.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            if (window.electronAPI?.openExternal) {
              e.preventDefault();
              void window.electronAPI.openExternal(data.url!);
            }
          }}
          className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover"
        >
          View listing <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

// ─── 4. Career Path Card ─────────────────────────────────────────────

function CareerPathCard({ data }: { data: CareerPathData }) {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <ArrowRight className="w-4 h-4 text-purple-500" />
          </div>
          <div>
            <span className="text-sm font-semibold text-text-primary">Career Path</span>
            {data.from && data.to && (
              <p className="text-xs text-text-muted">
                {data.from} → {data.to}
              </p>
            )}
          </div>
        </div>
        {data.duration && (
          <span className="badge badge-idle">{data.duration}</span>
        )}
      </div>

      {/* Timeline */}
      <div className="space-y-0">
        {data.steps.map((step, i) => {
          const isLast = i === data.steps.length - 1;
          const statusColors = {
            completed: { dot: 'bg-success', line: 'bg-success', text: 'text-text-muted' },
            current: { dot: 'bg-accent', line: 'bg-border', text: 'text-text-primary font-medium' },
            upcoming: { dot: 'bg-border', line: 'bg-border', text: 'text-text-muted' },
          };
          const colors = statusColors[step.status || 'upcoming'];

          return (
            <div key={i} className="flex gap-3">
              {/* Timeline line + dot */}
              <div className="flex flex-col items-center">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${colors.dot}`} />
                {!isLast && <div className={`w-0.5 flex-1 min-h-[20px] ${colors.line}`} />}
              </div>
              {/* Step content */}
              <div className="pb-3 min-w-0">
                <p className={`text-xs ${colors.text}`}>{step.title}</p>
                {step.duration && (
                  <p className="text-[10px] text-text-muted mt-0.5">{step.duration}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 5. Weekly Reflection Card ───────────────────────────────────────

function WeeklyReflectionCard({ data }: { data: WeeklyReflectionData }) {
  const sections = [
    { icon: Trophy, label: 'Wins', items: data.wins, color: 'text-success', bg: 'bg-success/10' },
    { icon: AlertCircle, label: 'Challenges', items: data.challenges, color: 'text-warning', bg: 'bg-warning/10' },
    { icon: Lightbulb, label: 'Lessons', items: data.lessons, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  ];

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
          <BookOpen className="w-4 h-4 text-emerald-500" />
        </div>
        <div>
          <span className="text-sm font-semibold text-text-primary">Weekly Reflection</span>
          {data.weekOf && (
            <p className="text-xs text-text-muted">{data.weekOf}</p>
          )}
        </div>
      </div>

      {sections.map(
        (section) =>
          section.items &&
          section.items.length > 0 && (
            <div key={section.label} className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <div className={`w-5 h-5 rounded flex items-center justify-center ${section.bg}`}>
                  <section.icon className={`w-3 h-3 ${section.color}`} />
                </div>
                <span className="text-xs font-medium text-text-primary">{section.label}</span>
              </div>
              <ul className="space-y-1 pl-6">
                {section.items.map((item, i) => (
                  <li key={i} className="text-xs text-text-secondary list-disc">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}

      {data.nextFocus && (
        <div className="pt-2 border-t border-border">
          <div className="flex items-start gap-2">
            <ArrowRight className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-xs font-medium text-text-primary">Next Focus</span>
              <p className="text-xs text-text-secondary mt-0.5">{data.nextFocus}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 6. Habit Tracker Card ───────────────────────────────────────────

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function HabitTrackerCard({ data }: { data: HabitTrackerData }) {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-rose-500/10 flex items-center justify-center">
          <Flame className="w-4 h-4 text-rose-500" />
        </div>
        <span className="text-sm font-semibold text-text-primary">Habit Tracker</span>
      </div>

      <div className="space-y-3">
        {data.habits.map((habit, i) => {
          const completed = habit.days.filter(Boolean).length;
          return (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text-primary truncate">{habit.name}</p>
                  {(habit.time || habit.duration) && (
                    <p className="text-[10px] text-text-muted">
                      {[habit.time, habit.duration].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <span className="text-[10px] text-text-muted flex-shrink-0">
                  {completed}/7
                </span>
              </div>
              {/* Day dots */}
              <div className="flex items-center gap-1.5">
                {habit.days.map((done, d) => (
                  <div key={d} className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] text-text-muted">{DAY_LABELS[d]}</span>
                    <div
                      className={`w-4 h-4 rounded-full ${
                        done
                          ? 'bg-success'
                          : 'bg-surface-muted border border-border'
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 7. Learning Resource Card ───────────────────────────────────────

function LearningResourceCard({ data }: { data: LearningResourceData }) {
  return (
    <div className="card p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <BookOpen className="w-4 h-4 text-cyan-500" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">{data.title}</p>
            <p className="text-xs text-text-secondary">{data.provider}</p>
          </div>
        </div>
        {data.rating && (
          <span className="flex items-center gap-0.5 text-xs text-warning flex-shrink-0">
            <Star className="w-3 h-3 fill-current" />
            {data.rating}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
        {data.duration && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {data.duration}
          </span>
        )}
        {data.level && (
          <span className="badge badge-idle">{data.level}</span>
        )}
      </div>

      {data.skills && data.skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.skills.map((skill, i) => (
            <span key={i} className="tag text-[10px] py-1 px-2 rounded-lg">
              {skill}
            </span>
          ))}
        </div>
      )}

      {data.url && (
        <a
          href={data.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            if (window.electronAPI?.openExternal) {
              e.preventDefault();
              void window.electronAPI.openExternal(data.url!);
            }
          }}
          className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover"
        >
          View course <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

// ─── 8. Market Insight Card ──────────────────────────────────────────

function MarketInsightCard({ data }: { data: MarketInsightData }) {
  const trendIcon = {
    up: TrendingUp,
    down: TrendingDown,
    stable: Minus,
  }[data.trend] || Minus;
  const TrendIcon = trendIcon;

  const trendColor = {
    up: 'text-success bg-success/10',
    down: 'text-error bg-error/10',
    stable: 'text-text-muted bg-surface-muted',
  }[data.trend] || 'text-text-muted bg-surface-muted';

  return (
    <div className="card p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-amber-500" />
          </div>
          <span className="text-sm font-semibold text-text-primary">{data.metric}</span>
        </div>
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${trendColor}`}>
          <TrendIcon className="w-3 h-3" />
          {data.change || data.trend}
        </div>
      </div>

      <p className="text-lg font-bold text-text-primary">{data.value}</p>

      {data.context && (
        <p className="text-xs text-text-secondary leading-relaxed">{data.context}</p>
      )}
    </div>
  );
}

// ─── Export helper for ContextPanel ──────────────────────────────────
// Extracts career card data from message text for the context panel summary

export function extractCareerCardsFromText(text: string): Array<{ type: string; data: unknown }> {
  const cards: Array<{ type: string; data: unknown }> = [];
  CARD_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CARD_REGEX.exec(text)) !== null) {
    try {
      const data = JSON.parse(match[2]);
      cards.push({ type: match[1], data });
    } catch {
      // Skip invalid JSON
    }
  }
  return cards;
}
