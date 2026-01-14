import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Session, Message, ServerEvent, PermissionResult, TraceStep, ContentBlock } from '../../renderer/types';
import { PathResolver } from '../sandbox/path-resolver';
import { ClaudeAgentRunner } from '../claude/agent-runner';

export class SessionManager {
  private db: Database.Database;
  private sendToRenderer: (event: ServerEvent) => void;
  private pathResolver: PathResolver;
  private agentRunner: ClaudeAgentRunner;
  private activeSessions: Map<string, AbortController> = new Map();
  private pendingPermissions: Map<string, (result: PermissionResult) => void> = new Map();

  constructor(db: Database.Database, sendToRenderer: (event: ServerEvent) => void) {
    this.db = db;
    this.sendToRenderer = sendToRenderer;
    this.pathResolver = new PathResolver();
    
    // Initialize Claude Agent Runner
    this.agentRunner = new ClaudeAgentRunner(
      { sendToRenderer: this.sendToRenderer },
      this.pathResolver
    );
    
    console.log('[SessionManager] Initialized');
  }

  // Create and start a new session
  async startSession(
    title: string,
    prompt: string,
    cwd?: string,
    allowedTools?: string[]
  ): Promise<Session> {
    console.log('[SessionManager] Starting new session:', title);
    
    const session = this.createSession(title, cwd, allowedTools);
    
    // Save to database
    this.saveSession(session);

    // Start processing the prompt
    this.processPrompt(session, prompt);

    return session;
  }

  // Create a new session object
  private createSession(title: string, cwd?: string, allowedTools?: string[]): Session {
    const now = Date.now();
    // Prefer frontend-provided cwd; fallback to env vars if provided
    const envCwd = process.env.COWORK_WORKDIR || process.env.WORKDIR || process.env.DEFAULT_CWD;
    const effectiveCwd = cwd || envCwd;
    return {
      id: uuidv4(),
      title,
      status: 'idle',
      cwd: effectiveCwd,
      mountedPaths: effectiveCwd ? [{ virtual: `/mnt/workspace`, real: effectiveCwd }] : [],
      allowedTools: allowedTools || ['read', 'glob', 'grep'],
      memoryEnabled: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  // Save session to database
  private saveSession(session: Session) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions 
      (id, title, claude_session_id, status, cwd, mounted_paths, allowed_tools, memory_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.title,
      session.claudeSessionId || null,
      session.status,
      session.cwd || null,
      JSON.stringify(session.mountedPaths),
      JSON.stringify(session.allowedTools),
      session.memoryEnabled ? 1 : 0,
      session.createdAt,
      session.updatedAt
    );
  }

  // Load session from database
  private loadSession(sessionId: string): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(sessionId) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      id: row.id as string,
      title: row.title as string,
      claudeSessionId: row.claude_session_id as string | undefined,
      status: row.status as Session['status'],
      cwd: row.cwd as string | undefined,
      mountedPaths: JSON.parse(row.mounted_paths as string),
      allowedTools: JSON.parse(row.allowed_tools as string),
      memoryEnabled: (row.memory_enabled as number) === 1,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  // List all sessions
  listSessions(): Session[] {
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC');
    const rows = stmt.all() as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      claudeSessionId: row.claude_session_id as string | undefined,
      status: row.status as Session['status'],
      cwd: row.cwd as string | undefined,
      mountedPaths: JSON.parse(row.mounted_paths as string),
      allowedTools: JSON.parse(row.allowed_tools as string),
      memoryEnabled: (row.memory_enabled as number) === 1,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    }));
  }

  // Continue an existing session
  async continueSession(sessionId: string, prompt: string): Promise<void> {
    console.log('[SessionManager] Continuing session:', sessionId);
    
    const session = this.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.processPrompt(session, prompt);
  }

  // Process a prompt using ClaudeAgentRunner
  private async processPrompt(session: Session, prompt: string): Promise<void> {
    console.log('[SessionManager] Processing prompt for session:', session.id);

    // Prevent duplicate concurrent runs on the same session (guard against double IPC)
    if (this.activeSessions.has(session.id)) {
      console.warn('[SessionManager] Session already running, ignoring duplicate start:', session.id);
      return;
    }

    // Update session status
    this.updateSessionStatus(session.id, 'running');

    try {
      // Create abort controller for this session so we can cancel
      const controller = new AbortController();
      this.activeSessions.set(session.id, controller);

      // Get existing messages for context
      const existingMessages = this.getMessages(session.id);
      
      // Run the agent - this handles everything including sending messages
      await this.agentRunner.run(session, prompt, existingMessages);

    } catch (error) {
      console.error('[SessionManager] Error processing prompt:', error);
      this.sendToRenderer({
        type: 'error',
        payload: { message: error instanceof Error ? error.message : 'Unknown error' },
      });
    } finally {
      this.activeSessions.delete(session.id);
      this.updateSessionStatus(session.id, 'idle');
    }
  }

  // Stop a running session
  stopSession(sessionId: string): void {
    console.log('[SessionManager] Stopping session:', sessionId);
    this.agentRunner.cancel(sessionId);
    // Also abort any pending controller we tracked
    const controller = this.activeSessions.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeSessions.delete(sessionId);
    }
    this.updateSessionStatus(sessionId, 'idle');
  }

  // Delete a session
  deleteSession(sessionId: string): void {
    // Stop if running
    this.stopSession(sessionId);

    // Delete from database
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    stmt.run(sessionId);

    // Delete messages
    const msgStmt = this.db.prepare('DELETE FROM messages WHERE session_id = ?');
    msgStmt.run(sessionId);
  }

  // Update session status
  private updateSessionStatus(sessionId: string, status: Session['status']): void {
    const stmt = this.db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?');
    stmt.run(status, Date.now(), sessionId);

    this.sendToRenderer({
      type: 'session.status',
      payload: { sessionId, status },
    });
  }

  // Save message to database
  saveMessage(message: Message): void {
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, timestamp, token_usage)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      message.id,
      message.sessionId,
      message.role,
      JSON.stringify(message.content),
      message.timestamp,
      message.tokenUsage ? JSON.stringify(message.tokenUsage) : null
    );
  }

  // Get messages for a session
  getMessages(sessionId: string): Message[] {
    const stmt = this.db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC');
    const rows = stmt.all(sessionId) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      sessionId: row.session_id as string,
      role: row.role as Message['role'],
      content: JSON.parse(row.content as string) as ContentBlock[],
      timestamp: row.timestamp as number,
      tokenUsage: row.token_usage ? JSON.parse(row.token_usage as string) : undefined,
    }));
  }

  // Handle permission response
  handlePermissionResponse(toolUseId: string, result: PermissionResult): void {
    const resolver = this.pendingPermissions.get(toolUseId);
    if (resolver) {
      resolver(result);
      this.pendingPermissions.delete(toolUseId);
    }
  }

  // Handle user's response to AskUserQuestion
  handleQuestionResponse(questionId: string, answer: string): void {
    this.agentRunner.handleQuestionResponse(questionId, answer);
  }

  // Request permission for a tool
  async requestPermission(
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<PermissionResult> {
    return new Promise((resolve) => {
      this.pendingPermissions.set(toolUseId, resolve);
      this.sendToRenderer({
        type: 'permission.request',
        payload: { toolUseId, toolName, input, sessionId },
      });
    });
  }
}
