/**
 * @module main/claude/agent-runner
 *
 * AI query execution engine (1514 lines).
 *
 * Responsibilities:
 * - Runs AI conversations via the pi-coding-agent SDK (createAgentSession)
 * - Routes providers via pi-ai SDK for model resolution
 * - Bridges MCP tools into SDK ToolDefinition format
 * - Streams responses back as ServerEvents (stream.message, stream.partial, trace.step)
 * - Skills injection, system prompt assembly, permission handling
 *
 * Dependencies: session-manager, mcp-manager, config-store, skills-manager
 */
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
import { log, logWarn, logError, logCtx, logCtxWarn, logCtxError, logTiming } from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { app } from 'electron';
import { setMaxListeners } from 'node:events';
import { getSandboxAdapter } from '../sandbox/sandbox-adapter';
import { pathConverter } from '../sandbox/wsl-bridge';
import { SandboxSync } from '../sandbox/sandbox-sync';
import { extractArtifactsFromText, buildArtifactTraceSteps } from '../utils/artifact-parser';
import { getDefaultShell } from '../utils/shell-resolver';
import { PluginRuntimeService } from '../skills/plugin-runtime-service';
import type { SkillsAdapter } from '../skills/skills-adapter';
import { configStore } from '../config/config-store';
import { resolveMessageEndPayload, toUserFacingErrorText } from './agent-runner-message-end';
import {
  applyPiModelRuntimeOverrides,
  buildSyntheticPiModel,
  resolvePiRegistryModel,
  resolvePiRouteProtocol,
  resolveSyntheticPiModelFallback,
} from './pi-model-resolution';
import { buildPiSessionRuntimeSignature } from './pi-session-runtime';
import { ThinkTagStreamParser } from './think-tag-parser';

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
  if (!app.isPackaged) {
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

/**
 * Resolve bundled Python bin directory path (if available).
 * Checks packaged and dev layouts, returns the bin dir containing python3.
 */
function resolveBundledPythonBinDir(): string | null {
  const platform = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  const candidates: string[] = [];
  if (!app.isPackaged) {
    const projectRoot = path.join(__dirname, '..', '..');
    if (platform === 'darwin') {
      candidates.push(path.join(projectRoot, 'resources', 'python', `darwin-${arch}`, 'bin'));
    }
    candidates.push(path.join(projectRoot, 'resources', 'python', 'bin'));
  } else {
    // Packaged layout: Resources/python/bin/python3
    candidates.push(path.join(process.resourcesPath, 'python', 'bin'));
  }

  const pythonExe = platform === 'win32' ? 'python.exe' : 'python3';
  for (const binDir of candidates) {
    if (fs.existsSync(path.join(binDir, pythonExe))) return binDir;
  }
  return null;
}

/**
 * Resolve bundled tools directory (cliclick etc., macOS only).
 */
function resolveBundledToolsBinDir(): string | null {
  if (process.platform !== 'darwin') return null;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  const candidates: string[] = [];
  if (!app.isPackaged) {
    const projectRoot = path.join(__dirname, '..', '..');
    candidates.push(path.join(projectRoot, 'resources', 'tools', `darwin-${arch}`, 'bin'));
    candidates.push(path.join(projectRoot, 'resources', 'tools', 'bin'));
  } else {
    candidates.push(path.join(process.resourcesPath, 'tools', `darwin-${arch}`, 'bin'));
    candidates.push(path.join(process.resourcesPath, 'tools', 'bin'));
  }

  for (const binDir of candidates) {
    if (fs.existsSync(binDir)) return binDir;
  }
  return null;
}

/**
 * One-time enrichment of process.env.PATH for build (production) mode.
 *
 * In dev mode, Electron inherits the user's full shell PATH, so Skill commands
 * like `python3` and `node` just work. In build mode, `process.env.PATH` is
 * minimal (often just `/usr/bin:/bin`).
 *
 * This function:
 * 1. Restores the user's login-shell PATH (safe: uses execFileSync, not execSync)
 * 2. Prepends bundled Node, Python, and tools bin dirs (highest priority)
 * 3. Deduplicates all entries
 * 4. Writes the result back to `process.env.PATH`
 *
 * Called once before the first `createCodingTools()` — subsequent calls are no-ops.
 */
let pathEnriched = false;

async function enrichProcessPathForBuild(): Promise<void> {
  if (pathEnriched) return;
  pathEnriched = true;

  if (!app.isPackaged) {
    log('[ClaudeAgentRunner] Dev mode — skipping PATH enrichment');
    return;
  }

  const platform = process.platform;
  const delimiter = platform === 'win32' ? ';' : ':';
  const currentPaths = (process.env.PATH || '').split(delimiter).filter((p: string) => p.trim());

  // 1. Restore user's login-shell PATH
  let shellPaths: string[] = [];
  if (platform === 'darwin' || platform === 'linux') {
    try {
      const shell = getDefaultShell();
      const output = (execFileSync(shell, ['-l', '-c', 'echo $PATH'], {
        encoding: 'utf-8',
        timeout: 5000,
        env: { HOME: os.homedir() },
      }) as string).trim();
      if (output) {
        shellPaths = output.split(':').filter((p: string) => p.trim());
        log(`[ClaudeAgentRunner] Restored ${shellPaths.length} paths from login shell`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`[ClaudeAgentRunner] Could not restore shell PATH: ${message}`);
    }
  } else if (platform === 'win32') {
    try {
      const output = (execFileSync('powershell.exe', [
        '-NoProfile', '-Command',
        "[Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')",
      ], { encoding: 'utf-8', timeout: 5000 }) as string).trim();
      if (output) {
        shellPaths = output.split(';').filter((p: string) => p.trim());
        log(`[ClaudeAgentRunner] Restored ${shellPaths.length} paths from Windows registry`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`[ClaudeAgentRunner] Could not restore Windows PATH: ${message}`);
    }
  }

  // 2. Collect bundled bin directories (highest priority)
  const bundledDirs: string[] = [];

  const nodePaths = getBundledNodePaths();
  if (nodePaths) {
    bundledDirs.push(path.dirname(nodePaths.node));
  }

  const pythonBinDir = resolveBundledPythonBinDir();
  if (pythonBinDir) {
    bundledDirs.push(pythonBinDir);
  }

  const toolsBinDir = resolveBundledToolsBinDir();
  if (toolsBinDir) {
    bundledDirs.push(toolsBinDir);
  }

  // 3. Merge: bundled (highest) → shell → current process, deduplicate
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const p of [...bundledDirs, ...shellPaths, ...currentPaths]) {
    const normalized = platform === 'win32' ? p.toLowerCase() : p;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      merged.push(p);
    }
  }

  process.env.PATH = merged.join(delimiter);
  log(`[ClaudeAgentRunner] Enriched process.env.PATH for build mode: ${bundledDirs.length} bundled + ${shellPaths.length} shell + ${currentPaths.length} process → ${merged.length} total`);
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
        } catch (err: unknown) {
          logError(`[ClaudeAgentRunner] MCP tool ${mcpTool.name} failed:`, err);
          throw err instanceof Error ? err : new Error(String(err));
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

function normalizeTokenUsage(
  usage: unknown
): Message['tokenUsage'] | undefined {
  if (!usage || typeof usage !== 'object') {
    return undefined;
  }

  const raw = usage as {
    input?: unknown;
    output?: unknown;
    input_tokens?: unknown;
    output_tokens?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
  };

  const input = raw.input ?? raw.input_tokens ?? raw.inputTokens;
  const output = raw.output ?? raw.output_tokens ?? raw.outputTokens;

  if (typeof input !== 'number' || typeof output !== 'number') {
    return undefined;
  }

  return { input, output };
}

interface AgentRunnerOptions {
  sendToRenderer: (event: ServerEvent) => void;
  saveMessage?: (message: Message) => void;
  requestSudoPassword?: (sessionId: string, toolUseId: string, command: string) => Promise<string | null>;
}

interface CachedPiSession {
  session: PiAgentSession;
  modelId: string;
  thinkingLevel: string;
  runtimeSignature: string;
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
  private requestSudoPassword?: (sessionId: string, toolUseId: string, command: string) => Promise<string | null>;
  private pathResolver: PathResolver;
  private mcpManager?: MCPManager;
  // @ts-expect-error stored for future plugin support
  private _pluginRuntimeService?: PluginRuntimeService;
  private _skillsAdapter?: SkillsAdapter;
  private activeControllers: Map<string, AbortController> = new Map();
  private piSessions: Map<string, CachedPiSession> = new Map();

  // Per-instance caches — invalidated when the underlying config changes.
  private _mcpServersCache: { fingerprint: string; servers: Record<string, unknown> } | null = null;
  private _skillsSetupDone = false;

  /**
   * Clear SDK session cache for a session
   * Called when session's cwd changes - SDK sessions are bound to cwd
   */
  clearSdkSession(sessionId: string): void {
    const cached = this.piSessions.get(sessionId);
    if (cached) {
      try { cached.session.dispose(); } catch (e) { logWarn('[ClaudeAgentRunner] dispose error:', e); }
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
    // Sessions stay alive — MCP tools are rebuilt each query via buildMcpCustomTools()
    log('[ClaudeAgentRunner] MCP servers cache invalidated — tools will rebuild on next query');
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

      // Format credentials with masked password for system prompt.
      // Credentials should be passed through a secure channel (e.g., MCP tool
      // call or secure IPC), not embedded as plaintext in the prompt.
      const formatCredential = (c: UserCredential) => {
        const lines = [`- **${c.name}**${c.service ? ` (${c.service})` : ''}`];
        lines.push(`  - Username/Email: \`${c.username}\``);
        lines.push(`  - Password: \`****\``);
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

  /**
   * Generate bundled executable path hints for production mode system prompt.
   * In dev mode returns empty string (user PATH already works).
   * This is a defense-in-depth layer — even if PATH enrichment works, explicit
   * paths help the model avoid ambiguity when Skills reference bare commands.
   */
  private getBundledPathHints(): string {
    if (!app.isPackaged) return '';

    const hints: string[] = [];

    const nodePaths = getBundledNodePaths();
    if (nodePaths) {
      hints.push(`- node: ${nodePaths.node}`);
      hints.push(`- npx: ${nodePaths.npx}`);
    }

    const pythonBinDir = resolveBundledPythonBinDir();
    if (pythonBinDir) {
      const pythonExe = process.platform === 'win32' ? 'python.exe' : 'python3';
      const pipExe = process.platform === 'win32' ? 'pip.exe' : 'pip3';
      hints.push(`- python3: ${path.join(pythonBinDir, pythonExe)}`);
      if (fs.existsSync(path.join(pythonBinDir, pipExe))) {
        hints.push(`- pip3: ${path.join(pythonBinDir, pipExe)}`);
      }
    }

    if (hints.length === 0) return '';

    return `<bundled_executables>
This application bundles its own executables. When executing commands, prefer these absolute paths:
${hints.join('\n')}
</bundled_executables>`;
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
    this.requestSudoPassword = options.requestSudoPassword;
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
   * Check if a command contains sudo
   */
  private static isSudoCommand(command: string): boolean {
    return /\bsudo\b/.test(command);
  }

  /**
   * Wrap the bash tool in the coding tools array to intercept sudo commands.
   * When a sudo command is detected, prompts the user for a password,
   * then rewrites the command to pipe the password into sudo -S.
   */
  private wrapBashToolForSudo(tools: ToolDefinition[], sessionId: string): ToolDefinition[] {
    if (!this.requestSudoPassword) return tools;

    const requestSudoPassword = this.requestSudoPassword;

    return tools.map((tool) => {
      if (tool.name !== 'bash') return tool;

      const originalExecute = tool.execute;
      return {
        ...tool,
        execute: async (
          toolCallId: string,
          params: { command: string; timeout?: number },
          signal: AbortSignal | undefined,
          onUpdate: ((update: unknown) => void) | undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ctx: any
        ) => {
          const command = params.command;

          if (ClaudeAgentRunner.isSudoCommand(command)) {
            log('[ClaudeAgentRunner] Sudo command detected, requesting password');
            const password = await requestSudoPassword(sessionId, toolCallId, command);

            if (!password) {
              log('[ClaudeAgentRunner] Sudo password cancelled by user');
              return {
                content: [{ type: 'text' as const, text: 'Command cancelled: user denied sudo password.' }],
                details: undefined as unknown,
              };
            }

            // Add -S flag to sudo invocations that don't already have it
            const rewrittenCommand = command.replace(/\bsudo\b(?!\s+-S)/g, 'sudo -S');

            // Use a unique env var name per invocation to avoid race conditions
            // when multiple sessions run sudo concurrently.
            const envVarName = `__SUDO_PW_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

            // Pass password via env var and pipe it through printf,
            // so the password never appears in process args (unlike echo 'pw' |).
            // process.env is inherited by child_process.spawn synchronously.
            const wrappedCommand = `printf '%s\\n' "$${envVarName}" | ${rewrittenCommand}`;
            process.env[envVarName] = password;

            log('[ClaudeAgentRunner] Executing sudo command with password injection (via env)');
            try {
              const result = await originalExecute(
                toolCallId,
                { ...params, command: wrappedCommand },
                signal,
                onUpdate,
                ctx
              );
              return result;
            } finally {
              delete process.env[envVarName];
            }
          }

          return originalExecute(toolCallId, params, signal, onUpdate, ctx);
        },
      } as ToolDefinition;
    });
  }

  /**
   * Wrap the bash tool to inject a default timeout when the model omits one.
   * The pi-coding-agent SDK's bash tool has no default timeout, which means
   * commands can run indefinitely if the model doesn't specify a timeout.
   */
  private static wrapBashToolWithDefaultTimeout(tools: ToolDefinition[]): ToolDefinition[] {
    const DEFAULT_BASH_TIMEOUT_SECONDS = 120;

    return tools.map((tool) => {
      if (tool.name !== 'bash') return tool;

      const originalExecute = tool.execute;
      return {
        ...tool,
        execute: async (
          toolCallId: string,
          params: { command: string; timeout?: number },
          signal: AbortSignal | undefined,
          onUpdate: ((update: unknown) => void) | undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ctx: any
        ) => {
          const effectiveParams = params.timeout != null
            ? params
            : { ...params, timeout: DEFAULT_BASH_TIMEOUT_SECONDS };
          return originalExecute(toolCallId, effectiveParams, signal, onUpdate, ctx);
        },
      } as ToolDefinition;
    });
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
    logCtx('[ClaudeAgentRunner] Current model:', model);
    logCtx('[ClaudeAgentRunner] Model source:', routeModel ? 'runtimeRoute.model' : configuredModel ? 'configStore.model' : 'default');
    return model;
  }

  async run(session: Session, prompt: string, existingMessages: Message[]): Promise<void> {
    const runStartTime = Date.now();
    logCtx('[ClaudeAgentRunner] run() started');

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

    const thinkingStepId = uuidv4();

    try {
      this.pathResolver.registerSession(session.id, session.mountedPaths);
      logTiming('pathResolver.registerSession', runStartTime);

      // Note: User message is now added by the frontend immediately for better UX
      // No need to send it again from backend

      // Send initial thinking trace
      this.sendTraceStep(session.id, {
        id: thinkingStepId,
        type: 'thinking',
        status: 'running',
        title: 'Processing request...',
        timestamp: Date.now(),
      });
      logTiming('sendTraceStep (thinking)', runStartTime);

      // Use session's cwd - each session has its own working directory
      const workingDir = session.cwd || undefined;
      logCtx('[ClaudeAgentRunner] Working directory:', workingDir || '(none)');

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
            execFileSync('wsl', ['-d', distro, '-e', 'mkdir', '-p', sandboxSkillsPath], {
              encoding: 'utf-8',
              timeout: 10000
            });

            if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
              // Use rsync to recursively copy all skills (much faster and handles subdirectories)
              const wslSourcePath = pathConverter.toWSL(builtinSkillsPath);
              const rsyncCmd = `rsync -av "${wslSourcePath}/" "${sandboxSkillsPath}/"`;
              log(`[ClaudeAgentRunner] Copying skills with rsync: ${rsyncCmd}`);

              execFileSync('wsl', ['-d', distro, '-e', 'bash', '-c', rsyncCmd], {
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

              execFileSync('wsl', ['-d', distro, '-e', 'bash', '-c', rsyncCmd], {
                encoding: 'utf-8',
                timeout: 120000  // 2 min timeout for large skill directories
              });
            }

            // List copied skills for verification
            const copiedSkills = execFileSync('wsl', ['-d', distro, '-e', 'ls', sandboxSkillsPath], {
              encoding: 'utf-8',
              timeout: 10000
            }).trim().split(/\r?\n/).filter(Boolean);

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
              message: '沙盒文件同步失败，已回退到直接访问模式',
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
            execFileSync('limactl', ['shell', 'claude-sandbox', '--', 'mkdir', '-p', sandboxSkillsPath], {
              encoding: 'utf-8',
              timeout: 10000
            });

            if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
              // Use rsync to recursively copy all skills (much faster and handles subdirectories)
              // Lima mounts /Users directly, so paths are the same
              const rsyncCmd = `rsync -av "${builtinSkillsPath}/" "${sandboxSkillsPath}/"`;
              log(`[ClaudeAgentRunner] Copying skills with rsync: ${rsyncCmd}`);

              execFileSync('limactl', ['shell', 'claude-sandbox', '--', 'bash', '-c', rsyncCmd], {
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

              execFileSync('limactl', ['shell', 'claude-sandbox', '--', 'bash', '-c', rsyncCmd], {
                encoding: 'utf-8',
                timeout: 120000  // 2 min timeout for large skill directories
              });
            }

            // List copied skills for verification
            const copiedSkills = execFileSync('limactl', ['shell', 'claude-sandbox', '--', 'ls', sandboxSkillsPath], {
              encoding: 'utf-8',
              timeout: 10000
            }).trim().split(/\r?\n/).filter(Boolean);

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
              message: '沙盒文件同步失败，已回退到直接访问模式',
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

      logCtx('[ClaudeAgentRunner] Total messages:', existingMessages.length);

      const hasImages = lastUserMessage?.content.some((c: any) => c.type === 'image') || false;
      if (hasImages) {
        log('[ClaudeAgentRunner] User message contains images');
      }

      logTiming('before pi-ai model resolution', runStartTime);

      // Resolve model via pi-ai
      const runtimeConfig = configStore.getAll();
      const modelString = this.getCurrentModelString(runtimeConfig.model);
      const configProtocol = resolvePiRouteProtocol(
        runtimeConfig.provider,
        runtimeConfig.customProtocol,
      );
      let piModel = resolvePiRegistryModel(modelString, {
        configProvider: configProtocol,
        customBaseUrl: runtimeConfig.baseUrl?.trim() || undefined,
        rawProvider: runtimeConfig.provider,
        customProtocol: runtimeConfig.customProtocol,
      });

      if (!piModel) {
        // Synthetic fallback: construct a Model for unknown/custom models
        const synthetic = resolveSyntheticPiModelFallback({
          rawModel: runtimeConfig.model,
          resolvedModelString: modelString,
          rawProvider: runtimeConfig.provider,
          routeProtocol: configProtocol,
          baseUrl: runtimeConfig.baseUrl?.trim() || undefined,
        });
        piModel = buildSyntheticPiModel(
          synthetic.modelId,
          synthetic.provider,
          configProtocol,
          runtimeConfig.baseUrl?.trim() || undefined,
          undefined,
          undefined,
          runtimeConfig.contextWindow,
          runtimeConfig.maxTokens,
        );
        // Apply the same runtime overrides (developer role compat, base URL, API downgrade)
        // that resolvePiRegistryModel applies to registry models
        piModel = applyPiModelRuntimeOverrides(piModel, {
          configProvider: configProtocol,
          customBaseUrl: runtimeConfig.baseUrl?.trim() || undefined,
          rawProvider: runtimeConfig.provider,
          customProtocol: runtimeConfig.customProtocol,
        });
        logCtxWarn('[ClaudeAgentRunner] Model not in pi-ai registry, using synthetic model:', modelString, '→', piModel.api);
      }
      logCtx('[ClaudeAgentRunner] Resolved pi-ai model:', piModel.provider, piModel.id);

      // Send context window info to renderer for UI display
      this.sendToRenderer({
        type: 'session.contextInfo',
        payload: { sessionId: session.id, contextWindow: piModel.contextWindow || 128000 },
      });

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
      logCtx('[ClaudeAgentRunner] Model baseUrl:', piModel.baseUrl, 'api:', piModel.api);

      logTiming('after pi-ai model resolution', runStartTime);

      // pi-coding-agent handles path sandboxing via its own tools
      const imageCapable = true; // pi-ai models generally support images; let the model handle unsupported cases
      const effectiveCwd = (useSandboxIsolation && sandboxPath) ? sandboxPath : (workingDir || process.cwd());

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

      logTiming('before building conversation context', runStartTime);

      // pi-ai handles auth and model routing natively — no proxy, no env overrides needed.
      logCtx('[ClaudeAgentRunner] Using pi-ai native routing for:', piModel.provider, piModel.id);

      // Resolve thinking level early — needed for session reuse check below
      const enableThinking = configStore.get('enableThinking') ?? false;
      logCtx('[ClaudeAgentRunner] Enable thinking mode:', enableThinking);
      type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
      const thinkingLevel: PiThinkingLevel = enableThinking ? 'medium' : 'off';
      const sessionRuntimeSignature = buildPiSessionRuntimeSignature({
        configProvider: runtimeConfig.provider,
        customProtocol: runtimeConfig.customProtocol,
        modelProvider: piModel.provider,
        modelApi: piModel.api,
        modelBaseUrl: piModel.baseUrl,
        effectiveCwd,
        apiKey,
      });

      // Build contextual prompt — if reusing an existing SDK session, the SDK
      // already has conversation history so we only pass the new prompt.
      // For cold starts (new SDK session with existing DB history), we inject
      // a token-budgeted summary of recent history as a preamble.
      let cachedSession = this.piSessions.get(session.id);
      if (cachedSession && cachedSession.runtimeSignature !== sessionRuntimeSignature) {
        logCtx('[ClaudeAgentRunner] Runtime changed, recreating cached pi session:', session.id);
        try {
          cachedSession.session.dispose();
        } catch (disposeError) {
          logWarn('[ClaudeAgentRunner] dispose error while recreating pi session:', disposeError);
        }
        this.piSessions.delete(session.id);
        cachedSession = undefined;
      }

      let contextualPrompt = prompt;
      if (!cachedSession) {
        // Cold start: inject recent history into prompt if available
        const conversationMessages = existingMessages
          .filter(msg => msg.role === 'user' || msg.role === 'assistant');
        const historyMessages = (
          conversationMessages.length > 0
            && conversationMessages[conversationMessages.length - 1]?.role === 'user'
        )
          ? conversationMessages.slice(0, -1)
          : conversationMessages;

        if (historyMessages.length > 0 && !hasImages) {
          // Token-budget: ~4 chars/token, use ~30% of context window for history
          const contextWindow = piModel.contextWindow || 128000;
          const historyTokenBudget = Math.floor(contextWindow * 0.3);
          const historyCharBudget = historyTokenBudget * 4;

          const historyItems: string[] = [];
          let charCount = 0;
          // Build from newest to oldest, then reverse
          for (let i = historyMessages.length - 1; i >= 0; i--) {
            const msg = historyMessages[i];
            const textContent = msg.content
              .filter(c => c.type === 'text')
              .map(c => (c as any).text)
              .join('\n');
            const entry = `${msg.role === 'user' ? 'Human' : 'Assistant'}: ${textContent}`;
            if (charCount + entry.length > historyCharBudget) break;
            charCount += entry.length;
            historyItems.unshift(entry);
          }

          if (historyItems.length > 0) {
            const trimmedCount = historyMessages.length - historyItems.length;
            const preamble = trimmedCount > 0
              ? `[Previous conversation - ${trimmedCount} older messages omitted]\n${historyItems.join('\n')}`
              : historyItems.join('\n');
            contextualPrompt = `${preamble}\nHuman: ${prompt}\nAssistant:`;
            log('[ClaudeAgentRunner] Cold start: injecting', historyItems.length, 'of', historyMessages.length, 'history messages (budget:', historyCharBudget, 'chars, used:', charCount, ')');
          }
        }
      } else {
        // Reusing session — SDK already has the full conversation context
        logCtx('[ClaudeAgentRunner] Reusing existing SDK session for:', session.id);
      }

      logTiming('before building MCP servers config', runStartTime);

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
      logTiming('after building MCP servers config', runStartTime);

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
        this.getBundledPathHints(),
      ].filter((section): section is string => Boolean(section && section.trim())).join('\n\n');

      logTiming('before pi-coding-agent session creation', runStartTime);

      // Create or reuse pi-coding-agent session

      // Collect skill directories for pi's native skill discovery.
      // SkillsAdapter handles path resolution, disabled skill filtering,
      // and compatibility with Claude Code / OpenClaw ecosystems.
      const skillPaths = this._skillsAdapter
        ? this._skillsAdapter.getSkillPaths()
        : this.legacySkillPaths();
      log('[ClaudeAgentRunner] Skill paths for pi ResourceLoader:', skillPaths);

      // Bridge MCP tools as customTools for pi-coding-agent.
      // Re-read every query so newly added/removed MCP servers take effect immediately.
      const mcpCustomTools = this.mcpManager ? buildMcpCustomTools(this.mcpManager) : [];
      if (mcpCustomTools.length > 0) {
        log(`[ClaudeAgentRunner] Registered ${mcpCustomTools.length} MCP tools as customTools:`, mcpCustomTools.map(t => t.name).join(', '));
      }

      // Enrich process.env.PATH for build mode — ensures Skill commands (python3, node)
      // executed via Pi SDK's Bash tool can find bundled and user-installed executables.
      await enrichProcessPathForBuild();

      const codingTools = createCodingTools(effectiveCwd);

      // Inject a default 120s timeout for bash commands when the model omits one
      const withTimeout = ClaudeAgentRunner.wrapBashToolWithDefaultTimeout(codingTools as ToolDefinition[]);

      // Wrap the bash tool to intercept sudo commands and request passwords
      // Note: wrapBashToolForSudo returns ToolDefinition[] (5-param execute) but
      // createAgentSession.tools expects Tool[] (4-param execute). The extra ctx
      // parameter is simply not passed by the session runner — safe to cast.
      const wrappedTools = this.wrapBashToolForSudo(withTimeout, session.id);

      // Diagnostic: log tools being passed to SDK (helps debug Ollama tool use)
      logCtx(`[ClaudeAgentRunner] Session reuse check: cached=${!!cachedSession}`);
      logCtx(`[ClaudeAgentRunner] Model=${piModel.id}, thinkingLevel=${thinkingLevel}`);
      log(`[ClaudeAgentRunner] Built-in tools (${wrappedTools.length}): ${wrappedTools.map((t: { name?: string; type?: string }) => t.name || t.type).join(', ')}`);
      log(`[ClaudeAgentRunner] Custom MCP tools (${mcpCustomTools.length}): ${mcpCustomTools.map(t => t.name).join(', ')}`);

      let piSession: PiAgentSession;
      if (cachedSession) {
        // Reuse existing session — SDK retains full conversation history and handles compaction
        piSession = cachedSession.session;

        // Hot-swap model/thinking if changed — SDK supports this natively
        if (cachedSession.modelId !== piModel.id) {
          logCtx('[ClaudeAgentRunner] Model changed, hot-swapping:', cachedSession.modelId, '→', piModel.id);
          await piSession.setModel(piModel);
          cachedSession.modelId = piModel.id;
        }
        if (cachedSession.thinkingLevel !== thinkingLevel) {
          logCtx('[ClaudeAgentRunner] Thinking level changed, hot-swapping:', cachedSession.thinkingLevel, '→', thinkingLevel);
          piSession.setThinkingLevel(thinkingLevel);
          cachedSession.thinkingLevel = thinkingLevel;
        }

        logCtx('[ClaudeAgentRunner] Reusing cached pi session for:', session.id);
        logTiming('pi-coding-agent session reused', runStartTime);
      } else {
        // First query in this session — create new pi-coding-agent session
        // ResourceLoader + ModelRegistry only needed for session creation — skip on reuse
        const { DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
        const resourceLoader = new DefaultResourceLoader({
          cwd: effectiveCwd,
          additionalSkillPaths: skillPaths,
          appendSystemPrompt: coworkAppendPrompt,
        });
        await resourceLoader.reload();

        const modelRegistry = new ModelRegistry(authStorage);

        const { session: newPiSession } = await createAgentSession({
          model: piModel,
          thinkingLevel,
          authStorage,
          modelRegistry,
          tools: wrappedTools as unknown as ReturnType<typeof createCodingTools>,
          customTools: mcpCustomTools,
          sessionManager: PiSessionManager.inMemory(),
          settingsManager: PiSettingsManager.inMemory({
            compaction: { enabled: true },
            retry: { enabled: true, maxRetries: 2 },
          }),
          resourceLoader,
          cwd: effectiveCwd,
        });
        piSession = newPiSession;

        // Store session for reuse
        this.piSessions.set(session.id, {
          session: piSession,
          modelId: piModel.id,
          thinkingLevel,
          runtimeSignature: sessionRuntimeSignature,
        });
        logTiming('pi-coding-agent session created', runStartTime);
      }

      // Set up event handler to bridge pi-coding-agent events → our ServerEvent protocol

      // Accumulate streamed text deltas in case message_end.content is empty (pi SDK streaming behaviour)
      let streamedText = '';
      let compactionStepId: string | undefined;
      let hasEmittedError = false;
      const thinkParser = new ThinkTagStreamParser();

      // Ollama cold-start feedback: if provider is 'ollama' and no stream event arrives
      // within 10 seconds, show a "model loading" trace update so users know what's happening.
      let ollamaColdStartTimerId: ReturnType<typeof setTimeout> | undefined;
      let receivedFirstStreamEvent = false;
      if (provider === 'ollama') {
        ollamaColdStartTimerId = setTimeout(() => {
          if (!receivedFirstStreamEvent && !controller.signal.aborted) {
            this.sendTraceUpdate(session.id, thinkingStepId, {
              title: 'Waiting for model to load into memory...',
            });
          }
        }, 10000);
      }

      // Activity-based timeout: reset the 5-min timer whenever the SDK sends events
      const PROMPT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
      let activityTimeoutId: ReturnType<typeof setTimeout> | undefined;
      const resetActivityTimeout = () => {
        if (activityTimeoutId) clearTimeout(activityTimeoutId);
        activityTimeoutId = setTimeout(() => {
          logWarn('[ClaudeAgentRunner] Prompt timed out (no activity for 5 min), aborting');
          controller.abort();
        }, PROMPT_TIMEOUT_MS);
      };

      const unsubscribe = piSession.subscribe((event) => {
        try {
        if (controller.signal.aborted) return;

        // Reset activity timeout on meaningful events
        resetActivityTimeout();

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
              // Clear Ollama cold-start indicator on first stream event
              if (!receivedFirstStreamEvent && ollamaColdStartTimerId) {
                receivedFirstStreamEvent = true;
                clearTimeout(ollamaColdStartTimerId);
                this.sendTraceUpdate(session.id, thinkingStepId, {
                  title: 'Processing request...',
                });
              }
              const parsed = thinkParser.push(ame.delta);
              if (parsed.thinking) {
                this.sendToRenderer({
                  type: 'stream.thinking',
                  payload: { sessionId: session.id, delta: parsed.thinking },
                });
              }
              if (parsed.text) {
                streamedText += parsed.text;
                this.sendPartial(session.id, parsed.text);
              }
            } else if (ame.type === 'thinking_delta') {
              // Clear Ollama cold-start indicator on first stream event
              if (!receivedFirstStreamEvent && ollamaColdStartTimerId) {
                receivedFirstStreamEvent = true;
                clearTimeout(ollamaColdStartTimerId);
                this.sendTraceUpdate(session.id, thinkingStepId, {
                  title: 'Processing request...',
                });
              }
              // Forward thinking delta to renderer for real-time display
              this.sendToRenderer({
                type: 'stream.thinking',
                payload: { sessionId: session.id, delta: ame.delta },
              });
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
              logCtxError('[ClaudeAgentRunner] pi-ai stream error:', ame.reason, errorDetail);
            }
            break;
          }

          case 'message_end': {
            // Unified handler: send the final assistant message to the renderer.
            // Works for all providers (some emit 'done' via message_update, others don't).
            if (controller.signal.aborted) break;

            // Flush any buffered content from the think-tag parser
            const flushed = thinkParser.flush();
            if (flushed.thinking) {
              this.sendToRenderer({
                type: 'stream.thinking',
                payload: { sessionId: session.id, delta: flushed.thinking },
              });
            }
            if (flushed.text) {
              streamedText += flushed.text;
              this.sendPartial(session.id, flushed.text);
            }

            const msg = event.message;
            log(
              '[ClaudeAgentRunner] message_end raw message:',
              safeStringify(msg, 2)
            );
            const resolvedPayload = resolveMessageEndPayload({
              message: msg as any,
              streamedText,
            });
            streamedText = resolvedPayload.nextStreamedText;
            if (resolvedPayload.errorText) {
              if (!hasEmittedError) {
                hasEmittedError = true;
                this.sendMessage(session.id, {
                  id: uuidv4(),
                  sessionId: session.id,
                  role: 'assistant',
                  content: [{
                    type: 'text',
                    text: `**Error**: ${resolvedPayload.errorText}\n\n${
                      /\b4\d{2}\b/.test(resolvedPayload.errorText)
                        ? '_请检查配置后重试。_'
                        : '_Agent 正在自动重试，请稍候..._'
                    }`,
                  }],
                  timestamp: Date.now(),
                });
              }
              break;
            }
            if (resolvedPayload.shouldEmitMessage) {
              const contentBlocks: ContentBlock[] = [];
              for (const block of resolvedPayload.effectiveContent) {
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
                } else if (block.type === 'thinking') {
                  // Include thinking blocks in the final message for UI display
                  contentBlocks.push({
                    type: 'thinking',
                    thinking: block.thinking,
                  });
                } else {
                  // Unknown block type — pass through as text so content isn't silently lost
                  log(`[ClaudeAgentRunner] Unknown content block type: ${(block as any).type}`);
                  const text = (block as any).text || JSON.stringify(block);
                  if (text) contentBlocks.push({ type: 'text', text });
                }
              }
              // Always clear partial text; send message even if only artifacts were extracted
              this.sendToRenderer({
                type: 'stream.partial',
                payload: { sessionId: session.id, delta: '' },
              });
              if (contentBlocks.length > 0) {
                const tokenUsage = normalizeTokenUsage((msg as any).usage);
                if ((msg as any).usage) {
                  log(
                    '[ClaudeAgentRunner] normalized usage:',
                    safeStringify(
                      {
                        raw: (msg as any).usage,
                        normalized: tokenUsage,
                      },
                      2
                    )
                  );
                }
                const assistantMsg: Message = {
                  id: uuidv4(),
                  sessionId: session.id,
                  role: 'assistant',
                  content: contentBlocks,
                  timestamp: Date.now(),
                  tokenUsage,
                };
                this.sendMessage(session.id, assistantMsg);
              }
            }
            break;
          }

          case 'tool_execution_start': {
            logCtx(`[ClaudeAgentRunner] Tool execution start: ${event.toolName}`);
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
            logCtx('[ClaudeAgentRunner] Agent finished');
            break;
          }

          case 'auto_compaction_start': {
            log('[ClaudeAgentRunner] Auto-compaction started, reason:', event.reason);
            compactionStepId = `compaction-${Date.now()}`;
            this.sendTraceStep(session.id, {
              id: compactionStepId,
              type: 'thinking',
              status: 'running',
              title: `Compacting context (${event.reason})...`,
              timestamp: Date.now(),
            });
            break;
          }

          case 'auto_compaction_end': {
            const status = event.aborted ? 'error' : (event.errorMessage ? 'error' : 'completed');
            const title = event.aborted
              ? '上下文压缩已中止'
              : event.errorMessage
                ? `上下文压缩失败: ${event.errorMessage}`
                : '上下文压缩完成';
            log('[ClaudeAgentRunner] Auto-compaction ended:', title, 'willRetry:', event.willRetry);
            if (compactionStepId) {
              this.sendTraceUpdate(session.id, compactionStepId, { status, title });
              compactionStepId = undefined;
            } else {
              // Fallback: no matching start event, send as new step
              this.sendTraceStep(session.id, {
                id: `compaction-end-${Date.now()}`,
                type: 'thinking',
                status,
                title,
                timestamp: Date.now(),
              });
            }
            break;
          }
        }
        } catch (subscribeErr) {
          logError('[ClaudeAgentRunner] Error in subscribe callback:', subscribeErr);
          if (compactionStepId) {
            this.sendTraceUpdate(session.id, compactionStepId, {
              status: 'error',
              title: 'Error during context compaction',
            });
            compactionStepId = undefined;
          }
          if (!hasEmittedError) {
            hasEmittedError = true;
            const errorText = toUserFacingErrorText(toErrorText(subscribeErr));
            this.sendMessage(session.id, {
              id: uuidv4(),
              sessionId: session.id,
              role: 'assistant',
              content: [{ type: 'text', text: `**Error**: ${errorText}` }],
              timestamp: Date.now(),
            });
          }
        }
      });

      // Execute the prompt with activity-based timeout
      try {
        resetActivityTimeout();
        try {
          const promptResult = await piSession.prompt(contextualPrompt);
          log('[ClaudeAgentRunner] prompt() returned:', JSON.stringify(promptResult ?? 'void').substring(0, 1000));
        } finally {
          if (activityTimeoutId) clearTimeout(activityTimeoutId);
          if (ollamaColdStartTimerId) clearTimeout(ollamaColdStartTimerId);
        }
      } finally {
        try { unsubscribe(); } catch (e) { logWarn('[ClaudeAgentRunner] unsubscribe error:', e); }
      }

      logTiming('pi-coding-agent prompt completed', runStartTime);

      // Complete - update the initial thinking step
      this.sendTraceUpdate(session.id, thinkingStepId, {
        status: 'completed',
        title: 'Task completed',
      });

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        const isTimeout = error.message?.toLowerCase().includes('timeout');
        if (isTimeout) {
          logCtx('[ClaudeAgentRunner] Aborted due to timeout');
          const errorMsg: Message = {
            id: uuidv4(),
            sessionId: session.id,
            role: 'assistant',
            content: [{ type: 'text', text: '**请求超时**：长时间未收到响应，操作已中止。' }],
            timestamp: Date.now(),
          };
          this.sendMessage(session.id, errorMsg);
          this.sendTraceUpdate(session.id, thinkingStepId, {
            status: 'error',
            title: 'Request timed out',
          });
        } else {
          logCtx('[ClaudeAgentRunner] Aborted by user');
          this.sendTraceUpdate(session.id, thinkingStepId, {
            status: 'completed',
            title: 'Cancelled',
          });
        }
      } else {
        logCtxError('[ClaudeAgentRunner] Error:', error);

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
        try {
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
        } catch (syncErr) {
          logError('[ClaudeAgentRunner] Sandbox sync error:', syncErr);
          this.sendMessage(session.id, {
            id: uuidv4(),
            sessionId: session.id,
            role: 'assistant',
            content: [{ type: 'text', text: `**Warning**: Sandbox sync failed: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}` }],
            timestamp: Date.now(),
          });
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
