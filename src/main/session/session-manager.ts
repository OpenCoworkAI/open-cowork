import { v4 as uuidv4 } from 'uuid';
import type { Session, Message, ServerEvent, PermissionResult, ContentBlock, TextContent } from '../../renderer/types';
import type { DatabaseInstance } from '../db/database';
import { PathResolver } from '../sandbox/path-resolver';
import { ClaudeAgentRunner } from '../claude/agent-runner';
import { MCPManager } from '../mcp/mcp-manager';
import { mcpConfigStore } from '../mcp/mcp-config-store';

export class SessionManager {
  private db: DatabaseInstance;
  private sendToRenderer: (event: ServerEvent) => void;
  private pathResolver: PathResolver;
  private agentRunner: ClaudeAgentRunner;
  private mcpManager: MCPManager;
  private activeSessions: Map<string, AbortController> = new Map();
  private pendingPermissions: Map<string, (result: PermissionResult) => void> = new Map();

  constructor(db: DatabaseInstance, sendToRenderer: (event: ServerEvent) => void) {
    this.db = db;
    this.sendToRenderer = sendToRenderer;
    this.pathResolver = new PathResolver();
    
    // Initialize MCP Manager
    this.mcpManager = new MCPManager();
    this.initializeMCP();
    
    // Initialize Claude Agent Runner with message save callback and MCP manager
    this.agentRunner = new ClaudeAgentRunner(
      { 
        sendToRenderer: this.sendToRenderer,
        saveMessage: (message: Message) => this.saveMessage(message),
      },
      this.pathResolver,
      this.mcpManager
    );
    
    console.log('[SessionManager] Initialized with persistent database and MCP support');
  }

  /**
   * Initialize MCP servers from configuration
   */
  private async initializeMCP(): Promise<void> {
    try {
      const servers = mcpConfigStore.getEnabledServers();
      await this.mcpManager.initializeServers(servers);
      console.log(`[SessionManager] Initialized ${servers.length} MCP servers`);
    } catch (error) {
      console.error('[SessionManager] Failed to initialize MCP servers:', error);
    }
  }

  /**
   * Get MCP manager instance
   */
  getMCPManager(): MCPManager {
    return this.mcpManager;
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
    this.db.sessions.create({
      id: session.id,
      title: session.title,
      claude_session_id: session.claudeSessionId || null,
      status: session.status,
      cwd: session.cwd || null,
      mounted_paths: JSON.stringify(session.mountedPaths),
      allowed_tools: JSON.stringify(session.allowedTools),
      memory_enabled: session.memoryEnabled ? 1 : 0,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    });
  }

  // Load session from database
  private loadSession(sessionId: string): Session | null {
    const row = this.db.sessions.get(sessionId);
    if (!row) return null;

    return {
      id: row.id,
      title: row.title,
      claudeSessionId: row.claude_session_id || undefined,
      status: row.status as Session['status'],
      cwd: row.cwd || undefined,
      mountedPaths: JSON.parse(row.mounted_paths),
      allowedTools: JSON.parse(row.allowed_tools),
      memoryEnabled: row.memory_enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // List all sessions
  listSessions(): Session[] {
    const rows = this.db.sessions.getAll();

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      claudeSessionId: row.claude_session_id || undefined,
      status: row.status as Session['status'],
      cwd: row.cwd || undefined,
      mountedPaths: JSON.parse(row.mounted_paths),
      allowedTools: JSON.parse(row.allowed_tools),
      memoryEnabled: row.memory_enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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

      // Save user message to database for persistence
      const userMessage: Message = {
        id: uuidv4(),
        sessionId: session.id,
        role: 'user',
        content: [{ type: 'text', text: prompt } as TextContent],
        timestamp: Date.now(),
      };
      this.saveMessage(userMessage);
      console.log('[SessionManager] User message saved:', userMessage.id);

      // Get existing messages for context (including the one we just saved)
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

    // Delete from database (messages will be deleted automatically via CASCADE)
    this.db.sessions.delete(sessionId);
    
    console.log('[SessionManager] Session deleted:', sessionId);
  }

  // Update session status
  private updateSessionStatus(sessionId: string, status: Session['status']): void {
    this.db.sessions.update(sessionId, { status, updated_at: Date.now() });

    this.sendToRenderer({
      type: 'session.status',
      payload: { sessionId, status },
    });
  }

  // Save message to database
  saveMessage(message: Message): void {
    this.db.messages.create({
      id: message.id,
      session_id: message.sessionId,
      role: message.role,
      content: JSON.stringify(message.content),
      timestamp: message.timestamp,
      token_usage: message.tokenUsage ? JSON.stringify(message.tokenUsage) : null,
    });
    
    console.log('[SessionManager] Message saved:', message.id, 'role:', message.role);
  }

  // Get messages for a session
  getMessages(sessionId: string): Message[] {
    const rows = this.db.messages.getBySessionId(sessionId);

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role as Message['role'],
      content: JSON.parse(row.content) as ContentBlock[],
      timestamp: row.timestamp,
      tokenUsage: row.token_usage ? JSON.parse(row.token_usage) : undefined,
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
