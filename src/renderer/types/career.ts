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

// ─── Skillception Card Types ─────────────────────────────────────────────────

export interface SkillTreeData {
  title: string;
  nodes: Array<{
    id: string;
    name: string;
    level: number; // 0–100
    category: string;
    status: 'locked' | 'aware' | 'beginner' | 'practitioner' | 'proficient' | 'advanced' | 'master';
    prerequisites?: string[];
    unlocks?: string[];
    blockedBy?: string;
  }>;
  unlocksSoon?: string[];
  suggestion?: string;
}

export interface SkillUnlockData {
  skill: string;
  unlockedBy: string;
  nowAvailable?: string[];
  suggestedFirstStep?: string;
}

export interface SkillProgressData {
  skill: string;
  level: number;
  threshold?: number;
  pointsToUnlock?: number;
  evidence?: Array<{ title: string; type: string; points: number }>;
  nextActivities?: Array<{ title: string; type: string; points: number; minutes: number }>;
}

export interface SkillReadinessData {
  targetRole: string;
  score: number; // 0–100
  ready?: string[];
  inProgress?: string[];
  blocked?: Array<{ skill: string; blockedBy: string }>;
  topPriority?: string;
}

// ─── Action Steps Card Type ──────────────────────────────────────────────────

export interface ActionStepsCardData {
  title: string;
  environment?: 'real-machine' | 'vm';
  steps: Array<{
    number: number;
    instruction: string;
    details?: string;
    keyboardShortcut?: string;
  }>;
  donePrompt?: string;
}

// ─── VM Cowork Desktop Card Types ───────────────────────────────────────────

export interface VMStatusCardData {
  vmId: string;
  vmName: string;
  state: string;
  os?: string;
  cpuCount?: number;
  memoryMb?: number;
  ipAddress?: string;
  computerUseEnabled?: boolean;
}

export interface VMProvisionCardData {
  suggestedOs?: string;
  reason?: string;
  suggestedResources?: { cpuCount: number; memoryMb: number; diskSizeGb: number };
}

export interface VMSuggestionCardData {
  reason: string;
  taskDescription: string;
  suggestedOs?: string;
  existingVmId?: string;
  existingVmName?: string;
}

export type CareerCardType =
  | 'goal-progress'
  | 'skill-gap'
  | 'job-suggestion'
  | 'career-path'
  | 'weekly-reflection'
  | 'habit-tracker'
  | 'learning-resource'
  | 'market-insight'
  | 'skill-tree'
  | 'skill-unlock'
  | 'skill-progress'
  | 'skill-readiness'
  | 'action-steps'
  | 'vm-status'
  | 'vm-provision'
  | 'vm-suggestion';
