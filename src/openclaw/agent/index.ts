/**
 * Navi Agent — The user's career navigation agent
 *
 * Navi is the career-focused AI agent baked into the Coeadapt platform.
 * It can also run standalone, giving users a true co-working partner for
 * career development, job search, skill building, and professional growth.
 *
 * Navi's signature capability is Skillception — skills for building skills.
 * It maintains a living skill tree where mastering one skill unlocks the next.
 */

import type { OpenClawConfig, OpenClawSession, AgentCapability } from '../types';

export class NaviAgent {
  private config: OpenClawConfig;
  private session: OpenClawSession | null = null;
  private capabilities: AgentCapability[] = [];

  constructor(config: OpenClawConfig) {
    this.config = config;
  }

  /**
   * Initialize the agent, load skills, and connect to the environment.
   */
  async initialize(): Promise<void> {
    // Load registered skills (career-dev, platform-connect, skillception)
    await this.loadSkills();

    // Connect to career platform if credentials available
    if (this.config.platformToken) {
      await this.connectPlatform();
    }

    // Set up the co-working environment
    await this.initEnvironment();
  }

  /**
   * Start a new co-working session.
   * In standalone mode, this is the entry point.
   * When embedded in Coeadapt, the platform orchestrates session creation.
   */
  async startSession(userId: string): Promise<OpenClawSession> {
    this.session = {
      id: crypto.randomUUID(),
      userId,
      startedAt: Date.now(),
      mode: this.config.standalone ? 'standalone' : 'embedded',
      activeSkills: [...this.capabilities.map(c => c.skillId)],
    };

    return this.session;
  }

  /**
   * Process a user message through the agent pipeline.
   */
  async process(message: string): Promise<string> {
    if (!this.session) {
      throw new Error('No active session. Call startSession() first.');
    }

    // Route to the appropriate skill based on intent
    const intent = await this.classifyIntent(message);
    const skill = this.capabilities.find(c => c.handles(intent));

    if (skill) {
      return skill.execute(message, this.session);
    }

    // Fallback: general career conversation
    return this.generalResponse(message);
  }

  /**
   * End the current session and persist any state.
   */
  async endSession(): Promise<void> {
    if (this.session) {
      // Persist session artifacts to the environment
      await this.persistSessionState();
      this.session = null;
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async loadSkills(): Promise<void> {
    // Skills are loaded from src/openclaw/skills/
    // Each skill registers its capabilities with the agent:
    //   - career-dev: career planning, resume, interview, habits
    //   - platform-connect: Coeadapt API bridge
    //   - skillception: skill tree management, prerequisite graph, evidence
  }

  private async connectPlatform(): Promise<void> {
    // Connect to the Coeadapt career platform API
    // Uses the same auth flow as career-tools-server.ts
  }

  private async initEnvironment(): Promise<void> {
    // Initialize the co-working environment
    // - Workspace for documents, resumes, portfolios
    // - Scratch space for drafts and iterations
    // - Artifact store for completed work
    // - Skill tree data store
  }

  private async classifyIntent(_message: string): Promise<string> {
    // Classify user intent to route to the right skill
    // Categories: career-dev, platform, job-search, skill-build, skill-tree, reflect
    return 'general';
  }

  private async generalResponse(_message: string): Promise<string> {
    return '';
  }

  private async persistSessionState(): Promise<void> {
    // Save session state to the environment for continuity
  }
}

/** @deprecated Use NaviAgent — kept for backward compatibility */
export const OpenClawAgent = NaviAgent;

export default NaviAgent;
