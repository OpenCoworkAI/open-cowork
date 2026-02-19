// Career card data types — used by CareerCards.tsx to render structured career data
// emitted by the AI agent as ```json:card-type blocks

export interface GoalProgressData {
  title: string;
  progress: number; // 0–100
  targetDate?: string;
  status?: string;
  milestones?: Array<{ title: string; completed: boolean }>;
}

export interface SkillGapData {
  role?: string;
  skills: Array<{ name: string; current: number; required: number }>;
}

export interface JobSuggestionData {
  title: string;
  company: string;
  location?: string;
  matchScore?: number; // 0–100
  salary?: string;
  skills?: string[];
  url?: string;
}

export interface CareerPathData {
  from?: string;
  to?: string;
  duration?: string;
  steps: Array<{
    title: string;
    duration?: string;
    status?: 'completed' | 'current' | 'upcoming';
  }>;
}

export interface WeeklyReflectionData {
  weekOf?: string;
  wins?: string[];
  challenges?: string[];
  lessons?: string[];
  nextFocus?: string;
}

export interface HabitTrackerData {
  habits: Array<{
    name: string;
    time?: string;
    duration?: string;
    days: boolean[]; // 7 booleans for Mon–Sun
  }>;
}

export interface LearningResourceData {
  title: string;
  provider: string;
  duration?: string;
  level?: string;
  skills?: string[];
  url?: string;
  rating?: number;
}

export interface MarketInsightData {
  metric: string;
  value: string;
  trend: 'up' | 'down' | 'stable';
  change?: string;
  context?: string;
}

export type CareerCardType =
  | 'goal-progress'
  | 'skill-gap'
  | 'job-suggestion'
  | 'career-path'
  | 'weekly-reflection'
  | 'habit-tracker'
  | 'learning-resource'
  | 'market-insight';
