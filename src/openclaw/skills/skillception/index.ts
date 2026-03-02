/**
 * Skillception — Skills for Building Skills
 *
 * The core skill engine for Navi. Manages a directed acyclic graph (DAG)
 * of skills where mastering one skill unlocks the next. Integrates with
 * the Coeadapt platform for tracking, evidence submission, and reporting.
 *
 * Key concepts:
 *   - SkillNode: A single skill with level, prerequisites, and evidence
 *   - SkillTree: The full DAG for a user
 *   - Prerequisite: An edge requiring a skill to reach a threshold
 *   - SkillActivity: A concrete action that builds a skill
 *   - Evidence: Proof that a skill was applied
 */

import type {
  AgentCapability,
  OpenClawSession,
  SkillNode,
  SkillTree,
  SkillEvidence,
  SkillActivity,
  SkillCategory,
  SkillReadiness,
  Prerequisite,
} from '../../types';

// ─── Intents ─────────────────────────────────────────────────────────────────

const SKILLCEPTION_INTENTS = [
  'skill-tree',
  'skill-status',
  'skill-unlock',
  'skill-progress',
  'skill-readiness',
  'learn-skill',
  'build-skill',
  'add-evidence',
  'what-next',
  'skill-path',
  'skill-decay',
];

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 60;
const DECAY_DAYS = 90;
const MS_PER_DAY = 86_400_000;

// ─── Skill Engine ────────────────────────────────────────────────────────────

export class SkillceptionSkill implements AgentCapability {
  skillId = 'navi-skillception';
  name = 'Skillception';
  intents = SKILLCEPTION_INTENTS;

  private tree: SkillTree | null = null;

  handles(intent: string): boolean {
    return this.intents.includes(intent);
  }

  async execute(_message: string, session: OpenClawSession): Promise<string> {
    if (!this.tree) {
      this.tree = await this.loadTree(session.userId);
    }
    // Agent pipeline handles message routing; this is the execution hook
    return '';
  }

  // ─── Tree Management ─────────────────────────────────────────────────────

  /** Load or initialize a user's skill tree. */
  async loadTree(userId: string): Promise<SkillTree> {
    // In production, loaded from platform API or local store
    return this.tree ?? { userId, nodes: [], version: 1 };
  }

  /** Add a new skill node to the tree. */
  addSkill(
    name: string,
    category: SkillCategory,
    description: string,
    prerequisites: Prerequisite[] = [],
    threshold: number = DEFAULT_THRESHOLD,
  ): SkillNode {
    if (!this.tree) throw new Error('Tree not loaded');

    const node: SkillNode = {
      id: this.slugify(name),
      name,
      description,
      category,
      level: 0,
      prerequisites,
      evidence: [],
      verified: false,
      unlocks: [],
      threshold,
      activities: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Wire up reverse edges: each prerequisite's "unlocks" list
    for (const prereq of prerequisites) {
      const parent = this.tree.nodes.find(n => n.id === prereq.skillId);
      if (parent && !parent.unlocks.includes(node.id)) {
        parent.unlocks.push(node.id);
      }
    }

    this.tree.nodes.push(node);
    this.tree.version++;
    return node;
  }

  /** Remove a skill and clean up edges. */
  removeSkill(skillId: string): void {
    if (!this.tree) throw new Error('Tree not loaded');

    this.tree.nodes = this.tree.nodes.filter(n => n.id !== skillId);

    // Clean up references
    for (const node of this.tree.nodes) {
      node.prerequisites = node.prerequisites.filter(p => p.skillId !== skillId);
      node.unlocks = node.unlocks.filter(id => id !== skillId);
    }

    this.tree.version++;
  }

  // ─── Prerequisite Graph ──────────────────────────────────────────────────

  /** Check if a skill is unlocked (all prerequisites met). */
  isUnlocked(skillId: string): boolean {
    if (!this.tree) return false;
    const node = this.tree.nodes.find(n => n.id === skillId);
    if (!node) return false;
    if (node.prerequisites.length === 0) return true;

    return node.prerequisites.every(prereq => {
      const parent = this.tree!.nodes.find(n => n.id === prereq.skillId);
      return parent !== undefined && parent.level >= prereq.minLevel;
    });
  }

  /** Get skills blocked by unmet prerequisites. */
  getBlocked(): Array<SkillNode & { blockedBy: Prerequisite[] }> {
    if (!this.tree) return [];

    return this.tree.nodes
      .filter(node => !this.isUnlocked(node.id) && node.level === 0)
      .map(node => {
        const blockedBy = node.prerequisites.filter(prereq => {
          const parent = this.tree!.nodes.find(n => n.id === prereq.skillId);
          return !parent || parent.level < prereq.minLevel;
        });
        return { ...node, blockedBy };
      });
  }

  /** Get skills that are close to being unlocked (prerequisites nearly met). */
  getAlmostUnlocked(threshold = 10): SkillNode[] {
    if (!this.tree) return [];

    return this.tree.nodes.filter(node => {
      if (this.isUnlocked(node.id)) return false;
      if (node.prerequisites.length === 0) return false;

      // Check if all prerequisites are within `threshold` points of being met
      return node.prerequisites.every(prereq => {
        const parent = this.tree!.nodes.find(n => n.id === prereq.skillId);
        if (!parent) return false;
        return parent.level >= prereq.minLevel - threshold;
      });
    });
  }

  /** Find the highest-impact foundational skills (most unlocks downstream). */
  getHighImpactRoots(limit = 5): Array<{ node: SkillNode; downstream: number }> {
    if (!this.tree) return [];

    const downstream = new Map<string, number>();

    for (const node of this.tree.nodes) {
      downstream.set(node.id, this.countDownstream(node.id, new Set()));
    }

    return this.tree.nodes
      .filter(n => n.level < n.threshold)
      .map(node => ({ node, downstream: downstream.get(node.id) ?? 0 }))
      .sort((a, b) => b.downstream - a.downstream)
      .slice(0, limit);
  }

  /** Count all skills reachable downstream from a node. */
  private countDownstream(nodeId: string, visited: Set<string>): number {
    if (visited.has(nodeId)) return 0;
    visited.add(nodeId);

    const node = this.tree?.nodes.find(n => n.id === nodeId);
    if (!node) return 0;

    let count = 0;
    for (const childId of node.unlocks) {
      count += 1 + this.countDownstream(childId, visited);
    }
    return count;
  }

  // ─── Progress & Evidence ─────────────────────────────────────────────────

  /** Record evidence for a skill and update its level. */
  addEvidence(skillId: string, evidence: Omit<SkillEvidence, 'id' | 'createdAt'>): SkillNode | null {
    if (!this.tree) return null;
    const node = this.tree.nodes.find(n => n.id === skillId);
    if (!node) return null;

    const entry: SkillEvidence = {
      ...evidence,
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    };

    node.evidence.push(entry);
    node.level = Math.min(100, node.level + entry.points);
    node.updatedAt = Date.now();

    if (entry.verifiedBy) {
      node.verified = true;
    }

    this.tree.version++;
    return node;
  }

  /** Complete an activity for a skill. */
  completeActivity(skillId: string, activityId: string): SkillNode | null {
    if (!this.tree) return null;
    const node = this.tree.nodes.find(n => n.id === skillId);
    if (!node) return null;

    const activity = node.activities.find(a => a.id === activityId);
    if (!activity || activity.completed) return node;

    activity.completed = true;
    activity.completedAt = Date.now();

    // Activity completion counts as evidence
    this.addEvidence(skillId, {
      type: 'task-completion',
      title: activity.title,
      points: activity.points,
    });

    return node;
  }

  /** Add activities to a skill. */
  addActivities(skillId: string, activities: Omit<SkillActivity, 'id' | 'completed' | 'completedAt'>[]): SkillNode | null {
    if (!this.tree) return null;
    const node = this.tree.nodes.find(n => n.id === skillId);
    if (!node) return null;

    for (const act of activities) {
      node.activities.push({
        ...act,
        id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        completed: false,
      });
    }

    node.updatedAt = Date.now();
    this.tree.version++;
    return node;
  }

  // ─── Unlock Detection ────────────────────────────────────────────────────

  /** Check which new skills became unlocked after a level change. Returns newly unlocked node IDs. */
  checkUnlocks(skillId: string): string[] {
    if (!this.tree) return [];
    const node = this.tree.nodes.find(n => n.id === skillId);
    if (!node) return [];

    const newlyUnlocked: string[] = [];

    for (const childId of node.unlocks) {
      const child = this.tree.nodes.find(n => n.id === childId);
      if (!child) continue;

      // Check if ALL prerequisites are now met (not just this one)
      const allMet = child.prerequisites.every(prereq => {
        const parent = this.tree!.nodes.find(n => n.id === prereq.skillId);
        return parent !== undefined && parent.level >= prereq.minLevel;
      });

      if (allMet && child.level === 0) {
        newlyUnlocked.push(childId);
      }
    }

    return newlyUnlocked;
  }

  // ─── Readiness Assessment ────────────────────────────────────────────────

  /** Compute how ready the user is for a target role given required skills. */
  assessReadiness(
    targetRole: string,
    requiredSkillIds: string[],
  ): SkillReadiness {
    if (!this.tree) {
      return { targetRole, overallScore: 0, ready: [], inProgress: [], blocked: [], suggested: [] };
    }

    const ready: SkillNode[] = [];
    const inProgress: SkillNode[] = [];
    const blocked: Array<SkillNode & { blockedBy: Prerequisite[] }> = [];

    for (const skillId of requiredSkillIds) {
      const node = this.tree.nodes.find(n => n.id === skillId);
      if (!node) continue;

      if (node.level >= node.threshold) {
        ready.push(node);
      } else if (this.isUnlocked(skillId) && node.level > 0) {
        inProgress.push(node);
      } else {
        const blockedBy = node.prerequisites.filter(prereq => {
          const parent = this.tree!.nodes.find(n => n.id === prereq.skillId);
          return !parent || parent.level < prereq.minLevel;
        });
        blocked.push({ ...node, blockedBy });
      }
    }

    const total = requiredSkillIds.length || 1;
    const overallScore = Math.round((ready.length / total) * 100);

    // Suggest activities from in-progress skills
    const suggested = inProgress
      .flatMap(n => n.activities.filter(a => !a.completed))
      .sort((a, b) => b.points - a.points)
      .slice(0, 5);

    return { targetRole, overallScore, ready, inProgress, blocked, suggested };
  }

  // ─── Decay ───────────────────────────────────────────────────────────────

  /** Flag skills that haven't had evidence or activity in DECAY_DAYS. */
  getDecayingSkills(): SkillNode[] {
    if (!this.tree) return [];
    const cutoff = Date.now() - (DECAY_DAYS * MS_PER_DAY);

    return this.tree.nodes.filter(node => {
      if (node.level === 0) return false;
      const lastActivity = Math.max(
        node.updatedAt,
        ...node.evidence.map(e => e.createdAt),
        ...node.activities.filter(a => a.completedAt).map(a => a.completedAt!),
      );
      return lastActivity < cutoff;
    });
  }

  // ─── Snapshot for Coeadapt Reporting ─────────────────────────────────────

  /** Generate a summary for the platform sync. */
  getSyncPayload(): {
    skills: Array<{ name: string; level: number; verified: boolean; category: string }>;
    recentEvidence: SkillEvidence[];
    completedActivities: Array<{ skillId: string; activity: SkillActivity }>;
  } {
    if (!this.tree) return { skills: [], recentEvidence: [], completedActivities: [] };

    const oneDayAgo = Date.now() - MS_PER_DAY;

    const skills = this.tree.nodes.map(n => ({
      name: n.name,
      level: n.level,
      verified: n.verified,
      category: n.category,
    }));

    const recentEvidence = this.tree.nodes
      .flatMap(n => n.evidence)
      .filter(e => e.createdAt > oneDayAgo);

    const completedActivities = this.tree.nodes.flatMap(n =>
      n.activities
        .filter(a => a.completed && a.completedAt && a.completedAt > oneDayAgo)
        .map(activity => ({ skillId: n.id, activity })),
    );

    return { skills, recentEvidence, completedActivities };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}

export default SkillceptionSkill;
