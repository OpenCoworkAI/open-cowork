/**
 * @module main/session/session-manager
 *
 * Session lifecycle manager (957 lines).
 *
 * Responsibilities:
 * - Session CRUD: create, continue, stop, delete, list
 * - Chat history persistence to SQLite via DatabaseInstance
 * - Workspace-scoped sessions with sandbox integration
 * - Delegates AI execution to ClaudeAgentRunner
 *
 * Dependencies: database, agent-runner, config-store, mcp-manager, sandbox-adapter
 */
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import type { Session, Message, ServerEvent, PermissionResult, ContentBlock, TextContent, TraceStep, FileAttachmentContent } from '../../renderer/types';
import type { DatabaseInstance, TraceStepRow } from '../db/database';
import { PathResolver } from '../sandbox/path-resolver';
import { SandboxAdapter, getSandboxAdapter, initializeSandbox, reinitializeSandbox } from '../sandbox/sandbox-adapter';
import { SandboxSync } from '../sandbox/sandbox-sync';
import { ClaudeAgentRunner } from '../claude/agent-runner';
import { configStore } from '../config/config-store';
import { MCPManager } from '../mcp/mcp-manager';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import { PluginRuntimeService } from '../skills/plugin-runtime-service';
import { log, logError, logWarn } from '../utils/logger';
import { maybeGenerateSessionTitle } from './session-title-flow';
import {
  buildTitlePrompt,
  getDefaultTitleFromPrompt,
  normalizeGeneratedTitle,
} from './session-title-utils';
import { generateTitleWithClaudeSdk } from '../claude/claude-sdk-one-shot';
import { buildScheduledTaskTitle } from '../../shared/schedule/task-title';

interface AgentRunner {
  run(session: Session, prompt: string, existingMessages: Message[]): Promise<void>;
  cancel(sessionId: string): void;
  clearSdkSession?(sessionId: string): void;
}

const WORKSPACE_MOUNT_VIRTUAL_PATH = '/mnt/workspace';
const TITLE_GENERATION_TIMEOUT_MS = 20000;

export class SessionManager {
  private db: DatabaseInstance;
  private sendToRenderer: (event: ServerEvent) => void;
  private pathResolver: PathResolver;
  private sandboxAdapter: SandboxAdapter;
  private agentRunner!: AgentRunner;
  private mcpManager: MCPManager;
  private pluginRuntimeService?: PluginRuntimeService;
  private activeSessions: Map<string, AbortController> = new Map();
  private promptQueues: Map<string, Array<{ prompt: string; content?: ContentBlock[] }>> = new Map();
  private pendingPermissions: Map<string, (result: PermissionResult) => void> = new Map();
  private pendingSudoPasswords: Map<string, { sessionId: string; resolve: (password: string | null) => void }> = new Map();
  private sandboxInitPromises: Map<string, Promise<void>> = new Map();
  private sessionTitleAttempts: Set<string> = new Set();
  private titleGenerationTokens: Map<string, symbol> = new Map();
  private messageCache: Map<string, Message[]> = new Map();

  constructor(
    db: DatabaseInstance,
    sendToRenderer: (event: ServerEvent) => void,
    pluginRuntimeService?: PluginRuntimeService
  ) {
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
    this.sandboxAdapter = getSandboxAdapter();
    this.pluginRuntimeService = pluginRuntimeService;

    // Initialize MCP Manager
    this.mcpManager = new MCPManager();
    this.initializeMCP();

    // Create agent runner based on current config
    this.createAgentRunner();

    log('[SessionManager] Initialized with persistent database and MCP support');
  }

  /**
   * Create agent runner based on current config
   * Can be called to recreate runner when config changes
   */
  private createAgentRunner(): void {
    this.agentRunner = this.createClaudeAgentRunner();
    log('[SessionManager] Using pi-coding-agent runner');
  }

  private createClaudeAgentRunner(): ClaudeAgentRunner {
    return new ClaudeAgentRunner(
      {
        sendToRenderer: this.sendToRenderer,
        saveMessage: (message: Message) => this.saveMessage(message),
        requestSudoPassword: (sessionId: string, toolUseId: string, command: string) =>
          this.requestSudoPassword(sessionId, toolUseId, command),
      },
      this.pathResolver,
      this.mcpManager,
      this.pluginRuntimeService
    );
  }

  /**
   * Reload API config only — recreate agent runner without touching MCP or sandbox.
   */
  reloadConfig(): void {
    log('[SessionManager] Reloading API config and recreating agent runner');
    for (const sessionId of this.activeSessions.keys()) {
      log('[SessionManager] Stopping active session before config reload:', sessionId);
      this.stopSession(sessionId);
    }
    this.createAgentRunner();
    log('[SessionManager] API config reloaded successfully');
  }

  /**
   * Reinitialize MCP servers (call only when MCP config actually changes)
   */
  async reloadMCP(): Promise<void> {
    log('[SessionManager] Reloading MCP servers');
    await this.initializeMCP();
  }

  /**
   * Reinitialize sandbox adapter (call only when sandbox config changes)
   */
  async reloadSandbox(): Promise<void> {
    await this.reinitializeSandboxAsync();
  }

  /**
   * Reinitialize sandbox adapter asynchronously
   */
  private async reinitializeSandboxAsync(): Promise<void> {
    try {
      log('[SessionManager] Reinitializing sandbox adapter...');
      await reinitializeSandbox();
      this.sandboxAdapter = getSandboxAdapter();
      log('[SessionManager] Sandbox adapter reinitialized, mode:', this.sandboxAdapter.mode);
    } catch (error) {
      logError('[SessionManager] Failed to reinitialize sandbox:', error);
    }
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

  /**
   * Get sandbox adapter instance
   */
  getSandboxAdapter(): SandboxAdapter {
    return this.sandboxAdapter;
  }

  // Create and start a new session
  async startSession(
    title: string,
    prompt: string,
    cwd?: string,
    allowedTools?: string[],
    content?: ContentBlock[]
  ): Promise<Session> {
    log('[SessionManager] Starting new session:', title);

    const session = this.createSession(title, cwd, allowedTools);

    // Save to database
    this.saveSession(session);

    // Start processing the prompt with content blocks
    this.enqueuePrompt(session, prompt, content);

    return session;
  }

  // Create a new session object
  private buildMountedPaths(cwd?: string): Session['mountedPaths'] {
    if (!cwd) {
      return [];
    }
    return [{ virtual: WORKSPACE_MOUNT_VIRTUAL_PATH, real: cwd }];
  }

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
      mountedPaths: this.buildMountedPaths(effectiveCwd),
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
      model: configStore.get('model') || undefined,
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
      openai_thread_id: session.openaiThreadId || null,
      status: session.status,
      cwd: session.cwd || null,
      mounted_paths: JSON.stringify(session.mountedPaths),
      allowed_tools: JSON.stringify(session.allowedTools),
      memory_enabled: session.memoryEnabled ? 1 : 0,
      model: session.model || null,
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
      openaiThreadId: row.openai_thread_id || undefined,
      status: row.status as Session['status'],
      cwd: row.cwd || undefined,
      mountedPaths: JSON.parse(row.mounted_paths),
      allowedTools: JSON.parse(row.allowed_tools),
      memoryEnabled: row.memory_enabled === 1,
      model: row.model || undefined,
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
      openaiThreadId: row.openai_thread_id || undefined,
      status: row.status as Session['status'],
      cwd: row.cwd || undefined,
      mountedPaths: JSON.parse(row.mounted_paths),
      allowedTools: JSON.parse(row.allowed_tools),
      memoryEnabled: row.memory_enabled === 1,
      model: row.model || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // Continue an existing session
  async continueSession(sessionId: string, prompt: string, content?: ContentBlock[]): Promise<void> {
    log('[SessionManager] Continuing session:', sessionId);

    const session = this.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.enqueuePrompt(session, prompt, content);
  }

  async generateSessionTitleFromPrompt(prompt: string, cwd?: string): Promise<string> {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      return 'New Session';
    }

    const generated = await this.withTimeout(
      this.generateTitleWithConfig(buildTitlePrompt(normalizedPrompt), cwd),
      TITLE_GENERATION_TIMEOUT_MS,
      'session-title-preview'
    );
    const normalizedGenerated = normalizeGeneratedTitle(generated);
    return normalizedGenerated ?? getDefaultTitleFromPrompt(normalizedPrompt);
  }

  async generateScheduledTaskTitle(prompt: string, cwd?: string): Promise<string> {
    const sessionTitle = await this.generateSessionTitleFromPrompt(prompt, cwd);
    return buildScheduledTaskTitle(sessionTitle);
  }

  /**
   * Ensure sandbox is initialized for the session's workspace
   */
  private async ensureSandboxInitialized(session: Session): Promise<void> {
    if (!session.cwd) {
      log('[SessionManager] No workspace directory, skipping sandbox init');
      return;
    }

    // Check if already initialized with this workspace
    if (this.sandboxAdapter.initialized) {
      return;
    }

    // Check if initialization is already in progress
    const existingPromise = this.sandboxInitPromises.get(session.cwd);
    if (existingPromise) {
      await existingPromise;
      return;
    }

    // Initialize sandbox with workspace
    const initPromise = initializeSandbox({
      workspacePath: session.cwd,
      mainWindow: null, // Will show dialogs globally
    }).then(() => { /* void */ });

    this.sandboxInitPromises.set(session.cwd, initPromise);

    try {
      await initPromise;
      log('[SessionManager] Sandbox initialized for workspace:', session.cwd);
      log('[SessionManager] Sandbox mode:', this.sandboxAdapter.mode);
    } catch (error) {
      logError('[SessionManager] Failed to initialize sandbox:', error);
      // Continue anyway - sandbox adapter will fallback to native
    } finally {
      this.sandboxInitPromises.delete(session.cwd);
    }
  }

  // Helper: Copy files to session's .tmp directory and sync to sandbox if needed
  private async processFileAttachments(session: Session, content: ContentBlock[]): Promise<ContentBlock[]> {
    const processedContent: ContentBlock[] = [];

    for (const block of content) {
      if (block.type === 'file_attachment') {
        const fileBlock = block as FileAttachmentContent;

        try {
          // Create .tmp directory if it doesn't exist
          const tmpDir = path.join(session.cwd || process.cwd(), '.tmp');
          if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
            log('[SessionManager] Created .tmp directory:', tmpDir);
          }

          // Get source file path from the file attachment
          const sourcePath = (fileBlock.relativePath || '').trim(); // This is the full path from Electron
          // IMPORTANT: Use path.basename() to extract only the filename, not the full path
          const fallbackFilename = fileBlock.filename || sourcePath || `attachment-${Date.now()}`;
          const destFilename = path.basename(fallbackFilename);
          const destPath = path.join(tmpDir, destFilename);
          let actualSize = 0;

          // Copy file to .tmp directory
          if (sourcePath && fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, destPath);

            // Get actual file size
            const stats = fs.statSync(destPath);
            actualSize = stats.size;

            log('[SessionManager] Copied file:', sourcePath, '->', destPath, `(${actualSize} bytes)`);
          } else if (fileBlock.inlineDataBase64) {
            const buffer = Buffer.from(fileBlock.inlineDataBase64, 'base64');
            fs.writeFileSync(destPath, buffer);
            actualSize = buffer.length;
            log('[SessionManager] Wrote file from inline data:', destPath, `(${actualSize} bytes)`);
          } else {
            logError('[SessionManager] Source file not found and inline data missing:', sourcePath || '(empty path)');
            // Skip this file attachment
            continue;
          }

          // If sandbox is already initialized, sync the file to sandbox as well
          // This handles the case where user attaches files in subsequent messages
          const sandboxPath = SandboxSync.getSandboxPath(session.id);
          if (sandboxPath) {
            const sandboxRelativePath = `.tmp/${destFilename}`;
            log('[SessionManager] Syncing attached file to sandbox:', sandboxRelativePath);
            const syncResult = await SandboxSync.syncFileToSandbox(session.id, destPath, sandboxRelativePath);
            if (syncResult.success) {
              log('[SessionManager] File synced to sandbox:', syncResult.sandboxPath);
            } else {
              logError('[SessionManager] Failed to sync file to sandbox:', syncResult.error);
              // Continue anyway - file is in Windows .tmp, agent might still work via /mnt/
            }
          } else {
            // Check for Lima sandbox
            const { LimaSync } = await import('../sandbox/lima-sync');
            const limaSandboxPath = LimaSync.getSandboxPath(session.id);
            if (limaSandboxPath) {
              const sandboxRelativePath = `.tmp/${destFilename}`;
              log('[SessionManager] Syncing attached file to Lima sandbox:', sandboxRelativePath);
              const syncResult = await LimaSync.syncFileToSandbox(session.id, destPath, sandboxRelativePath);
              if (syncResult.success) {
                log('[SessionManager] File synced to Lima sandbox:', syncResult.sandboxPath);
              } else {
                logError('[SessionManager] Failed to sync file to Lima sandbox:', syncResult.error);
                // Continue anyway - file is in macOS .tmp, agent might still work via direct access
              }
            }
          }

          // Update the content block with the new relative path and actual size
          const relativePathFromCwd = path.join('.tmp', destFilename);
          const restFileBlock = { ...fileBlock };
          delete restFileBlock.inlineDataBase64;
          processedContent.push({
            ...restFileBlock,
            relativePath: relativePathFromCwd,
            size: actualSize,
          });
        } catch (error) {
          logError('[SessionManager] Error copying file:', error);
          // Skip this file attachment
        }
      } else {
        // Keep other content blocks as-is
        processedContent.push(block);
      }
    }

    return processedContent;
  }

  // Process a prompt using ClaudeAgentRunner
  private async processPrompt(session: Session, prompt: string, content?: ContentBlock[]): Promise<void> {
    log('[SessionManager] Processing prompt for session:', session.id);
    log('[SessionManager] Received content:', content ? JSON.stringify(content.map((c: any) => ({ type: c.type, hasData: !!c.source?.data }))) : 'none');

    // Ensure sandbox is initialized for this workspace
    await this.ensureSandboxInitialized(session);

    try {
      // Use provided content blocks or fall back to simple text
      let messageContent: ContentBlock[] = content && content.length > 0
        ? content
        : [{ type: 'text', text: prompt } as TextContent];

      // Process file attachments - copy to .tmp directory
      messageContent = await this.processFileAttachments(session, messageContent);

      log('[SessionManager] Final message content types:', messageContent.map((c: any) => c.type));

      // Build enhanced prompt with file information
      let enhancedPrompt = prompt;
      const fileAttachments = messageContent.filter(c => c.type === 'file_attachment') as FileAttachmentContent[];
      if (fileAttachments.length > 0) {
        const fileInfo = fileAttachments.map(f =>
          `- ${f.filename} (${(f.size / 1024).toFixed(1)} KB) at path: ${f.relativePath}`
        ).join('\n');
        enhancedPrompt = `${prompt}\n\n[Attached files - use Read tool to access them]:\n${fileInfo}`;
        log('[SessionManager] Enhanced prompt with file info:', enhancedPrompt);
      }

      // Save user message to database for persistence
      const existingMessages = this.getMessages(session.id);
      const userMessage: Message = {
        id: uuidv4(),
        sessionId: session.id,
        role: 'user',
        content: messageContent, // Save full content including images and files
        timestamp: Date.now(),
      };
      this.saveMessage(userMessage);
      log('[SessionManager] User message saved:', userMessage.id, 'with', messageContent.length, 'content blocks');
      const messagesForContext = [...existingMessages, userMessage];

      // Update session model to match current config (may have changed since session creation)
      const currentModel = configStore.get('model');
      if (currentModel && currentModel !== session.model) {
        session.model = currentModel;
        this.db.sessions.update(session.id, { model: currentModel });
        this.sendToRenderer({
          type: 'session.update',
          payload: { sessionId: session.id, updates: { model: currentModel } },
        });
      }

      // Run the agent
      await this.agentRunner.run(session, enhancedPrompt, messagesForContext);

      // 标题生成不再与首轮对话并发，避免与主请求竞争同一上游配额/通道导致体感变慢。
      this.runSessionTitleGeneration(session, prompt, existingMessages)
        .catch(err => logError('[SessionManager] Title generation failed:', err));
    } catch (error) {
      logError('[SessionManager] Error processing prompt:', error);
      const errorText = error instanceof Error ? error.message : 'Unknown error';
      const alreadyReportedToUser = Boolean(
        error &&
        typeof error === 'object' &&
        (error as { alreadyReportedToUser?: boolean }).alreadyReportedToUser
      );
      if (!alreadyReportedToUser) {
        const assistantMessage: Message = {
          id: uuidv4(),
          sessionId: session.id,
          role: 'assistant',
          content: [{ type: 'text', text: `**Error**: ${errorText}` }],
          timestamp: Date.now(),
        };
        this.saveMessage(assistantMessage);
        this.sendToRenderer({
          type: 'stream.message',
          payload: { sessionId: session.id, message: assistantMessage },
        });
      }
      this.sendToRenderer({
        type: 'error',
        payload: { message: errorText },
      });
    }
  }

  private async runSessionTitleGeneration(session: Session, prompt: string, existingMessages: Message[]): Promise<void> {
    const token = Symbol(`title:${session.id}`);
    this.titleGenerationTokens.set(session.id, token);
    const shouldAbort = () => {
      if (this.titleGenerationTokens.get(session.id) !== token) {
        return true;
      }
      return !this.db.sessions.get(session.id);
    };
    const userMessageCount = existingMessages.filter((message) => message.role === 'user').length;
    try {
      await maybeGenerateSessionTitle({
        sessionId: session.id,
        prompt,
        userMessageCount,
        currentTitle: session.title,
        hasAttempted: this.sessionTitleAttempts.has(session.id),
        generateTitle: async (titlePrompt) => {
          if (shouldAbort()) {
            return null;
          }
          const title = await this.withTimeout(
            this.generateTitleWithConfig(titlePrompt, session.cwd),
            TITLE_GENERATION_TIMEOUT_MS,
            session.id
          );
          return normalizeGeneratedTitle(title);
        },
        getLatestTitle: () => this.db.sessions.get(session.id)?.title ?? null,
        markAttempt: () => {
          this.sessionTitleAttempts.add(session.id);
        },
        updateTitle: async (title) => {
          if (shouldAbort()) {
            log('[SessionTitle] Skip update: session no longer active', session.id);
            return;
          }
          session.title = title;
          this.updateSessionTitle(session.id, title);
        },
        shouldAbort,
        log,
      });
    } catch (error) {
      logError('[SessionTitle] Unexpected error', session.id, error);
    } finally {
      if (this.titleGenerationTokens.get(session.id) === token) {
        this.titleGenerationTokens.delete(session.id);
      }
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, sessionId: string): Promise<T | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        logError('[SessionTitle] Generation timed out', { sessionId, timeoutMs });
        resolve(null);
      }, timeoutMs);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          logError('[SessionTitle] Generation rejected', { sessionId, error });
          resolve(null);
        });
    });
  }

  private async generateTitleWithConfig(titlePrompt: string, cwd?: string): Promise<string | null> {
    // Always use pi-ai SDK for title generation
    return normalizeGeneratedTitle(await generateTitleWithClaudeSdk(titlePrompt, configStore.getAll(), cwd));
  }

  private enqueuePrompt(session: Session, prompt: string, content?: ContentBlock[]): void {
    const queue = this.promptQueues.get(session.id) || [];
    queue.push({ prompt, content });
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

        const item = queue.shift();
        if (!item) continue;

        const latestSession = this.loadSession(session.id);
        if (!latestSession) {
          log('[SessionManager] Session removed while processing queue:', session.id);
          break;
        }

        await this.processPrompt(latestSession, item.prompt, item.content);

        if (controller.signal.aborted) break;
      }
    } finally {
      this.activeSessions.delete(session.id);
      const queue = this.promptQueues.get(session.id);
      if (queue && queue.length === 0) {
        this.promptQueues.delete(session.id);
      }
      this.updateSessionStatus(session.id, 'idle');
      const pendingQueue = this.promptQueues.get(session.id);
      if (pendingQueue && pendingQueue.length > 0) {
        const latestSession = this.loadSession(session.id);
        if (latestSession) {
          log('[SessionManager] Restarting queued prompts after stop/drain:', session.id);
          void this.processQueue(latestSession);
        } else {
          this.promptQueues.delete(session.id);
        }
      }
    }
  }

  // Stop a running session
  stopSession(sessionId: string): void {
    log('[SessionManager] Stopping session:', sessionId);
    this.titleGenerationTokens.delete(sessionId);
    this.agentRunner.cancel(sessionId);
    // Cancel any pending sudo password requests for this session
    for (const [toolUseId, entry] of this.pendingSudoPasswords) {
      if (entry.sessionId === sessionId) {
        entry.resolve(null);
        this.pendingSudoPasswords.delete(toolUseId);
        this.sendToRenderer({ type: 'sudo.password.dismiss', payload: { toolUseId } });
      }
    }
    // Also abort any pending controller we tracked
    const controller = this.activeSessions.get(sessionId);
    if (controller) {
      controller.abort();
    }
    this.promptQueues.delete(sessionId);
    this.updateSessionStatus(sessionId, 'idle');
  }

  // Delete a session
  async deleteSession(sessionId: string): Promise<void> {
    // Stop if running
    this.stopSession(sessionId);

    // Sync and cleanup sandbox if it exists for this session
    if (SandboxSync.hasSession(sessionId)) {
      log('[SessionManager] Cleaning up sandbox for session:', sessionId);
      try {
        await SandboxSync.syncAndCleanup(sessionId);
        log('[SessionManager] Sandbox cleanup complete for session:', sessionId);
      } catch (error) {
        logError('[SessionManager] Failed to cleanup sandbox:', error);
        // Continue with session deletion even if sandbox cleanup fails
      }
    }

    // Delete from database (messages will be deleted automatically via CASCADE)
    this.db.sessions.delete(sessionId);
    this.messageCache.delete(sessionId);
    this.sessionTitleAttempts.delete(sessionId);
    this.titleGenerationTokens.delete(sessionId);
    
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

  private updateSessionTitle(sessionId: string, title: string): void {
    if (!this.db.sessions.get(sessionId)) {
      log('[SessionTitle] Skip title update for deleted session:', sessionId);
      return;
    }
    this.db.sessions.update(sessionId, { title });
    this.sendToRenderer({
      type: 'session.update',
      payload: { sessionId, updates: { title } },
    });
  }

  // Update session's working directory
  // Also clears SDK session cache because Claude SDK sessions are bound to cwd
  updateSessionCwd(sessionId: string, cwd: string): void {
    if (this.activeSessions.has(sessionId)) {
      logWarn('[SessionManager] CWD change requested while session running; stopping active run first', { sessionId, cwd });
      this.stopSession(sessionId);
    }
    const mountedPaths = this.buildMountedPaths(cwd);
    // Clear claude_session_id in DB so next query creates a new SDK session
    // (Claude SDK sessions cannot change cwd mid-session)
    this.db.sessions.update(sessionId, { 
      cwd, 
      mounted_paths: JSON.stringify(mountedPaths),
      claude_session_id: null,
      openai_thread_id: null,
      updated_at: Date.now() 
    });
    
    // Also clear the in-memory SDK session cache
    if (this.agentRunner?.clearSdkSession) {
      this.agentRunner.clearSdkSession(sessionId);
    }

    this.sendToRenderer({
      type: 'session.update',
      payload: { sessionId, updates: { cwd, mountedPaths } },
    });
    
    log('[SessionManager] Session cwd updated:', sessionId, '->', cwd, '(SDK session cleared)');
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
    const cached = this.messageCache.get(message.sessionId);
    if (cached) {
      cached.push(message);
    }
    
    log('[SessionManager] Message saved:', message.id, 'role:', message.role);
  }

  // Get messages for a session
  getMessages(sessionId: string): Message[] {
    const cached = this.messageCache.get(sessionId);
    if (cached) {
      return [...cached];
    }

    const rows = this.db.messages.getBySessionId(sessionId);
    const messages = rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role as Message['role'],
      content: this.normalizeContent(row.content),
      timestamp: row.timestamp,
      tokenUsage: row.token_usage ? JSON.parse(row.token_usage) : undefined,
    }));
    this.messageCache.set(sessionId, messages);
    return [...messages];
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

  // Request sudo password from the user
  async requestSudoPassword(
    sessionId: string,
    toolUseId: string,
    command: string
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingSudoPasswords.delete(toolUseId);
        resolve(null);
        this.sendToRenderer({ type: 'sudo.password.dismiss', payload: { toolUseId } });
      }, 60_000);
      this.pendingSudoPasswords.set(toolUseId, {
        sessionId,
        resolve: (password: string | null) => {
          clearTimeout(timeout);
          resolve(password);
        },
      });
      this.sendToRenderer({
        type: 'sudo.password.request',
        payload: { toolUseId, command, sessionId },
      });
    });
  }

  // Handle sudo password response from renderer
  handleSudoPasswordResponse(toolUseId: string, password: string | null): void {
    const entry = this.pendingSudoPasswords.get(toolUseId);
    if (entry) {
      entry.resolve(password);
      this.pendingSudoPasswords.delete(toolUseId);
    }
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
