/**
 * Coeadapt API Client
 * REST/WebSocket client for the Coeadapt career development platform.
 */

import { log, logError, logWarn } from '../../../utils/logger';

// ============================================================================
// API Types
// ============================================================================

export interface CoeadaptCredentials {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface CoeadaptAuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
}

export interface CoeadaptUserProfile {
  id: string;
  email: string;
  displayName: string;
  avatar?: string;
  currentRole?: string;
  targetRole?: string;
  skills: CoeadaptSkill[];
  careerStage: 'exploring' | 'transitioning' | 'advancing' | 'established';
  joinedAt: number;
}

export interface CoeadaptSkill {
  id: string;
  name: string;
  category: string;
  proficiency: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  verified: boolean;
  lastAssessedAt?: number;
}

export interface CoeadaptCareerRoadmap {
  id: string;
  userId: string;
  targetRole: string;
  milestones: CoeadaptMilestone[];
  estimatedTimelineWeeks: number;
  createdAt: number;
  updatedAt: number;
}

export interface CoeadaptMilestone {
  id: string;
  title: string;
  description: string;
  requiredSkills: string[];
  status: 'pending' | 'in_progress' | 'completed';
  order: number;
}

export interface CoeadaptSkillGapAnalysis {
  currentSkills: CoeadaptSkill[];
  requiredSkills: CoeadaptSkill[];
  gaps: {
    skillName: string;
    currentLevel: string;
    requiredLevel: string;
    priority: 'high' | 'medium' | 'low';
    suggestedResources: string[];
  }[];
  overallReadiness: number; // 0-100
}

export interface CoeadaptJobListing {
  id: string;
  title: string;
  company: string;
  location: string;
  salaryRange?: { min: number; max: number; currency: string };
  matchScore: number; // 0-100
  requiredSkills: string[];
  postedAt: number;
  url?: string;
}

export interface CoeadaptPortfolio {
  id: string;
  userId: string;
  items: CoeadaptPortfolioItem[];
  updatedAt: number;
}

export interface CoeadaptPortfolioItem {
  id: string;
  title: string;
  description: string;
  type: 'case_study' | 'project' | 'certification' | 'video_demo';
  skills: string[];
  url?: string;
  createdAt: number;
}

export interface CoeadaptMessage {
  type: 'text' | 'career_action' | 'document_request';
  text?: string;
  action?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// API Client
// ============================================================================

export class CoeadaptAPI {
  private baseUrl: string;
  private credentials: CoeadaptCredentials;
  private tokenRefreshPromise: Promise<CoeadaptAuthToken> | null = null;

  constructor(baseUrl: string, credentials: CoeadaptCredentials = {}) {
    // Ensure no trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.credentials = { ...credentials };
  }

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  /**
   * Authenticate with API key and get an access token.
   */
  async authenticate(): Promise<CoeadaptAuthToken> {
    if (!this.credentials.apiKey) {
      throw new Error('Coeadapt API key is required for authentication');
    }

    const response = await this.request<CoeadaptAuthToken>('/api/v1/auth/token', {
      method: 'POST',
      body: JSON.stringify({ apiKey: this.credentials.apiKey }),
      skipAuth: true,
    });

    this.credentials.accessToken = response.accessToken;
    this.credentials.refreshToken = response.refreshToken;
    this.credentials.expiresAt = response.expiresAt;

    log('[CoeadaptAPI] Authenticated successfully', { userId: response.userId });
    return response;
  }

  /**
   * Refresh the access token using the refresh token.
   */
  async refreshAccessToken(): Promise<CoeadaptAuthToken> {
    // Deduplicate concurrent refresh calls
    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }

    this.tokenRefreshPromise = this.doRefreshToken();

    try {
      return await this.tokenRefreshPromise;
    } finally {
      this.tokenRefreshPromise = null;
    }
  }

  private async doRefreshToken(): Promise<CoeadaptAuthToken> {
    if (!this.credentials.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await this.request<CoeadaptAuthToken>('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: this.credentials.refreshToken }),
      skipAuth: true,
    });

    this.credentials.accessToken = response.accessToken;
    this.credentials.refreshToken = response.refreshToken;
    this.credentials.expiresAt = response.expiresAt;

    log('[CoeadaptAPI] Token refreshed successfully');
    return response;
  }

  /**
   * Check if the current access token is valid (not expired).
   */
  isTokenValid(): boolean {
    if (!this.credentials.accessToken || !this.credentials.expiresAt) {
      return false;
    }
    // Consider expired 60s before actual expiry for safety margin
    return Date.now() < this.credentials.expiresAt - 60_000;
  }

  // --------------------------------------------------------------------------
  // User Profile
  // --------------------------------------------------------------------------

  async getUserProfile(userId: string): Promise<CoeadaptUserProfile> {
    return this.request<CoeadaptUserProfile>(`/api/v1/users/${userId}/profile`);
  }

  async getCurrentUser(): Promise<CoeadaptUserProfile> {
    return this.request<CoeadaptUserProfile>('/api/v1/users/me');
  }

  // --------------------------------------------------------------------------
  // Career Tools
  // --------------------------------------------------------------------------

  async getCareerRoadmap(userId: string): Promise<CoeadaptCareerRoadmap> {
    return this.request<CoeadaptCareerRoadmap>(`/api/v1/users/${userId}/career/roadmap`);
  }

  async analyzeSkillGap(
    currentSkills: string[],
    targetRole: string
  ): Promise<CoeadaptSkillGapAnalysis> {
    return this.request<CoeadaptSkillGapAnalysis>('/api/v1/career/skill-gap', {
      method: 'POST',
      body: JSON.stringify({ currentSkills, targetRole }),
    });
  }

  async searchJobs(criteria: {
    query?: string;
    skills?: string[];
    location?: string;
    remote?: boolean;
    limit?: number;
  }): Promise<CoeadaptJobListing[]> {
    const params = new URLSearchParams();
    if (criteria.query) params.set('q', criteria.query);
    if (criteria.skills?.length) params.set('skills', criteria.skills.join(','));
    if (criteria.location) params.set('location', criteria.location);
    if (criteria.remote !== undefined) params.set('remote', String(criteria.remote));
    if (criteria.limit) params.set('limit', String(criteria.limit));

    return this.request<CoeadaptJobListing[]>(`/api/v1/jobs/search?${params.toString()}`);
  }

  // --------------------------------------------------------------------------
  // Portfolio
  // --------------------------------------------------------------------------

  async getPortfolio(userId: string): Promise<CoeadaptPortfolio> {
    return this.request<CoeadaptPortfolio>(`/api/v1/users/${userId}/portfolio`);
  }

  async addPortfolioItem(
    userId: string,
    item: Omit<CoeadaptPortfolioItem, 'id' | 'createdAt'>
  ): Promise<CoeadaptPortfolioItem> {
    return this.request<CoeadaptPortfolioItem>(`/api/v1/users/${userId}/portfolio/items`, {
      method: 'POST',
      body: JSON.stringify(item),
    });
  }

  // --------------------------------------------------------------------------
  // Messaging
  // --------------------------------------------------------------------------

  async sendMessage(userId: string, message: CoeadaptMessage): Promise<{ messageId: string }> {
    return this.request<{ messageId: string }>(`/api/v1/users/${userId}/messages`, {
      method: 'POST',
      body: JSON.stringify(message),
    });
  }

  // --------------------------------------------------------------------------
  // Connection Health
  // --------------------------------------------------------------------------

  async ping(): Promise<boolean> {
    try {
      await this.request<{ status: string }>('/api/v1/health', { skipAuth: true });
      return true;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Internal HTTP Helper
  // --------------------------------------------------------------------------

  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: string;
      skipAuth?: boolean;
    } = {}
  ): Promise<T> {
    const { method = 'GET', body, skipAuth = false } = options;

    // Auto-refresh token if needed
    if (!skipAuth && !this.isTokenValid() && this.credentials.refreshToken) {
      try {
        await this.refreshAccessToken();
      } catch (err) {
        logWarn('[CoeadaptAPI] Token refresh failed, attempting re-authentication');
        await this.authenticate();
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'OpenCowork/3.1.0',
    };

    if (!skipAuth && this.credentials.accessToken) {
      headers['Authorization'] = `Bearer ${this.credentials.accessToken}`;
    }

    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body || undefined,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(
          `Coeadapt API error: ${response.status} ${response.statusText} — ${errorBody}`
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Coeadapt API error')) {
        throw error;
      }
      logError('[CoeadaptAPI] Request failed:', error);
      throw new Error(`Coeadapt API request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // --------------------------------------------------------------------------
  // Credential management
  // --------------------------------------------------------------------------

  updateCredentials(credentials: Partial<CoeadaptCredentials>): void {
    Object.assign(this.credentials, credentials);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
