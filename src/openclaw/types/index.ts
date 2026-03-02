/**
 * OpenClaw Type Definitions
 */

export interface OpenClawConfig {
  /** Run standalone (own server) or embedded in Coeadapt */
  standalone: boolean;

  /** Coeadapt platform API base URL */
  apiBase: string;

  /** Device/user token for platform authentication */
  platformToken?: string;

  /** Path to the co-working environment workspace */
  workspacePath: string;

  /** Skills to load on initialization */
  enabledSkills: string[];
}

export interface OpenClawSession {
  id: string;
  userId: string;
  startedAt: number;
  mode: 'standalone' | 'embedded';
  activeSkills: string[];
}

export interface AgentCapability {
  /** Unique skill identifier */
  skillId: string;

  /** Human-readable name */
  name: string;

  /** What intents this capability handles */
  intents: string[];

  /** Check if this capability handles the given intent */
  handles(intent: string): boolean;

  /** Execute the capability against a user message */
  execute(message: string, session: OpenClawSession): Promise<string>;
}

// ─── Career Development Types ─────────────────────────────────────────────────

export interface CareerProfile {
  userId: string;
  currentRole?: string;
  targetRole?: string;
  skills: SkillEntry[];
  experience: ExperienceEntry[];
  goals: CareerGoal[];
  stage: CareerStage;
}

export type CareerStage =
  | 'exploring'
  | 'learning'
  | 'building'
  | 'applying'
  | 'interviewing'
  | 'negotiating'
  | 'onboarding'
  | 'growing';

export interface SkillEntry {
  name: string;
  level: number;       // 0-100
  verified: boolean;
  lastAssessed?: number;
}

export interface ExperienceEntry {
  title: string;
  company: string;
  startDate: string;
  endDate?: string;
  highlights: string[];
}

export interface CareerGoal {
  id: string;
  title: string;
  description?: string;
  targetDate?: string;
  progress: number;    // 0-100
  status: 'active' | 'completed' | 'paused' | 'abandoned';
  milestones: Milestone[];
}

export interface Milestone {
  title: string;
  completed: boolean;
  completedAt?: number;
}

// ─── Platform Connection Types ────────────────────────────────────────────────

export interface PlatformConnection {
  status: 'connected' | 'disconnected' | 'error';
  lastSync?: number;
  userId?: string;
  capabilities: PlatformCapability[];
}

export type PlatformCapability =
  | 'plans'
  | 'tasks'
  | 'goals'
  | 'habits'
  | 'jobs'
  | 'skills'
  | 'portfolio'
  | 'market-intel'
  | 'notifications';

// ─── Co-Working Environment Types ─────────────────────────────────────────────

export interface CoWorkEnvironment {
  /** Root workspace path */
  workspacePath: string;

  /** Active workspace sections */
  sections: WorkspaceSection[];

  /** Shared artifacts between agent and user */
  artifacts: Artifact[];
}

export interface WorkspaceSection {
  id: string;
  name: string;
  type: 'documents' | 'drafts' | 'portfolio' | 'research' | 'scratch';
  path: string;
}

export interface Artifact {
  id: string;
  name: string;
  type: ArtifactType;
  path: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export type ArtifactType =
  | 'resume'
  | 'cover-letter'
  | 'portfolio-piece'
  | 'interview-prep'
  | 'career-plan'
  | 'skill-assessment'
  | 'market-report'
  | 'reflection'
  | 'notes'
  | 'skill-tree';

// ─── Skillception Types ──────────────────────────────────────────────────────
// "Skills for building skills" — a directed graph where skills unlock skills.

/** A single node in the skill tree. */
export interface SkillNode {
  id: string;
  name: string;
  description: string;

  /** Skill category for grouping in the UI */
  category: SkillCategory;

  /** Current proficiency: 0 = not started, 100 = mastered */
  level: number;

  /** IDs of skills that must reach their threshold before this one unlocks */
  prerequisites: Prerequisite[];

  /** Evidence of skill acquisition — completed tasks, projects, certs */
  evidence: SkillEvidence[];

  /** Whether this skill is verified (by platform, cert, or peer review) */
  verified: boolean;

  /** Skills this node unlocks once its own threshold is met */
  unlocks: string[];

  /** Minimum level required to count as "met" when this is a prerequisite */
  threshold: number;

  /** Suggested activities to build this skill */
  activities: SkillActivity[];

  /** Timestamps */
  createdAt: number;
  updatedAt: number;
}

/** Edge in the prerequisite graph */
export interface Prerequisite {
  skillId: string;
  /** Minimum level the prerequisite must reach */
  minLevel: number;
}

/** Proof of learning */
export interface SkillEvidence {
  id: string;
  type: 'task-completion' | 'project' | 'certification' | 'peer-review' | 'self-assessment' | 'artifact';
  title: string;
  description?: string;
  url?: string;
  /** Points contributed toward skill level */
  points: number;
  verifiedBy?: string;
  createdAt: number;
}

/** Concrete activity that builds a skill */
export interface SkillActivity {
  id: string;
  title: string;
  type: 'learn' | 'practice' | 'build' | 'teach' | 'assess';
  /** Estimated time in minutes */
  estimatedMinutes: number;
  /** Points earned upon completion */
  points: number;
  /** External resource URL */
  url?: string;
  completed: boolean;
  completedAt?: number;
}

export type SkillCategory =
  | 'technical'
  | 'communication'
  | 'leadership'
  | 'problem-solving'
  | 'domain'
  | 'meta'          // skills about learning/growing
  | 'execution'     // getting things done
  | 'collaboration';

/** The full skill tree for a user — a graph of SkillNodes */
export interface SkillTree {
  userId: string;
  nodes: SkillNode[];
  /** Snapshot metadata */
  lastSynced?: number;
  version: number;
}

/** Computed view of a user's readiness for a target role */
export interface SkillReadiness {
  targetRole: string;
  overallScore: number;
  ready: SkillNode[];
  inProgress: SkillNode[];
  blocked: Array<SkillNode & { blockedBy: Prerequisite[] }>;
  suggested: SkillActivity[];
}
