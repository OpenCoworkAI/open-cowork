/**
 * OpenClaw Platform Connect Skill
 *
 * Bridges OpenClaw to the Coeadapt career platform API.
 * Handles authentication, data sync, and bidirectional updates
 * so the agent always has fresh career context.
 */

import type {
  AgentCapability,
  OpenClawSession,
  PlatformConnection,
  PlatformCapability,
  CareerProfile,
  CareerGoal,
} from '../../types';

const PLATFORM_INTENTS = [
  'sync',
  'check-plans',
  'check-tasks',
  'check-goals',
  'check-habits',
  'check-jobs',
  'check-skills',
  'check-portfolio',
  'check-market',
  'check-notifications',
  'platform-status',
];

export class PlatformConnectSkill implements AgentCapability {
  skillId = 'openclaw-platform-connect';
  name = 'Platform Connect';
  intents = PLATFORM_INTENTS;

  private connection: PlatformConnection = {
    status: 'disconnected',
    capabilities: [],
  };

  private apiBase: string;
  private token: string;
  private cache: Map<string, { data: unknown; fetchedAt: number }> = new Map();
  private readonly CACHE_TTL = 15 * 60 * 1000; // 15 minutes

  constructor(apiBase: string, token: string) {
    this.apiBase = apiBase;
    this.token = token;
  }

  handles(intent: string): boolean {
    return this.intents.includes(intent);
  }

  async execute(message: string, session: OpenClawSession): Promise<string> {
    // Ensure connected before executing platform operations
    if (this.connection.status !== 'connected') {
      await this.connect();
    }
    return '';
  }

  // ─── Connection Lifecycle ─────────────────────────────────────────────────

  async connect(): Promise<PlatformConnection> {
    if (!this.token) {
      this.connection = {
        status: 'error',
        capabilities: [],
      };
      return this.connection;
    }

    try {
      // Verify token and discover available capabilities
      const profile = await this.apiRequest('GET', '/api/me');

      this.connection = {
        status: 'connected',
        lastSync: Date.now(),
        userId: (profile as { id: string }).id,
        capabilities: [
          'plans', 'tasks', 'goals', 'habits',
          'jobs', 'skills', 'portfolio', 'market-intel', 'notifications',
        ],
      };
    } catch {
      this.connection = {
        status: 'error',
        capabilities: [],
      };
    }

    return this.connection;
  }

  disconnect(): void {
    this.connection = { status: 'disconnected', capabilities: [] };
    this.cache.clear();
  }

  getStatus(): PlatformConnection {
    return { ...this.connection };
  }

  // ─── Data Access ──────────────────────────────────────────────────────────

  async getPlans(): Promise<unknown> {
    return this.cachedRequest('plans', 'GET', '/api/plans/me');
  }

  async getTasks(planId?: string): Promise<unknown> {
    const path = planId ? `/api/plans/${planId}/tasks` : '/api/tasks/me';
    return this.cachedRequest(`tasks-${planId || 'all'}`, 'GET', path);
  }

  async getGoals(): Promise<unknown> {
    return this.cachedRequest('goals', 'GET', '/api/goals/me');
  }

  async getHabitsToday(): Promise<unknown> {
    return this.cachedRequest('habits-today', 'GET', '/api/habits/today');
  }

  async getHabitStats(): Promise<unknown> {
    return this.cachedRequest('habit-stats', 'GET', '/api/habits/stats/overview');
  }

  async discoverJobs(): Promise<unknown> {
    return this.cachedRequest('jobs-discover', 'GET', '/api/jobs/discover');
  }

  async getBookmarkedJobs(): Promise<unknown> {
    return this.cachedRequest('jobs-bookmarks', 'GET', '/api/jobs/bookmarks/me');
  }

  async getVerifiedSkills(): Promise<unknown> {
    return this.cachedRequest('skills', 'GET', '/api/skills/verified');
  }

  async getPortfolio(): Promise<unknown> {
    return this.cachedRequest('portfolio', 'GET', '/api/portfolio/items');
  }

  async getMarketFit(): Promise<unknown> {
    return this.cachedRequest('market-fit', 'GET', '/api/radar/market-fit');
  }

  async getSkillDeltas(): Promise<unknown> {
    return this.cachedRequest('skill-deltas', 'GET', '/api/radar/skill-deltas');
  }

  async getNotifications(): Promise<unknown> {
    return this.cachedRequest('notifications', 'GET', '/api/notifications/me');
  }

  // ─── Write Operations (never cached) ──────────────────────────────────────

  async updateTask(taskId: string, updates: Record<string, unknown>): Promise<unknown> {
    this.invalidateCache('tasks');
    return this.apiRequest('PUT', `/api/tasks/${taskId}`, updates);
  }

  async submitEvidence(taskId: string, evidence: { type: string; content: string; url?: string }): Promise<unknown> {
    return this.apiRequest('POST', `/api/tasks/${taskId}/evidence`, evidence);
  }

  async createGoal(goal: Partial<CareerGoal>): Promise<unknown> {
    this.invalidateCache('goals');
    return this.apiRequest('POST', '/api/goals', goal);
  }

  async updateGoal(goalId: string, updates: Record<string, unknown>): Promise<unknown> {
    this.invalidateCache('goals');
    return this.apiRequest('PATCH', `/api/goals/${goalId}`, updates);
  }

  async completeHabit(habitId: string): Promise<unknown> {
    this.invalidateCache('habits-today');
    this.invalidateCache('habit-stats');
    return this.apiRequest('POST', `/api/habits/${habitId}/complete`);
  }

  async bookmarkJob(jobId: string): Promise<unknown> {
    this.invalidateCache('jobs-bookmarks');
    return this.apiRequest('POST', `/api/jobs/${jobId}/bookmark`);
  }

  // ─── Bulk Sync ────────────────────────────────────────────────────────────

  /**
   * Pull fresh data for a session start.
   * Returns a snapshot of the user's current career context.
   */
  async syncForSession(): Promise<{
    profile: unknown;
    plans: unknown;
    habits: unknown;
    goals: unknown;
    notifications: unknown;
  }> {
    const [profile, plans, habits, goals, notifications] = await Promise.all([
      this.apiRequest('GET', '/api/me'),
      this.getPlans(),
      this.getHabitsToday(),
      this.getGoals(),
      this.getNotifications(),
    ]);

    return { profile, plans, habits, goals, notifications };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async cachedRequest(key: string, method: string, path: string): Promise<unknown> {
    const cached = this.cache.get(key);
    if (cached && (Date.now() - cached.fetchedAt) < this.CACHE_TTL) {
      return cached.data;
    }

    const data = await this.apiRequest(method, path);
    this.cache.set(key, { data, fetchedAt: Date.now() });
    return data;
  }

  private invalidateCache(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  private async apiRequest(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.apiBase}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Platform API ${res.status}: ${text}`);
    }

    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }
}

export default PlatformConnectSkill;
