/**
 * Coeadapt API Client
 *
 * Typed REST + SSE client for https://api.coeadapt.com
 * Auth: Clerk JWT (primary) or Device Token (fallback)
 */

// ─── Error class ────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body?: unknown,
  ) {
    super(`API ${status}: ${statusText}`);
    this.name = 'ApiError';
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CoeadaptUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
  subscriptionTier?: string;
}

export interface CareerPlan {
  id: string;
  title: string;
  description?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CareerTask {
  id: string;
  planId?: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  dueDate?: string;
  completedAt?: string;
  evidence?: TaskEvidence[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvidence {
  id: string;
  taskId: string;
  type: string;
  content: string;
  url?: string;
  createdAt: string;
}

export interface Goal {
  id: string;
  title: string;
  description?: string;
  targetDate?: string;
  progress: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Habit {
  id: string;
  name: string;
  description?: string;
  frequency: string;
  streak: number;
  completedToday: boolean;
  createdAt: string;
}

export interface HabitStats {
  totalHabits: number;
  completedToday: number;
  longestStreak: number;
  averageCompletion: number;
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location?: string;
  salary?: string;
  description?: string;
  url?: string;
  matchScore?: number;
  skills?: string[];
  source?: string;
  createdAt: string;
}

export interface BookmarkedJob extends Job {
  bookmarkedAt: string;
  notes?: string;
}

export interface PortfolioItem {
  id: string;
  title: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  skills: string[];
  createdAt: string;
}

export interface VerifiedSkill {
  id: string;
  name: string;
  level: string;
  verifiedAt: string;
  source?: string;
}

export interface MarketFit {
  score: number;
  strengths: string[];
  gaps: string[];
  recommendations: string[];
}

export interface SkillDelta {
  skill: string;
  current: number;
  required: number;
  gap: number;
}

export interface SubscriptionStatus {
  plan: string;
  status: string;
  features: string[];
  expiresAt?: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface DeviceTokenResult {
  token: string;
  expiresAt: string;
}

export interface DeviceTokenVerification {
  valid: boolean;
  userId?: string;
  expiresAt?: string;
}

export interface CoraChatMessage {
  type: 'content' | 'error' | 'done';
  content?: string;
  error?: string;
}

// ─── API Client ─────────────────────────────────────────────────────────────

type TokenProvider = () => Promise<string | null>;

export class CoeadaptApi {
  private baseUrl: string;
  private getToken: TokenProvider;

  constructor(baseUrl: string, getToken: TokenProvider) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.getToken = getToken;
  }

  /** Update the token provider (e.g., when switching from Clerk to device token) */
  setTokenProvider(provider: TokenProvider): void {
    this.getToken = provider;
  }

  /** Update base URL */
  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '');
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  private async headers(): Promise<Record<string, string>> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = await this.getToken();
    if (token) {
      h['Authorization'] = `Bearer ${token}`;
    }
    return h;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const h = await this.headers();

    const init: RequestInit = { method, headers: h };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);
    if (!res.ok) {
      let errBody: unknown;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }
      throw new ApiError(res.status, res.statusText, errBody);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return res.json() as Promise<T>;
    }
    return res.text() as unknown as T;
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  private patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  // ── System & Auth ───────────────────────────────────────────────────────

  healthCheck(): Promise<{ status: string }> {
    return this.get('/api/career-box/health');
  }

  verifyToken(token: string): Promise<DeviceTokenVerification> {
    return this.post('/api/career-box/verify-token', { token });
  }

  generateToken(): Promise<DeviceTokenResult> {
    return this.post('/api/career-box/generate-token');
  }

  getUser(): Promise<CoeadaptUser> {
    return this.get('/api/auth/user');
  }

  // ── AI Chat (Cora) ─────────────────────────────────────────────────────

  sendMessage(message: string, threadId?: string): Promise<{ reply: string; threadId: string }> {
    return this.post('/api/chatbot/agent', { message, threadId });
  }

  /**
   * Stream a Cora chat response via SSE.
   * Returns an AbortController so the caller can cancel.
   */
  streamChat(
    message: string,
    threadId: string | undefined,
    onMessage: (msg: CoraChatMessage) => void,
    onError?: (err: Error) => void,
  ): AbortController {
    const controller = new AbortController();
    const params = new URLSearchParams({ message });
    if (threadId) params.set('threadId', threadId);

    (async () => {
      try {
        const h = await this.headers();
        // SSE uses GET, so no Content-Type needed
        delete h['Content-Type'];

        const res = await fetch(
          `${this.baseUrl}/api/chatbot/agent/stream?${params}`,
          { headers: h, signal: controller.signal },
        );

        if (!res.ok) {
          throw new ApiError(res.status, res.statusText);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No readable stream');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as CoraChatMessage;
                onMessage(data);
              } catch {
                // ignore malformed SSE lines
              }
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return controller;
  }

  // ── Career Plans & Tasks ────────────────────────────────────────────────

  getPlans(): Promise<CareerPlan[]> {
    return this.get('/api/plans/me');
  }

  getPlan(id: string): Promise<CareerPlan> {
    return this.get(`/api/plans/${id}`);
  }

  getPlanTasks(planId: string): Promise<CareerTask[]> {
    return this.get(`/api/plans/${planId}/tasks`);
  }

  getTasks(): Promise<CareerTask[]> {
    return this.get('/api/tasks/me');
  }

  getTask(id: string): Promise<CareerTask> {
    return this.get(`/api/tasks/${id}`);
  }

  updateTask(id: string, updates: Partial<CareerTask>): Promise<CareerTask> {
    return this.put(`/api/tasks/${id}`, updates);
  }

  submitEvidence(taskId: string, evidence: { type: string; content: string; url?: string }): Promise<TaskEvidence> {
    return this.post(`/api/tasks/${taskId}/evidence`, evidence);
  }

  // ── Goals ───────────────────────────────────────────────────────────────

  getGoals(): Promise<Goal[]> {
    return this.get('/api/goals/me');
  }

  createGoal(goal: { title: string; description?: string; targetDate?: string }): Promise<Goal> {
    return this.post('/api/goals', goal);
  }

  updateGoal(id: string, updates: Partial<Goal>): Promise<Goal> {
    return this.patch(`/api/goals/${id}`, updates);
  }

  // ── Habits ──────────────────────────────────────────────────────────────

  getHabits(): Promise<Habit[]> {
    return this.get('/api/habits');
  }

  getTodayHabits(): Promise<Habit[]> {
    return this.get('/api/habits/today');
  }

  createHabit(habit: { name: string; description?: string; frequency: string }): Promise<Habit> {
    return this.post('/api/habits', habit);
  }

  completeHabit(id: string): Promise<Habit> {
    return this.post(`/api/habits/${id}/complete`);
  }

  getHabitStats(): Promise<HabitStats> {
    return this.get('/api/habits/stats/overview');
  }

  // ── Jobs ────────────────────────────────────────────────────────────────

  getJobs(): Promise<Job[]> {
    return this.get('/api/jobs');
  }

  discoverJobs(): Promise<Job[]> {
    return this.get('/api/jobs/discover');
  }

  bookmarkJob(jobId: string): Promise<{ success: boolean }> {
    return this.post(`/api/jobs/${jobId}/bookmark`);
  }

  getBookmarkedJobs(): Promise<BookmarkedJob[]> {
    return this.get('/api/jobs/bookmarks/me');
  }

  // ── Portfolio & Skills ──────────────────────────────────────────────────

  getPortfolioItems(): Promise<PortfolioItem[]> {
    return this.get('/api/portfolio/items');
  }

  getVerifiedSkills(): Promise<VerifiedSkill[]> {
    return this.get('/api/skills/verified');
  }

  // ── Market Intelligence ─────────────────────────────────────────────────

  getMarketFit(): Promise<MarketFit> {
    return this.get('/api/radar/market-fit');
  }

  getSkillDeltas(): Promise<SkillDelta[]> {
    return this.get('/api/radar/skill-deltas');
  }

  // ── Account ─────────────────────────────────────────────────────────────

  getSubscriptionStatus(): Promise<SubscriptionStatus> {
    return this.get('/api/subscription/status');
  }

  getNotifications(): Promise<Notification[]> {
    return this.get('/api/notifications/me');
  }
}

// ─── Default singleton (configured later by Clerk/config flow) ──────────────

const DEFAULT_API_URL = 'https://api.coeadapt.com';

let _instance: CoeadaptApi | null = null;

/**
 * Get or create the global Coeadapt API client.
 * Call `initCoeadaptApi()` first to configure it.
 */
export function getCoeadaptApi(): CoeadaptApi {
  if (!_instance) {
    _instance = new CoeadaptApi(DEFAULT_API_URL, async () => null);
  }
  return _instance;
}

/**
 * Initialize the global API client with a token provider and optional base URL.
 */
export function initCoeadaptApi(getToken: TokenProvider, baseUrl?: string): CoeadaptApi {
  _instance = new CoeadaptApi(baseUrl || DEFAULT_API_URL, getToken);
  return _instance;
}
