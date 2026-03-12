import {
  createAgentSession,
  SessionManager as PiSessionManager,
  SettingsManager as PiSettingsManager,
  createCodingTools,
  type AgentSession as PiAgentSession,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent';
import { Type, type TSchema } from '@sinclair/typebox';
import { getSharedAuthStorage, ModelRegistry } from './shared-auth';
import type { Session, Message, TraceStep, ServerEvent, ContentBlock } from '../../renderer/types';
import { v4 as uuidv4 } from 'uuid';
import { PathResolver } from '../sandbox/path-resolver';
import { MCPManager } from '../mcp/mcp-manager';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import { credentialsStore, type UserCredential } from '../credentials/credentials-store';
import { log, logWarn, logError } from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { setMaxListeners } from 'node:events';
import { getSandboxAdapter } from '../sandbox/sandbox-adapter';
import { pathConverter } from '../sandbox/wsl-bridge';
import { SandboxSync } from '../sandbox/sandbox-sync';
import { extractArtifactsFromText, buildArtifactTraceSteps } from '../utils/artifact-parser';
import { PluginRuntimeService } from '../skills/plugin-runtime-service';
import type { SkillsAdapter } from '../skills/skills-adapter';
import { configStore } from '../config/config-store';
import { buildSyntheticPiModel, resolvePiRegistryModel } from './pi-model-resolution';

// Virtual workspace path shown to the model (hides real sandbox path)
const VIRTUAL_WORKSPACE_PATH = '/workspace';

// Bundled node/npx paths never change at runtime — resolve once.
let cachedBundledNodePaths: { node: string; npx: string } | null | undefined = undefined;

function getBundledNodePaths(): { node: string; npx: string } | null {
  if (cachedBundledNodePaths !== undefined) {
    return cachedBundledNodePaths;
  }
  const platform = process.platform;
  const arch = process.arch;
  let resourcesPath: string;
  if (process.env.NODE_ENV === 'development') {
    const projectRoot = path.join(__dirname, '..', '..');
    resourcesPath = path.join(projectRoot, 'resources', 'node', `${platform}-${arch}`);
  } else {
    resourcesPath = path.join(process.resourcesPath, 'node');
  }
  const binDir = platform === 'win32' ? resourcesPath : path.join(resourcesPath, 'bin');
  const nodePath = path.join(binDir, platform === 'win32' ? 'node.exe' : 'node');
  const npxPath = path.join(binDir, platform === 'win32' ? 'npx.cmd' : 'npx');
  cachedBundledNodePaths = (fs.existsSync(nodePath) && fs.existsSync(npxPath))
    ? { node: nodePath, npx: npxPath }
    : null;
  return cachedBundledNodePaths;
}

// Shared pi-ai auth storage — created once, reused across sessions.

/**
 * Bridge MCP tools from MCPManager into pi-coding-agent ToolDefinition[] format.
 * Each MCP tool becomes a customTool whose execute() delegates to mcpManager.callTool().
 */
function buildMcpCustomTools(mcpManager: MCPManager): ToolDefinition[] {
  const mcpTools = mcpManager.getTools();
  return mcpTools.map((mcpTool) => {
    // Wrap the raw JSON Schema inputSchema as a TypeBox TSchema
    const parameters = Type.Unsafe<Record<string, any>>(mcpTool.inputSchema as any);

    const toolDef: ToolDefinition<TSchema, unknown> = {
      name: mcpTool.name,
      label: mcpTool.name.replace(/^mcp__/, '').replace(/__/g, ' → '),
      description: mcpTool.description || `MCP tool from ${mcpTool.serverName}`,
      parameters,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        try {
          const result = await mcpManager.callTool(mcpTool.name, params as Record<string, any>);
          // MCP callTool returns { content: [...] } — extract text
          const textParts: string[] = [];
          if (result?.content) {
            for (const part of result.content) {
              if (part.type === 'text') textParts.push(part.text);
              else textParts.push(JSON.stringify(part));
            }
          } else {
            textParts.push(typeof result === 'string' ? result : JSON.stringify(result));
          }
          return {
            content: [{ type: 'text' as const, text: textParts.join('\n') }],
            details: undefined as unknown,
          };
        } catch (err: any) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logError(`[ClaudeAgentRunner] MCP tool ${mcpTool.name} failed:`, err);
          return {
            content: [{ type: 'text' as const, text: `MCP tool error: ${errMsg}` }],
            details: undefined as unknown,
          };
        }
      },
    };
    return toolDef;
  });
}

/**
 * Get shell environment with proper PATH (including node, npm, etc.)
 * GUI apps on macOS don't inherit shell PATH, so we need to extract it
 */

function safeStringify(value: unknown, space = 0): string {
  try {
    return JSON.stringify(value, null, space);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return `[Unserializable: ${details}]`;
  }
}


function toErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }
  }
  const serialized = safeStringify(error);
  if (serialized.startsWith('[Unserializable:')) {
    return String(error);
  }
  return serialized;
}

function toUserFacingErrorText(errorText: string): string {
  if (errorText.toLowerCase().includes('first_response_timeout')) {
    return '模型响应超时：长时间未收到上游返回，请稍后重试或检查当前模型/网关负载。';
  }
  if (errorText.toLowerCase().includes('empty_success_result')) {
    return '模型返回了一个空的成功结果，当前模型或网关兼容性可能有问题，请重试或切换协议后再试。';
  }
  return errorText;
}












interface AgentRunnerOptions {
  sendToRenderer: (event: ServerEvent) => void;
  saveMessage?: (message: Message) => void;
}

/**
 * ClaudeAgentRunner - Uses @anthropic-ai/claude-agent-sdk with allowedTools
 * 
 * Environment variables should be set before running:
 *   ANTHROPIC_BASE_URL=https://openrouter.ai/api
 *   ANTHROPIC_AUTH_TOKEN=your_openrouter_api_key
 *   ANTHROPIC_API_KEY="" (must be empty)
 */
export class ClaudeAgentRunner {
  private sendToRenderer: (event: ServerEvent) => void;
  private saveMessage?: (message: Message) => void;
  private pathResolver: PathResolver;
  private mcpManager?: MCPManager;
  // @ts-expect-error stored for future plugin support
  private _pluginRuntimeService?: PluginRuntimeService;
  private _skillsAdapter?: SkillsAdapter;
  private activeControllers: Map<string, AbortController> = new Map();
  private piSessions: Map<string, PiAgentSession> = new Map(); // sessionId -> pi AgentSession
  private localDesktopAdapter: any = null; // LocalDesktopAdapter instance (lazy-loaded)

  // Per-instance caches — invalidated when the underlying config changes.
  private _mcpServersCache: { fingerprint: string; servers: Record<string, unknown> } | null = null;
  private _skillsSetupDone = false;

  /**
   * Clear SDK session cache for a session
   * Called when session's cwd changes - SDK sessions are bound to cwd
   */
  clearSdkSession(sessionId: string): void {
    const piSession = this.piSessions.get(sessionId);
    if (piSession) {
      piSession.dispose();
      this.piSessions.delete(sessionId);
      log('[ClaudeAgentRunner] Disposed pi session for:', sessionId);
    }
  }

  /** Call after the user installs / removes a skill so the next query re-links everything. */
  invalidateSkillsSetup(): void {
    this._skillsSetupDone = false;
  }

  /** Call after the user changes MCP server config so the next query rebuilds mcpServers. */
  invalidateMcpServersCache(): void {
    this._mcpServersCache = null;
  }

  /**
   * Get saved credentials prompt for system instructions
   * Credentials are provided directly to the agent for automated login
   */
  private getCredentialsPrompt(): string {
    try {
      const credentials = credentialsStore.getAll();
      if (credentials.length === 0) {
        return '';
      }

      // Group credentials by type
      const emailCredentials = credentials.filter(c => c.type === 'email');
      const websiteCredentials = credentials.filter(c => c.type === 'website');
      const apiCredentials = credentials.filter(c => c.type === 'api');
      const otherCredentials = credentials.filter(c => c.type === 'other');

      // Format credentials with actual password for agent use
      const formatCredential = (c: UserCredential) => {
        const lines = [`- **${c.name}**${c.service ? ` (${c.service})` : ''}`];
        lines.push(`  - Username/Email: \`${c.username}\``);
        lines.push(`  - Password: \`${c.password}\``);
        if (c.url) lines.push(`  - URL: ${c.url}`);
        if (c.notes) lines.push(`  - Notes: ${c.notes}`);
        return lines.join('\n');
      };

      let sections: string[] = [];
      
      if (emailCredentials.length > 0) {
        sections.push(`**Email Accounts (${emailCredentials.length}):**\n${emailCredentials.map(formatCredential).join('\n\n')}`);
      }
      if (websiteCredentials.length > 0) {
        sections.push(`**Website Accounts (${websiteCredentials.length}):**\n${websiteCredentials.map(formatCredential).join('\n\n')}`);
      }
      if (apiCredentials.length > 0) {
        sections.push(`**API Keys (${apiCredentials.length}):**\n${apiCredentials.map(formatCredential).join('\n\n')}`);
      }
      if (otherCredentials.length > 0) {
        sections.push(`**Other Credentials (${otherCredentials.length}):**\n${otherCredentials.map(formatCredential).join('\n\n')}`);
      }

      return `
<saved_credentials>
The user has saved ${credentials.length} credential(s) for automated login. Use these credentials when the user asks you to access their accounts.

${sections.join('\n\n')}

**IMPORTANT - How to use credentials:**
- Use these credentials directly when logging into websites or services
- For email access (e.g., Gmail), use the Chrome MCP tools to navigate to the login page and enter the credentials
- NEVER display, share, or echo passwords in your responses to the user
- Only use credentials for tasks the user explicitly requests
- If login fails, inform the user but do not expose the password
</saved_credentials>
`;
    } catch (error) {
      logError('[AgentRunner] Failed to get credentials prompt:', error);
      return '';
    }
  }

  /** Fallback skill path resolution when SkillsAdapter is not provided. */
  private legacySkillPaths(): string[] {
    const paths: string[] = [];
    const builtin = this.getBuiltinSkillsPath();
    if (builtin && fs.existsSync(builtin)) paths.push(builtin);
    const global = this.getConfiguredGlobalSkillsDir();
    if (global && fs.existsSync(global)) paths.push(global);
    return paths;
  }

  /**
   * Get the built-in skills directory (shipped with the app)
   */
  private getBuiltinSkillsPath(): string {
    // In development, skills are in the project's .claude/skills directory
    // In production, they're bundled with the app (in app.asar.unpacked for asarUnpack files)
    const appPath = app.getAppPath();
    
    // For asarUnpack files, replace .asar with .asar.unpacked
    const unpackedPath = appPath.replace(/\.asar$/, '.asar.unpacked');
    
    const possiblePaths = [
      // Development: relative to this file
      path.join(__dirname, '..', '..', '..', '.claude', 'skills'),
      // Production: in app.asar.unpacked (for asarUnpack files)
      path.join(unpackedPath, '.claude', 'skills'),
      // Fallback: in app resources (if not unpacked)
      path.join(appPath, '.claude', 'skills'),
      // Alternative: in resources folder
      path.join(process.resourcesPath || '', 'skills'),
    ];
    
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        log('[ClaudeAgentRunner] Found built-in skills at:', p);
        return p;
      }
    }
    
    logWarn('[ClaudeAgentRunner] No built-in skills directory found');
    return '';
  }

  private getAppClaudeDir(): string {
    return path.join(app.getPath('userData'), 'claude');
  }

  private getRuntimeSkillsDir(): string {
    return path.join(this.getAppClaudeDir(), 'skills');
  }

  private getConfiguredGlobalSkillsDir(): string {
    const configuredPath = (configStore.get('globalSkillsPath') || '').trim();
    if (!configuredPath) {
      return this.getRuntimeSkillsDir();
    }

    const resolvedPath = path.resolve(configuredPath);
    try {
      if (!fs.existsSync(resolvedPath)) {
        fs.mkdirSync(resolvedPath, { recursive: true });
      }
      if (fs.statSync(resolvedPath).isDirectory()) {
        return resolvedPath;
      }
      logWarn('[ClaudeAgentRunner] Configured skills path is not a directory, fallback to runtime path:', resolvedPath);
    } catch (error) {
      logWarn('[ClaudeAgentRunner] Configured skills path is unavailable, fallback to runtime path:', resolvedPath, error);
    }

    return this.getRuntimeSkillsDir();
  }

  private getUserClaudeSkillsDir(): string {
    return path.join(app.getPath('home'), '.claude', 'skills');
  }

  private syncUserSkillsToAppDir(appSkillsDir: string): void {
    const userSkillsDir = this.getUserClaudeSkillsDir();
    if (!fs.existsSync(userSkillsDir)) {
      return;
    }

    const entries = fs.readdirSync(userSkillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sourcePath = path.join(userSkillsDir, entry.name);
      const targetPath = path.join(appSkillsDir, entry.name);

      if (fs.existsSync(targetPath)) {
        try {
          const stat = fs.lstatSync(targetPath);
          if (!stat.isSymbolicLink()) {
            continue;
          }
          fs.unlinkSync(targetPath);
        } catch {
          continue;
        }
      }

      try {
        fs.symlinkSync(sourcePath, targetPath, 'dir');
      } catch (err) {
        try {
          this.copyDirectorySync(sourcePath, targetPath);
        } catch (copyErr) {
          logWarn('[ClaudeAgentRunner] Failed to import user skill:', entry.name, copyErr);
        }
      }
    }
  }

  private syncConfiguredSkillsToRuntimeDir(runtimeSkillsDir: string): void {
    const configuredSkillsDir = this.getConfiguredGlobalSkillsDir();
    if (configuredSkillsDir === runtimeSkillsDir) {
      return;
    }
    if (!fs.existsSync(configuredSkillsDir) || !fs.statSync(configuredSkillsDir).isDirectory()) {
      return;
    }

    const entries = fs.readdirSync(configuredSkillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sourcePath = path.join(configuredSkillsDir, entry.name);
      const targetPath = path.join(runtimeSkillsDir, entry.name);
      try {
        if (fs.existsSync(targetPath)) {
          fs.rmSync(targetPath, { recursive: true, force: true });
        }
        fs.symlinkSync(sourcePath, targetPath, 'dir');
      } catch (err) {
        try {
          this.copyDirectorySync(sourcePath, targetPath);
        } catch (copyErr) {
          logWarn('[ClaudeAgentRunner] Failed to sync configured skill:', entry.name, copyErr);
        }
      }
    }
  }

  private copyDirectorySync(source: string, target: string): void {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    const entries = fs.readdirSync(source);
    for (const entry of entries) {
      const sourcePath = path.join(source, entry);
      const targetPath = path.join(target, entry);
      const stat = fs.statSync(sourcePath);

      if (stat.isDirectory()) {
        this.copyDirectorySync(sourcePath, targetPath);
      } else {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }

  constructor(
    options: AgentRunnerOptions,
    pathResolver: PathResolver,
    mcpManager?: MCPManager,
    pluginRuntimeService?: PluginRuntimeService,
    skillsAdapter?: SkillsAdapter
  ) {
    this.sendToRenderer = options.sendToRenderer;
    this.saveMessage = options.saveMessage;
    this.pathResolver = pathResolver;
    this.mcpManager = mcpManager;
    this._pluginRuntimeService = pluginRuntimeService;
    this._skillsAdapter = skillsAdapter;
    
    log('[ClaudeAgentRunner] Initialized with pi-coding-agent SDK');
    log('[ClaudeAgentRunner] Skills enabled: settingSources=[user, project], Skill tool enabled');
    if (mcpManager) {
      log('[ClaudeAgentRunner] MCP support enabled');
    }
  }
  
  /**
   * Resolve current model string from runtime config.
   */
  private getCurrentModelString(preferredModel?: string): string {
    const routeModel = preferredModel?.trim();
    const configuredModel = configStore.get('model')?.trim();
    const model = routeModel
      || configuredModel
      || 'anthropic/claude-sonnet-4';
    log('[ClaudeAgentRunner] Current model:', model);
    log('[ClaudeAgentRunner] Model source:', routeModel ? 'runtimeRoute.model' : configuredModel ? 'configStore.model' : 'default');
    return model;
  }

  async run(session: Session, prompt: string, existingMessages: Message[]): Promise<void> {
    const startTime = Date.now();
    const logTiming = (label: string) => {
      log(`[TIMING] ${label}: ${Date.now() - startTime}ms`);
    };
    
    logTiming('run() started');
    
    const controller = new AbortController();
    try {
      // SDK 会在同一 AbortSignal 上挂载较多监听器，放开上限避免无意义告警干扰排错。
      setMaxListeners(0, controller.signal);
    } catch {
      // 旧运行时不支持 EventTarget 调整监听上限时忽略即可。
    }
    this.activeControllers.set(session.id, controller);

    // Sandbox isolation state (defined outside try for finally access)
    let sandboxPath: string | null = null;
    let useSandboxIsolation = false;
    
    // Helper to convert real sandbox paths back to virtual workspace paths in output
    const sanitizeOutputPaths = (content: string): string => {
      if (!sandboxPath || !useSandboxIsolation) return content;
      // Replace real sandbox path with virtual workspace path
      return content.replace(new RegExp(sandboxPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), VIRTUAL_WORKSPACE_PATH);
    };

    try {
      this.pathResolver.registerSession(session.id, session.mountedPaths);
      logTiming('pathResolver.registerSession');

      // Note: User message is now added by the frontend immediately for better UX
      // No need to send it again from backend

      // Send initial thinking trace
      const thinkingStepId = uuidv4();
      this.sendTraceStep(session.id, {
        id: thinkingStepId,
        type: 'thinking',
        status: 'running',
        title: 'Processing request...',
        timestamp: Date.now(),
      });
      logTiming('sendTraceStep (thinking)');

      // Use session's cwd - each session has its own working directory
      const workingDir = session.cwd || undefined;
      log('[ClaudeAgentRunner] Working directory:', workingDir || '(none)');

      // Initialize sandbox sync if WSL mode is active
      const sandbox = getSandboxAdapter();

      if (sandbox.isWSL && sandbox.wslStatus?.distro && workingDir) {
        log('[ClaudeAgentRunner] WSL mode active, initializing sandbox sync...');
        
        // Only show sync UI for new sessions (first message)
        const isNewSession = !SandboxSync.hasSession(session.id);
        
        if (isNewSession) {
          // Notify UI: syncing files (only for new sessions)
          this.sendToRenderer({
            type: 'sandbox.sync',
            payload: {
              sessionId: session.id,
              phase: 'syncing_files',
              message: 'Syncing files to sandbox...',
              detail: 'Copying project files to isolated WSL environment',
            },
          });
        }
        
        const syncResult = await SandboxSync.initSync(
          workingDir,
          session.id,
          sandbox.wslStatus.distro
        );

        if (syncResult.success) {
          sandboxPath = syncResult.sandboxPath;
          useSandboxIsolation = true;
          log(`[ClaudeAgentRunner] Sandbox initialized: ${sandboxPath}`);
          log(`[ClaudeAgentRunner]   Files: ${syncResult.fileCount}, Size: ${syncResult.totalSize} bytes`);
          
          if (isNewSession) {
            // Update UI with file count (only for new sessions)
            this.sendToRenderer({
            type: 'sandbox.sync',
            payload: {
              sessionId: session.id,
              phase: 'syncing_skills',
              message: 'Configuring skills...',
              detail: 'Copying built-in skills to sandbox',
              fileCount: syncResult.fileCount,
              totalSize: syncResult.totalSize,
            },
          });
          }

          // Copy skills to sandbox ~/.claude/skills/
          const builtinSkillsPath = this.getBuiltinSkillsPath();
          try {
            const distro = sandbox.wslStatus!.distro!;
            const sandboxSkillsPath = `${sandboxPath}/.claude/skills`;

            // Create .claude/skills directory in sandbox
            const { execSync } = require('child_process');
            execSync(`wsl -d ${distro} -e mkdir -p "${sandboxSkillsPath}"`, {
              encoding: 'utf-8',
              timeout: 10000
            });

            if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
              // Use rsync to recursively copy all skills (much faster and handles subdirectories)
              const wslSourcePath = pathConverter.toWSL(builtinSkillsPath);
              const rsyncCmd = `rsync -av "${wslSourcePath}/" "${sandboxSkillsPath}/"`;
              log(`[ClaudeAgentRunner] Copying skills with rsync: ${rsyncCmd}`);

              execSync(`wsl -d ${distro} -e bash -c "${rsyncCmd}"`, {
                encoding: 'utf-8',
                timeout: 120000  // 2 min timeout for large skill directories
              });
            }

            const appSkillsDir = this.getRuntimeSkillsDir();
            if (!fs.existsSync(appSkillsDir)) {
              fs.mkdirSync(appSkillsDir, { recursive: true });
            }
            this.syncUserSkillsToAppDir(appSkillsDir);
            this.syncConfiguredSkillsToRuntimeDir(appSkillsDir);

            if (fs.existsSync(appSkillsDir)) {
              const wslSourcePath = pathConverter.toWSL(appSkillsDir);
              const rsyncCmd = `rsync -avL "${wslSourcePath}/" "${sandboxSkillsPath}/"`;
              log(`[ClaudeAgentRunner] Copying app skills with rsync: ${rsyncCmd}`);

              execSync(`wsl -d ${distro} -e bash -c "${rsyncCmd}"`, {
                encoding: 'utf-8',
                timeout: 120000  // 2 min timeout for large skill directories
              });
            }

            // List copied skills for verification
            const copiedSkills = execSync(`wsl -d ${distro} -e ls "${sandboxSkillsPath}"`, {
              encoding: 'utf-8',
              timeout: 10000
            }).trim().split('\n').filter(Boolean);

            log(`[ClaudeAgentRunner] Skills copied to sandbox: ${sandboxSkillsPath}`);
            log(`[ClaudeAgentRunner]   Skills: ${copiedSkills.join(', ')}`);
          } catch (error) {
            logError('[ClaudeAgentRunner] Failed to copy skills to sandbox:', error);
          }
          
          if (isNewSession) {
            // Notify UI: sync complete (only for new sessions)
            this.sendToRenderer({
            type: 'sandbox.sync',
            payload: {
              sessionId: session.id,
              phase: 'ready',
              message: 'Sandbox ready',
              detail: `Synced ${syncResult.fileCount} files`,
              fileCount: syncResult.fileCount,
              totalSize: syncResult.totalSize,
            },
          });
          }
        } else {
          logError('[ClaudeAgentRunner] Sandbox sync failed:', syncResult.error);
          log('[ClaudeAgentRunner] Falling back to /mnt/ access (less secure)');
          
          if (isNewSession) {
            // Notify UI: error (only for new sessions)
            this.sendToRenderer({
            type: 'sandbox.sync',
            payload: {
              sessionId: session.id,
              phase: 'error',
              message: 'Sandbox sync failed',
              detail: 'Falling back to direct access mode (less secure)',
            },
          });
          }
        }
      }

      // Initialize sandbox sync if Lima mode is active
      if (sandbox.isLima && sandbox.limaStatus?.instanceRunning && workingDir) {
        log('[ClaudeAgentRunner] Lima mode active, initializing sandbox sync...');
        
        const { LimaSync } = await import('../sandbox/lima-sync');
        
        // Only show sync UI for new sessions (first message)
        const isNewLimaSession = !LimaSync.hasSession(session.id);
        
        if (isNewLimaSession) {
          // Notify UI: syncing files (only for new sessions)
          this.sendToRenderer({
            type: 'sandbox.sync',
            payload: {
              sessionId: session.id,
              phase: 'syncing_files',
              message: 'Syncing files to sandbox...',
              detail: 'Copying project files to isolated Lima environment',
            },
          });
        }
        
        const syncResult = await LimaSync.initSync(
          workingDir,
          session.id
        );

        if (syncResult.success) {
          sandboxPath = syncResult.sandboxPath;
          useSandboxIsolation = true;
          log(`[ClaudeAgentRunner] Sandbox initialized: ${sandboxPath}`);
          log(`[ClaudeAgentRunner]   Files: ${syncResult.fileCount}, Size: ${syncResult.totalSize} bytes`);
          
          if (isNewLimaSession) {
            // Update UI with file count (only for new sessions)
            this.sendToRenderer({
            type: 'sandbox.sync',
            payload: {
              sessionId: session.id,
              phase: 'syncing_skills',
              message: 'Configuring skills...',
              detail: 'Copying built-in skills to sandbox',
              fileCount: syncResult.fileCount,
              totalSize: syncResult.totalSize,
            },
          });
          }

          // Copy skills to sandbox ~/.claude/skills/
          const builtinSkillsPath = this.getBuiltinSkillsPath();
          try {
            const sandboxSkillsPath = `${sandboxPath}/.claude/skills`;

            // Create .claude/skills directory in sandbox
            const { execSync } = require('child_process');
            execSync(`limactl shell claude-sandbox -- mkdir -p "${sandboxSkillsPath}"`, {
              encoding: 'utf-8',
              timeout: 10000
            });

            if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
              // Use rsync to recursively copy all skills (much faster and handles subdirectories)
              // Lima mounts /Users directly, so paths are the same
              const rsyncCmd = `rsync -av "${builtinSkillsPath}/" "${sandboxSkillsPath}/"`;
              log(`[ClaudeAgentRunner] Copying skills with rsync: ${rsyncCmd}`);

              execSync(`limactl shell claude-sandbox -- bash -c "${rsyncCmd.replace(/"/g, '\\"')}"`, {
                encoding: 'utf-8',
                timeout: 120000  // 2 min timeout for large skill directories
              });
            }

            const appSkillsDir = this.getRuntimeSkillsDir();
            if (!fs.existsSync(appSkillsDir)) {
              fs.mkdirSync(appSkillsDir, { recursive: true });
            }
            this.syncUserSkillsToAppDir(appSkillsDir);
            this.syncConfiguredSkillsToRuntimeDir(appSkillsDir);

            if (fs.existsSync(appSkillsDir)) {
              const rsyncCmd = `rsync -avL "${appSkillsDir}/" "${sandboxSkillsPath}/"`;
              log(`[ClaudeAgentRunner] Copying app skills with rsync: ${rsyncCmd}`);

              execSync(`limactl shell claude-sandbox -- bash -c "${rsyncCmd.replace(/"/g, '\\"')}"`, {
                encoding: 'utf-8',
                timeout: 120000  // 2 min timeout for large skill directories
              });
            }

            // List copied skills for verification
            const copiedSkills = execSync(`limactl shell claude-sandbox -- ls "${sandboxSkillsPath}"`, {
              encoding: 'utf-8',
              timeout: 10000
            }).trim().split('\n').filter(Boolean);

            log(`[ClaudeAgentRunner] Skills copied to sandbox: ${sandboxSkillsPath}`);
            log(`[ClaudeAgentRunner]   Skills: ${copiedSkills.join(', ')}`);
          } catch (error) {
            logError('[ClaudeAgentRunner] Failed to copy skills to sandbox:', error);
          }
          
          if (isNewLimaSession) {
            // Notify UI: sync complete (only for new sessions)
            this.sendToRenderer({
            type: 'sandbox.sync',
            payload: {
              sessionId: session.id,
              phase: 'ready',
              message: 'Sandbox ready',
              detail: `Synced ${syncResult.fileCount} files`,
              fileCount: syncResult.fileCount,
              totalSize: syncResult.totalSize,
            },
          });
          }
        } else {
          logError('[ClaudeAgentRunner] Sandbox sync failed:', syncResult.error);
          log('[ClaudeAgentRunner] Falling back to direct access (less secure)');
          
          if (isNewLimaSession) {
            // Notify UI: error (only for new sessions)
            this.sendToRenderer({
            type: 'sandbox.sync',
            payload: {
              sessionId: session.id,
              phase: 'error',
              message: 'Sandbox sync failed',
              detail: 'Falling back to direct access mode (less secure)',
            },
          });
          }
        }
      }

      // Check if current user message includes images
      const lastUserMessage = existingMessages.length > 0
        ? existingMessages[existingMessages.length - 1]
        : null;

      log('[ClaudeAgentRunner] Total messages:', existingMessages.length);

      const hasImages = lastUserMessage?.content.some((c: any) => c.type === 'image') || false;
      if (hasImages) {
        log('[ClaudeAgentRunner] User message contains images');
      }

      logTiming('before pi-ai model resolution');

      // Resolve model via pi-ai
      const runtimeConfig = configStore.getAll();
      const modelString = this.getCurrentModelString(runtimeConfig.model);
      const configProtocol = runtimeConfig.customProtocol || runtimeConfig.provider || 'anthropic';
      let piModel = resolvePiRegistryModel(modelString, {
        configProvider: configProtocol,
        customBaseUrl: runtimeConfig.baseUrl?.trim() || undefined,
        rawProvider: runtimeConfig.provider,
      });

      if (!piModel) {
        // Synthetic fallback: construct a Model for unknown/custom models
        const parts = modelString.split('/');
        const syntheticId = parts.length >= 2 ? parts.slice(1).join('/') : modelString;
        const syntheticProvider = parts.length >= 2 ? parts[0] : (configProtocol === 'custom' ? 'anthropic' : configProtocol);
        piModel = buildSyntheticPiModel(syntheticId, syntheticProvider, configProtocol, runtimeConfig.baseUrl?.trim() || undefined);
        logWarn('[ClaudeAgentRunner] Model not in pi-ai registry, using synthetic model:', modelString, '→', piModel.api);
      }
      log('[ClaudeAgentRunner] Resolved pi-ai model:', piModel.provider, piModel.id);

      // Set up API keys via AuthStorage
      const authStorage = getSharedAuthStorage();
      const provider = runtimeConfig.provider || 'anthropic';
      const apiKey = runtimeConfig.apiKey?.trim();
      if (apiKey) {
        // Map our config provider to pi-ai provider name
        const piProvider = provider === 'custom'
          ? (runtimeConfig.customProtocol || 'anthropic')
          : provider;
        authStorage.setRuntimeApiKey(piProvider, apiKey);
        // Also set the key for the model's native provider (e.g., when using
        // google/gemini via openrouter, pi-ai looks up "google" not "openrouter")
        if (piModel.provider !== piProvider) {
          authStorage.setRuntimeApiKey(piModel.provider, apiKey);
          log('[ClaudeAgentRunner] Set runtime API key for model provider:', piModel.provider);
        }
        log('[ClaudeAgentRunner] Set runtime API key for config provider:', piProvider);
      } else {
        logWarn('[ClaudeAgentRunner] No API key configured for provider:', provider);
      }

      // baseUrl is now embedded in the model object via resolvePiModel()
      log('[ClaudeAgentRunner] Model baseUrl:', piModel.baseUrl, 'api:', piModel.api);

      logTiming('after pi-ai model resolution');

      // pi-coding-agent handles path sandboxing via its own tools
      const imageCapable = true; // pi-ai models generally support images; let the model handle unsupported cases

      // Use app-specific Claude config directory to avoid conflicts with user settings
      // SDK uses CLAUDE_CONFIG_DIR to locate skills
      const userClaudeDir = this.getAppClaudeDir();

      // Skills directory setup: only run on the first query per runner instance.
      // Symlinks and directories are stable across queries; re-running every time
      // wastes ~10-30 syscalls per query for no benefit. Call invalidateSkillsSetup()
      // to force a re-run after the user installs or removes a skill.
      if (!this._skillsSetupDone) {
        // Ensure app Claude config directory exists
        if (!fs.existsSync(userClaudeDir)) {
          fs.mkdirSync(userClaudeDir, { recursive: true });
        }

        // Ensure app Claude skills directory exists
        const appSkillsDir = this.getRuntimeSkillsDir();
        if (!fs.existsSync(appSkillsDir)) {
          fs.mkdirSync(appSkillsDir, { recursive: true });
        }

        // Copy built-in skills to app Claude skills directory if they don't exist
        const builtinSkillsPath = this.getBuiltinSkillsPath();
        if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
          const builtinSkills = fs.readdirSync(builtinSkillsPath);
          for (const skillName of builtinSkills) {
            const builtinSkillPath = path.join(builtinSkillsPath, skillName);
            const userSkillPath = path.join(appSkillsDir, skillName);

            // Only copy if it's a directory and doesn't exist in app directory
            if (fs.statSync(builtinSkillPath).isDirectory() && !fs.existsSync(userSkillPath)) {
              // Create symlink instead of copying to save space and allow updates
              try {
                fs.symlinkSync(builtinSkillPath, userSkillPath, 'dir');
                log(`[ClaudeAgentRunner] Linked built-in skill: ${skillName}`);
              } catch (err) {
                // If symlink fails (e.g., on Windows without permissions), copy the directory
                logWarn(`[ClaudeAgentRunner] Failed to symlink ${skillName}, copying instead:`, err);
                // We'll skip copying for now to keep it simple
              }
            }
          }
        }

        this.syncUserSkillsToAppDir(appSkillsDir);
        this.syncConfiguredSkillsToRuntimeDir(appSkillsDir);
        this._skillsSetupDone = true;
      }

      // Build available skills section dynamically — now handled by pi's DefaultResourceLoader
      // via additionalSkillPaths. No custom prompt building needed.

      log('[ClaudeAgentRunner] App claude dir:', userClaudeDir);
      log('[ClaudeAgentRunner] User working directory:', workingDir);

      logTiming('before building conversation context');

      // pi-ai handles auth and model routing natively — no proxy, no env overrides needed.
      log('[ClaudeAgentRunner] Using pi-ai native routing for:', piModel.provider, piModel.id);

      // Build conversation context for text-only history
      let contextualPrompt = prompt;
      const conversationMessages = existingMessages
        .filter(msg => msg.role === 'user' || msg.role === 'assistant');
      const historyMessages = (
        conversationMessages.length > 0
          && conversationMessages[conversationMessages.length - 1]?.role === 'user'
      )
        ? conversationMessages.slice(0, -1)
        : conversationMessages;
      const historyItems = historyMessages
        .map(msg => {
          const textContent = msg.content
            .filter(c => c.type === 'text')
            .map(c => (c as any).text)
            .join('\n');
          return `${msg.role === 'user' ? 'Human' : 'Assistant'}: ${textContent}`;
        });

      if (historyItems.length > 0 && !hasImages) {
        contextualPrompt = `${historyItems.join('\n')}\nHuman: ${prompt}\nAssistant:`;
        log('[ClaudeAgentRunner] Including', historyItems.length, 'history messages in context');
      }

      // ── Computer Use delegation ──────────────────────────────────
      // Check workEnvironment to determine if we should delegate to ComputerUseSession
      const { configStore: configStoreRef } = await import('../config/config-store');
      const workEnvironment = configStoreRef.get('workEnvironment');
      if (workEnvironment === 'real-machine') {
        try {
          const { LocalDesktopAdapter } = await import('../vm/local-desktop-adapter');
          const { ComputerUseSession } = await import('../vm/computer-use-session');

          if (!this.localDesktopAdapter) {
            this.localDesktopAdapter = new LocalDesktopAdapter();
          }
          log('[ClaudeAgentRunner] Delegating to ComputerUseSession for local desktop');
          logTiming('ComputerUseSession local desktop delegation start');

          const apiKey = process.env.ANTHROPIC_API_KEY || '';
          const cuModel =
            process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
            process.env.CLAUDE_MODEL ||
            'claude-sonnet-4-5-20250929';

          const saveMsgWrapper = (sid: string, role: 'user' | 'assistant' | 'system', content: any[]) => {
            if (this.saveMessage) {
              this.saveMessage({
                id: `cu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                sessionId: sid,
                role,
                content,
                timestamp: Date.now(),
              });
            }
          };

          const cuSession = new ComputerUseSession({
            adapter: this.localDesktopAdapter,
            apiKey,
            model: cuModel,
            maxLoops: 15,
            sendToRenderer: this.sendToRenderer,
            saveMessage: saveMsgWrapper,
            sessionId: session.id,
          });

          controller.signal.addEventListener('abort', () => cuSession.abort());

          const platform =
            process.platform === 'win32'
              ? 'Windows'
              : process.platform === 'darwin'
                ? 'macOS'
                : 'Linux';
          const cuSystemPrompt = `You are Navi, the user's career navigation agent inside Coeadapt. You have computer tool access on the user's real ${platform} desktop. Use the computer tool to take screenshots, click, type, scroll, and use keyboard shortcuts. Describe what you see and explain your actions. Be careful — this is the user's real machine. Do not type passwords or interact with system settings unless explicitly asked.`;

          try {
            await cuSession.run(contextualPrompt, cuSystemPrompt);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logError('[ClaudeAgentRunner] ComputerUseSession (local) error:', msg);
            this.sendToRenderer({
              type: 'session.status',
              payload: { sessionId: session.id, status: 'error', error: msg },
            });
          }

          logTiming('ComputerUseSession local desktop delegation complete');
          this.activeControllers.delete(session.id);
          return;
        } catch (importErr) {
          logError('[ClaudeAgentRunner] Failed to load computer use modules:', importErr);
          // Fall through to normal SDK path
        }
      }
      // ── End Computer Use delegation ──────────────────────────────

      logTiming('before building MCP servers config');

      // Build MCP servers configuration for SDK
      // IMPORTANT: SDK uses tool names in format: mcp__<ServerKey>__<toolName>
      const mcpServers: Record<string, unknown> = {};
      if (this.mcpManager) {
        const serverStatuses = this.mcpManager.getServerStatus();
        const connectedServers = serverStatuses.filter((s) => s.connected);
        log('[ClaudeAgentRunner] MCP server statuses:', safeStringify(serverStatuses));
        log('[ClaudeAgentRunner] Connected MCP servers:', connectedServers.length);

        let allConfigs: ReturnType<typeof mcpConfigStore.getEnabledServers> = [];
        try {
          allConfigs = mcpConfigStore.getEnabledServers();
          log('[ClaudeAgentRunner] Enabled MCP configs:', allConfigs.map((c) => c.name));
        } catch (error) {
          logWarn(
            '[ClaudeAgentRunner] Failed to read enabled MCP configs; MCP tools will be unavailable this query',
            error
          );
          allConfigs = [];
        }

        // Cache key: serialized config list + imageCapable flag.  The bundled node
        // paths are stable for the lifetime of the process so they don't need to be
        // part of the fingerprint.
        const mcpFingerprint = JSON.stringify(allConfigs) + String(imageCapable);
        if (this._mcpServersCache?.fingerprint === mcpFingerprint) {
          Object.assign(mcpServers, this._mcpServersCache.servers);
          log('[ClaudeAgentRunner] MCP servers config reused from cache');
        } else {
          // Use the module-level memoized helper — no more per-query fs.existsSync calls.
          const bundledNodePaths = getBundledNodePaths();
          const bundledNpx = bundledNodePaths?.npx ?? null;

          for (const config of allConfigs) {
            try {
              // Use a simpler key without spaces to avoid issues
              const serverKey = config.name;

              if (config.type === 'stdio') {
                // 当命令是 npx 或 node 时优先使用内置路径
                const command = (config.command === 'npx' && bundledNpx)
                  ? bundledNpx
                  : (config.command === 'node' && bundledNodePaths ? bundledNodePaths.node : config.command);

                // 使用内置 npx/node 时，将内置 node bin 注入 PATH
                let serverEnv = { ...config.env };
                if (bundledNodePaths && (config.command === 'npx' || config.command === 'node')) {
                  const nodeBinDir = path.dirname(bundledNodePaths.node);
                  const currentPath = process.env.PATH || '';
                  // Prepend bundled node bin to PATH so npx can find node
                  serverEnv.PATH = `${nodeBinDir}${path.delimiter}${currentPath}`;
                  log(`[ClaudeAgentRunner]   Added bundled node bin to PATH: ${nodeBinDir}`);
                }

                if (!imageCapable) {
                  serverEnv.OPEN_COWORK_DISABLE_IMAGE_TOOL_OUTPUT = '1';
                }

                // Resolve path placeholders for presets
                let resolvedArgs = config.args || [];

                // Check if any args contain placeholders that need resolving
                const hasPlaceholders = resolvedArgs.some((arg) =>
                  arg.includes('{SOFTWARE_DEV_SERVER_PATH}') ||
                  arg.includes('{GUI_OPERATE_SERVER_PATH}')
                );

                if (hasPlaceholders) {
                  // Get the appropriate preset based on config name
                  let presetKey: string | null = null;
                  if (config.name === 'Software_Development' || config.name === 'Software Development') {
                    presetKey = 'software-development';
                  } else if (config.name === 'GUI_Operate' || config.name === 'GUI Operate') {
                    presetKey = 'gui-operate';
                  }

                  if (presetKey) {
                    const preset = mcpConfigStore.createFromPreset(presetKey, true);
                    if (preset && preset.args) {
                      resolvedArgs = preset.args;
                    }
                  }
                }

                mcpServers[serverKey] = {
                  type: 'stdio',
                  command,
                  args: resolvedArgs,
                  env: serverEnv,
                };
                log(`[ClaudeAgentRunner] Added STDIO MCP server: ${serverKey}`);
                log(`[ClaudeAgentRunner]   Command: ${command} ${resolvedArgs.join(' ')}`);
                log(`[ClaudeAgentRunner]   Tools will be named: mcp__${serverKey}__<toolName>`);
              } else if (config.type === 'sse') {
                mcpServers[serverKey] = {
                  type: 'sse',
                  url: config.url,
                  headers: config.headers || {},
                };
                log(`[ClaudeAgentRunner] Added SSE MCP server: ${serverKey}`);
              }
            } catch (error) {
              logError('[ClaudeAgentRunner] Failed to prepare MCP server config, skipping server', {
                serverId: config.id,
                serverName: config.name,
                error: toErrorText(error),
              });
            }
          }

          // Store in cache for subsequent queries
          this._mcpServersCache = { fingerprint: mcpFingerprint, servers: { ...mcpServers } };
        }

        const mcpServersSummary = Object.entries(mcpServers).map(([name, serverConfig]) => {
          const typedServerConfig = serverConfig as {
            type?: string;
            command?: string;
            args?: unknown[];
            env?: Record<string, unknown>;
          };
          return {
            name,
            type: typedServerConfig.type ?? 'unknown',
            command: typedServerConfig.command ?? '',
            argsCount: Array.isArray(typedServerConfig.args) ? typedServerConfig.args.length : 0,
            envKeys: typedServerConfig.env ? Object.keys(typedServerConfig.env).length : 0,
          };
        });
        log('[ClaudeAgentRunner] Final mcpServers summary:', safeStringify(mcpServersSummary, 2));
        if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === '1') {
          log('[ClaudeAgentRunner] Final mcpServers config:', safeStringify(mcpServers, 2));
        }
      }
      logTiming('after building MCP servers config');
      
      // Get enableThinking from config
      const enableThinking = configStore.get('enableThinking') ?? false;
      log('[ClaudeAgentRunner] Enable thinking mode:', enableThinking);

      const workspaceInfoPrompt = useSandboxIsolation && sandboxPath
        ? `<workspace_info>
Your current workspace is located at: ${VIRTUAL_WORKSPACE_PATH}
This is an isolated sandbox environment. Use ${VIRTUAL_WORKSPACE_PATH} as the root path for file operations.
</workspace_info>`
        : workingDir
          ? `<workspace_info>Your current workspace is: ${workingDir}</workspace_info>`
          : '';

      const includeCredentialsPrompt = /login|sign[\s-]?in|credential|password|gmail|邮箱|登录|账号|密码/i.test(prompt);
      // Cowork-specific rules appended to pi's native system prompt.
      // Skills and tool descriptions are handled by pi's DefaultResourceLoader.
      const coworkAppendPrompt = [
        'You are an Open Cowork assistant. Be concise, accurate, and tool-capable.',
        `CRITICAL BEHAVIORAL RULES:
1. CHAT FIRST: By default, respond to the user in plain text within the conversation. Do NOT create, write, or edit files unless the user explicitly asks you to (e.g., "create a file", "write this to...", "edit the code", "save as...", mentions a specific file path, or describes code changes they want applied). For questions, summaries, explanations, analysis, and general conversation — always reply directly in chat text.
2. When a request is actionable, proceed immediately with reasonable assumptions. If you need clarification, ask briefly in plain text.
3. For relative time windows like "within two days" in browsing or research tasks, assume the most recent two relevant publication days unless the user explicitly defines another date range.
4. For bracketed placeholders like [Agent], [Topic], etc., treat the word inside brackets as the literal search keyword unless the user says otherwise.
5. When given a task, START DOING IT. Do not restate the task, do not list what you will do, do not ask for confirmation. Just execute.`,
        workspaceInfoPrompt,
        `<citation_requirements>
If your answer uses linkable content from MCP tools, include a "Sources:" section and otherwise use standard Markdown links: [Title](https://claude.ai/chat/URL).
</citation_requirements>`,
        `<tool_behavior>
Tool routing:
- If user explicitly asks to use Chrome/browser/web navigation, prioritize Chrome MCP tools (mcp__Chrome__*) over generic WebSearch/WebFetch.
- Use WebSearch/WebFetch only when Chrome MCP is unavailable or the user explicitly asks for generic web search.
</tool_behavior>`,
        includeCredentialsPrompt ? this.getCredentialsPrompt() : '',
      ].filter((section): section is string => Boolean(section && section.trim())).join('\n\n');

      logTiming('before pi-coding-agent session creation');

      // Resolve thinking level for pi-coding-agent
      type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
      const thinkingLevel: PiThinkingLevel = enableThinking ? 'medium' : 'off';

      // Create or reuse pi-coding-agent session
      const effectiveCwd = (useSandboxIsolation && sandboxPath) ? sandboxPath : (workingDir || process.cwd());

      // Collect skill directories for pi's native skill discovery.
      // SkillsAdapter handles path resolution, disabled skill filtering,
      // and compatibility with Claude Code / OpenClaw ecosystems.
      const skillPaths = this._skillsAdapter
        ? this._skillsAdapter.getSkillPaths()
        : this.legacySkillPaths();
      log('[ClaudeAgentRunner] Skill paths for pi ResourceLoader:', skillPaths);

      const { DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
      const resourceLoader = new DefaultResourceLoader({
        cwd: effectiveCwd,
        additionalSkillPaths: skillPaths,
        appendSystemPrompt: coworkAppendPrompt,
      });
      await resourceLoader.reload();

      const modelRegistry = new ModelRegistry(authStorage);

      // Bridge MCP tools as customTools for pi-coding-agent.
      // Re-read every query so newly added/removed MCP servers take effect immediately.
      const mcpCustomTools = this.mcpManager ? buildMcpCustomTools(this.mcpManager) : [];
      if (mcpCustomTools.length > 0) {
        log(`[ClaudeAgentRunner] Registered ${mcpCustomTools.length} MCP tools as customTools:`, mcpCustomTools.map(t => t.name).join(', '));
      }

      const { session: piSession } = await createAgentSession({
        model: piModel,
        thinkingLevel,
        authStorage,
        modelRegistry,
        tools: createCodingTools(effectiveCwd),
        customTools: mcpCustomTools,
        sessionManager: PiSessionManager.inMemory(),
        settingsManager: PiSettingsManager.inMemory({
          compaction: { enabled: true },
          retry: { enabled: true, maxRetries: 2 },
        }),
        resourceLoader,
        cwd: effectiveCwd,
      });

      // Store session reference for potential reuse/abort
      this.piSessions.set(session.id, piSession);

      logTiming('pi-coding-agent session created');

      // Set up event handler to bridge pi-coding-agent events → our ServerEvent protocol

      const unsubscribe = piSession.subscribe((event) => {
        if (controller.signal.aborted) return;

        // Debug: log every event type
        if (event.type === 'message_update') {
          log(`[ClaudeAgentRunner] Event: ${event.type} → ${event.assistantMessageEvent.type}`);
        } else if (event.type === 'message_start' || event.type === 'message_end') {
          log(`[ClaudeAgentRunner] Event: ${event.type}`, JSON.stringify((event.message as any)?.content || 'no content').substring(0, 500));
        } else if (event.type === 'turn_end') {
          log(`[ClaudeAgentRunner] Event: ${event.type}`, JSON.stringify((event.message as any)?.content || 'no content').substring(0, 500));
        } else {
          log(`[ClaudeAgentRunner] Event: ${event.type}`);
        }

        switch (event.type) {
          case 'message_update': {
            if (controller.signal.aborted) break;
            const ame = event.assistantMessageEvent;
            if (ame.type === 'text_delta') {
              this.sendPartial(session.id, ame.delta);
            } else if (ame.type === 'thinking_delta') {
              // Thinking output — optionally forward to UI
              log('[ClaudeAgentRunner] Thinking delta:', ame.delta.substring(0, 100));
            } else if (ame.type === 'toolcall_start') {
              const partial = ame.partial;
              const toolContent = partial?.content?.[ame.contentIndex];
              const toolName = toolContent?.type === 'toolCall' ? toolContent.name : 'unknown';
              const toolCallId = toolContent?.type === 'toolCall' ? toolContent.id : uuidv4();
              this.sendTraceStep(session.id, {
                id: toolCallId,
                type: 'tool_call',
                status: 'running',
                title: toolName,
                toolName,
                toolInput: toolContent?.type === 'toolCall' ? (toolContent.arguments as Record<string, unknown> || {}) : undefined,
                timestamp: Date.now(),
              });
            } else if (ame.type === 'done') {
              // Some providers emit 'done' via message_update — we handle it
              // in message_end below as a unified path for all providers.
              log('[ClaudeAgentRunner] message_update done event (handled in message_end)');
            } else if (ame.type === 'error') {
              const errorDetail = JSON.stringify(ame.error?.content || 'no content');
              logError('[ClaudeAgentRunner] pi-ai stream error:', ame.reason, errorDetail);
            }
            break;
          }

          case 'message_end': {
            // Unified handler: send the final assistant message to the renderer.
            // Works for all providers (some emit 'done' via message_update, others don't).
            if (controller.signal.aborted) break;
            const msg = event.message;
            if (msg && msg.role === 'assistant') {
              const contentBlocks: ContentBlock[] = [];
              for (const block of (msg as any).content || []) {
                if (block.type === 'text') {
                  const { cleanText, artifacts } = extractArtifactsFromText(block.text);
                  if (cleanText) {
                    contentBlocks.push({ type: 'text', text: sanitizeOutputPaths(cleanText) });
                  }
                  if (artifacts.length > 0) {
                    for (const step of buildArtifactTraceSteps(artifacts)) {
                      this.sendTraceStep(session.id, step);
                    }
                  }
                } else if (block.type === 'toolCall') {
                  contentBlocks.push({
                    type: 'tool_use',
                    id: block.id,
                    name: block.name,
                    input: block.arguments,
                  });
                } else {
                  // Unknown block type — pass through as text so content isn't silently lost
                  log(`[ClaudeAgentRunner] Unknown content block type: ${block.type}`);
                  const text = block.text || JSON.stringify(block);
                  if (text) contentBlocks.push({ type: 'text', text });
                }
              }
              // Always clear partial text; send message even if only artifacts were extracted
              this.sendToRenderer({
                type: 'stream.partial',
                payload: { sessionId: session.id, delta: '' },
              });
              if (contentBlocks.length > 0) {
                const assistantMsg: Message = {
                  id: uuidv4(),
                  sessionId: session.id,
                  role: 'assistant',
                  content: contentBlocks,
                  timestamp: Date.now(),
                  tokenUsage: (msg as any).usage ? {
                    input: (msg as any).usage.input,
                    output: (msg as any).usage.output,
                  } : undefined,
                };
                this.sendMessage(session.id, assistantMsg);
              }
            }
            break;
          }

          case 'tool_execution_start': {
            log(`[ClaudeAgentRunner] Tool execution start: ${event.toolName}`);
            break;
          }

          case 'tool_execution_end': {
            if (controller.signal.aborted) break;
            const toolCallId = event.toolCallId;
            const isError = event.isError;
            const outputText = typeof event.result === 'string'
              ? event.result
              : JSON.stringify(event.result || '');
            this.sendTraceUpdate(session.id, toolCallId, {
              status: isError ? 'error' : 'completed',
              toolName: event.toolName,
              toolOutput: sanitizeOutputPaths(outputText).slice(0, 800),
            });

            // Send tool result message
            const toolResultMsg: Message = {
              id: uuidv4(),
              sessionId: session.id,
              role: 'assistant',
              content: [{
                type: 'tool_result',
                toolUseId: toolCallId,
                content: sanitizeOutputPaths(outputText),
                isError,
              }],
              timestamp: Date.now(),
            };
            this.sendMessage(session.id, toolResultMsg);
            break;
          }

          case 'agent_end': {
            log('[ClaudeAgentRunner] Agent finished');
            break;
          }
        }
      });

      // Execute the prompt with timeout
      try {
        const PROMPT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
        const timeoutId = setTimeout(() => {
          logWarn('[ClaudeAgentRunner] Prompt timed out, aborting');
          controller.abort();
        }, PROMPT_TIMEOUT_MS);
        try {
          const promptResult = await piSession.prompt(contextualPrompt);
          log('[ClaudeAgentRunner] prompt() returned:', JSON.stringify(promptResult ?? 'void').substring(0, 1000));
        } finally {
          clearTimeout(timeoutId);
        }
      } finally {
        try { unsubscribe(); } catch (e) { logWarn('[ClaudeAgentRunner] unsubscribe error:', e); }
      }

      logTiming('pi-coding-agent prompt completed');

      // Complete - update the initial thinking step
      this.sendTraceUpdate(session.id, thinkingStepId, {
        status: 'completed',
        title: 'Task completed',
      });

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        log('[ClaudeAgentRunner] Aborted');
      } else {
        logError('[ClaudeAgentRunner] Error:', error);

        const errorText = toUserFacingErrorText(toErrorText(error));
        const errorMsg: Message = {
          id: uuidv4(),
          sessionId: session.id,
          role: 'assistant',
          content: [{ type: 'text', text: `**Error**: ${errorText}` }],
          timestamp: Date.now(),
        };
        this.sendMessage(session.id, errorMsg);

        this.sendTraceStep(session.id, {
          id: uuidv4(),
          type: 'thinking',
          status: 'error',
          title: 'Error occurred',
          timestamp: Date.now(),
        });

        // Mark so session-manager doesn't report again
        if (error instanceof Error) {
          (error as any).alreadyReportedToUser = true;
        }
      }
    } finally {
      this.activeControllers.delete(session.id);
      this.pathResolver.unregisterSession(session.id);

      // Sync changes from sandbox back to host OS (but don't cleanup - sandbox persists)
      if (useSandboxIsolation && sandboxPath) {
        const sandbox = getSandboxAdapter();

        if (sandbox.isWSL) {
          log('[ClaudeAgentRunner] Syncing sandbox changes to Windows...');
          const syncResult = await SandboxSync.syncToWindows(session.id);
          if (syncResult.success) {
            log('[ClaudeAgentRunner] Sync completed successfully');
          } else {
            logError('[ClaudeAgentRunner] Sync failed:', syncResult.error);
          }
        } else if (sandbox.isLima) {
          log('[ClaudeAgentRunner] Syncing sandbox changes to macOS...');
          const { LimaSync } = await import('../sandbox/lima-sync');
          const syncResult = await LimaSync.syncToMac(session.id);
          if (syncResult.success) {
            log('[ClaudeAgentRunner] Sync completed successfully');
          } else {
            logError('[ClaudeAgentRunner] Sync failed:', syncResult.error);
          }
        }
      }
    }
  }


  cancel(sessionId: string): void {
    const controller = this.activeControllers.get(sessionId);
    if (controller) controller.abort();
  }

  private sendTraceStep(sessionId: string, step: TraceStep): void {
    log(`[Trace] ${step.type}: ${step.title}`);
    this.sendToRenderer({ type: 'trace.step', payload: { sessionId, step } });
  }

  private sendTraceUpdate(sessionId: string, stepId: string, updates: Partial<TraceStep>): void {
    log(`[Trace] Update step ${stepId}:`, updates);
    this.sendToRenderer({ type: 'trace.update', payload: { sessionId, stepId, updates } });
  }

  private sendMessage(sessionId: string, message: Message): void {
    // Save message to database for persistence
    if (this.saveMessage) {
      this.saveMessage(message);
    }
    // Send to renderer for UI update
    this.sendToRenderer({ type: 'stream.message', payload: { sessionId, message } });
  }

  private sendPartial(sessionId: string, delta: string): void {
    this.sendToRenderer({ type: 'stream.partial', payload: { sessionId, delta } });
  }

}
