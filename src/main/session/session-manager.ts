import { v4 as uuidv4 } from 'uuid';
import type { Session, Message, ServerEvent, PermissionResult, ContentBlock, TextContent, TraceStep } from '../../renderer/types';
import type { DatabaseInstance, TraceStepRow } from '../db/database';
import { PathResolver } from '../sandbox/path-resolver';
import { ClaudeAgentRunner } from '../claude/agent-runner';
import { OpenAIResponsesRunner } from '../openai/responses-runner';
import { configStore } from '../config/config-store';
import { MCPManager } from '../mcp/mcp-manager';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import { log, logError, logWarn } from '../utils/logger';

interface AgentRunner {
  run(session: Session, prompt: string, existingMessages: Message[]): Promise<void>;
  cancel(sessionId: string): void;
  handleQuestionResponse(questionId: string, answer: string): void;
}

export class SessionManager {
  private db: DatabaseInstance;
  private sendToRenderer: (event: ServerEvent) => void;
  private pathResolver: PathResolver;
  private agentRunner: AgentRunner;
  private mcpManager: MCPManager;
  private activeSessions: Map<string, AbortController> = new Map();
  private promptQueues: Map<string, string[]> = new Map();
  private pendingPermissions: Map<string, (result: PermissionResult) => void> = new Map();

  constructor(db: DatabaseInstance, sendToRenderer: (event: ServerEvent) => void) {
    this.db = db;
    this.sendToRenderer = (event) => {
      if (event.type === 'trace.step') {
        this.saveTraceStep(event.payload.sessionId, event.payload.step);
      }
      if (event.type === 'trace.update') {
        this.updateTraceStep(event.payload.stepId, event.payload.updates);
      }
      sendToRenderer(event);
    };
    this.pathResolver = new PathResolver();

    // Initialize MCP Manager
    this.mcpManager = new MCPManager();
    this.initializeMCP();

    const provider = configStore.get('provider');
    const customProtocol = configStore.get('customProtocol');
    const useOpenAI = provider === 'openai' || (provider === 'custom' && customProtocol === 'openai');
    if (useOpenAI) {
      this.agentRunner = new OpenAIResponsesRunner({
        sendToRenderer: this.sendToRenderer,
        saveMessage: (message: Message) => this.saveMessage(message),
        pathResolver: this.pathResolver,
        requestPermission: (sessionId, toolUseId, toolName, input) =>
          this.requestPermission(sessionId, toolUseId, toolName, input),
      });
      log('[SessionManager] Using OpenAI Responses runner');
    } else {
      // Initialize Claude Agent Runner with message save callback
      this.agentRunner = new ClaudeAgentRunner(
        { 
          sendToRenderer: this.sendToRenderer,
          saveMessage: (message: Message) => this.saveMessage(message),
        },
        this.pathResolver,
        this.mcpManager
      );
      log('[SessionManager] Using Claude Agent runner');
    }
    
    log('[SessionManager] Initialized with persistent database and MCP support');
  }

  /**
   * Initialize MCP servers from configuration
   */
  private async initializeMCP(): Promise<void> {
    try {
      const servers = mcpConfigStore.getEnabledServers();
      await this.mcpManager.initializeServers(servers);
      log(`[SessionManager] Initialized ${servers.length} MCP servers`);
    } catch (error) {
      logError('[SessionManager] Failed to initialize MCP servers:', error);
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
    log('[SessionManager] Starting new session:', title);
    
    const session = this.createSession(title, cwd, allowedTools);
    
    // Save to database
    this.saveSession(session);

    // Start processing the prompt
    this.enqueuePrompt(session, prompt);

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
      allowedTools: allowedTools || [
        'askuserquestion',
        'todowrite',
        'todoread',
        'webfetch',
        'websearch',
        'read',
        'write',
        'edit',
        'list_directory',
        'glob',
        'grep',
      ],
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
    log('[SessionManager] Continuing session:', sessionId);
    
    const session = this.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.enqueuePrompt(session, prompt);
  }

  // Process a prompt using ClaudeAgentRunner
  private async processPrompt(session: Session, prompt: string): Promise<void> {
    log('[SessionManager] Processing prompt for session:', session.id);

    try {
      // Save user message to database for persistence
      const userMessage: Message = {
        id: uuidv4(),
        sessionId: session.id,
        role: 'user',
        content: [{ type: 'text', text: prompt } as TextContent],
        timestamp: Date.now(),
      };
      this.saveMessage(userMessage);
      log('[SessionManager] User message saved:', userMessage.id);

      // Get existing messages for context (including the one we just saved)
      const existingMessages = this.getMessages(session.id);
      
      // Run the agent - this handles everything including sending messages
      await this.agentRunner.run(session, prompt, existingMessages);
    } catch (error) {
      logError('[SessionManager] Error processing prompt:', error);
      this.sendToRenderer({
        type: 'error',
        payload: { message: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  }

  private enqueuePrompt(session: Session, prompt: string): void {
    const queue = this.promptQueues.get(session.id) || [];
    queue.push(prompt);
    this.promptQueues.set(session.id, queue);

    if (!this.activeSessions.has(session.id)) {
      void this.processQueue(session);
    } else {
      log('[SessionManager] Session running, queued prompt:', session.id);
    }
  }

  private async processQueue(session: Session): Promise<void> {
    if (this.activeSessions.has(session.id)) return;

    const controller = new AbortController();
    this.activeSessions.set(session.id, controller);
    this.updateSessionStatus(session.id, 'running');

    try {
      while (!controller.signal.aborted) {
        const queue = this.promptQueues.get(session.id);
        if (!queue || queue.length === 0) break;

        const prompt = queue.shift();
        if (!prompt) continue;

        await this.processPrompt(session, prompt);

        if (controller.signal.aborted) break;
      }
    } finally {
      this.activeSessions.delete(session.id);
      const queue = this.promptQueues.get(session.id);
      if (queue && queue.length === 0) {
        this.promptQueues.delete(session.id);
      }
      this.updateSessionStatus(session.id, 'idle');
    }
  }

  // Stop a running session
  stopSession(sessionId: string): void {
    log('[SessionManager] Stopping session:', sessionId);
    this.agentRunner.cancel(sessionId);
    // Also abort any pending controller we tracked
    const controller = this.activeSessions.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeSessions.delete(sessionId);
    }
    this.promptQueues.delete(sessionId);
    this.updateSessionStatus(sessionId, 'idle');
  }

  // Delete a session
  deleteSession(sessionId: string): void {
    // Stop if running
    this.stopSession(sessionId);

    // Delete from database (messages will be deleted automatically via CASCADE)
    this.db.sessions.delete(sessionId);
    
    log('[SessionManager] Session deleted:', sessionId);
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
    
    log('[SessionManager] Message saved:', message.id, 'role:', message.role);
  }

  // Get messages for a session
  getMessages(sessionId: string): Message[] {
    const rows = this.db.messages.getBySessionId(sessionId);

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role as Message['role'],
      content: this.normalizeContent(row.content),
      timestamp: row.timestamp,
      tokenUsage: row.token_usage ? JSON.parse(row.token_usage) : undefined,
    }));
  }

  private normalizeContent(raw: string): ContentBlock[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed as ContentBlock[];
      }
      if (parsed && typeof parsed === 'object' && 'type' in (parsed as Record<string, unknown>)) {
        return [parsed as ContentBlock];
      }
      if (typeof parsed === 'string') {
        return [{ type: 'text', text: parsed } as TextContent];
      }
      return [{ type: 'text', text: String(parsed) } as TextContent];
    } catch {
      return [{ type: 'text', text: raw } as TextContent];
    }
  }

  getTraceSteps(sessionId: string): TraceStep[] {
    const rows = this.db.traceSteps.getBySessionId(sessionId);
    const parseToolInput = (value: string | null): Record<string, unknown> | undefined => {
      if (!value) return undefined;
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    };
    return rows.map((row) => ({
      id: row.id,
      type: row.type as TraceStep['type'],
      status: row.status as TraceStep['status'],
      title: row.title,
      content: row.content || undefined,
      toolName: row.tool_name || undefined,
      toolInput: parseToolInput(row.tool_input),
      toolOutput: row.tool_output || undefined,
      isError: row.is_error === 1 ? true : undefined,
      timestamp: row.timestamp,
      duration: row.duration ?? undefined,
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

  private saveTraceStep(sessionId: string, step: TraceStep): void {
    this.db.traceSteps.create({
      id: step.id,
      session_id: sessionId,
      type: step.type,
      status: step.status,
      title: step.title,
      content: step.content ?? null,
      tool_name: step.toolName ?? null,
      tool_input: step.toolInput ? JSON.stringify(step.toolInput) : null,
      tool_output: step.toolOutput ?? null,
      is_error: step.isError ? 1 : null,
      timestamp: step.timestamp,
      duration: step.duration ?? null,
    });
  }

  private updateTraceStep(stepId: string, updates: Partial<TraceStep>): void {
    const rowUpdates: Partial<TraceStepRow> = {};
    if (updates.type !== undefined) rowUpdates.type = updates.type;
    if (updates.status !== undefined) rowUpdates.status = updates.status;
    if (updates.title !== undefined) rowUpdates.title = updates.title;
    if (updates.content !== undefined) rowUpdates.content = updates.content;
    if (updates.toolName !== undefined) rowUpdates.tool_name = updates.toolName;
    if (updates.toolInput !== undefined) {
      rowUpdates.tool_input = updates.toolInput ? JSON.stringify(updates.toolInput) : null;
    }
    if (updates.toolOutput !== undefined) rowUpdates.tool_output = updates.toolOutput;
    if (updates.isError !== undefined) rowUpdates.is_error = updates.isError ? 1 : 0;
    if (updates.timestamp !== undefined) rowUpdates.timestamp = updates.timestamp;
    if (updates.duration !== undefined) rowUpdates.duration = updates.duration;

    this.db.traceSteps.update(stepId, rowUpdates);
  }
}
