import {
  createAgentSession,
  SessionManager as PiSessionManager,
  SettingsManager as PiSettingsManager,
  createCodingTools,
  type AgentSession as PiAgentSession,
} from '@mariozechner/pi-coding-agent';
import { getModel, type Model } from '@mariozechner/pi-ai';
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
import { buildMcpToolsPrompt } from '../utils/cowork-instructions';
import { PluginRuntimeService } from '../skills/plugin-runtime-service';
import { configStore } from '../config/config-store';
// import { PathGuard } from '../sandbox/path-guard';

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
 * Infer the pi-ai API type from a protocol/provider string.
 */
function inferApi(protocol: string): string {
  switch (protocol) {
    case 'anthropic': return 'anthropic-messages';
    case 'openai': return 'openai-completions';
    case 'gemini':
    case 'google': return 'google-generative-ai';
    default: return 'openai-completions'; // safest default for proxies
  }
}

/**
 * Build a synthetic Model for model IDs not found in the pi-ai registry.
 * Allows custom/private models behind proxies to work.
 */
function buildSyntheticModel(modelId: string, provider: string, protocol: string, baseUrl?: string): Model<any> {
  const api = baseUrl ? 'openai-completions' : inferApi(protocol);
  return {
    id: modelId,
    name: modelId,
    api,
    provider,
    baseUrl: baseUrl || '',
    reasoning: false,
    input: ['text', 'image'] as any,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  } as Model<any>;
}

/**
 * Resolve a pi-ai Model from provider/modelId string.
 * Accepts formats: "provider/model-id" or just "model-id".
 *
 * Resolution order for compound IDs like "anthropic/claude-sonnet-4":
 *   1. Try getModel(keyProvider, fullString) — works for aggregators (openrouter
 *      uses "anthropic/claude-sonnet-4" as the model ID itself).
 *   2. Try getModel(parsedProvider, parsedModelId) — works for native providers.
 *   3. Try common fallback providers.
 *
 * When no provider prefix, uses configProvider falling back to 'anthropic'.
 * If customBaseUrl is provided, overrides the model's baseUrl.
 */
function resolvePiModel(modelString: string, configProvider?: string, customBaseUrl?: string, rawProvider?: string): Model<any> | undefined {
  const keyProvider = configProvider === 'custom' ? 'anthropic' : (configProvider || 'anthropic');
  const parts = modelString.split('/');
  let model: Model<any> | undefined;

  if (parts.length >= 2) {
    const parsedProvider = parts[0];
    const parsedModelId = parts.slice(1).join('/');

    // 1. Try raw provider (e.g. openrouter) with full model string first
    if (rawProvider && rawProvider !== keyProvider && rawProvider !== parsedProvider) {
      model = getModel(rawProvider as any, modelString);
    }

    // 2. Try key provider (customProtocol) with full model string
    if (!model && keyProvider !== parsedProvider) {
      model = getModel(keyProvider as any, modelString);
    }

    // 3. Try parsed provider with parsed model ID (native lookup)
    if (!model) {
      model = getModel(parsedProvider as any, parsedModelId);
    }

    // 4. Fallback: try common providers
    if (!model) {
      for (const fp of ['openai', 'anthropic', 'google'].filter(p => p !== parsedProvider && p !== keyProvider)) {
        model = getModel(fp as any, parsedModelId);
        if (model) break;
      }
    }
  } else {
    // No provider prefix — try config provider, then common fallbacks
    model = getModel(keyProvider as any, modelString);
    if (!model) {
      for (const fp of ['openai', 'anthropic', 'google'].filter(p => p !== keyProvider)) {
        model = getModel(fp as any, modelString);
        if (model) break;
      }
    }
  }

  if (!model) return undefined;

  // Override baseUrl only when truly custom — don't overwrite a valid registry baseUrl
  // with a preset baseUrl (e.g. openrouter's /api vs registry's /api/v1)
  const isCustomProvider = (rawProvider === 'custom' || configProvider === 'custom');
  const modelHasBaseUrl = Boolean(model.baseUrl);
  if (customBaseUrl && (isCustomProvider || !modelHasBaseUrl)) {
    // When using a custom base URL, force openai-completions API
    // Most proxies don't support the newer openai-responses API
    const api = model.api === 'openai-responses' ? 'openai-completions' : model.api;
    model = { ...model, baseUrl: customBaseUrl, api } as typeof model;
  }

  // Aggregator providers (openrouter etc.) always use openai-completions API
  // regardless of the model's native protocol — the aggregator translates internally.
  // Check rawProvider because configProvider may be the customProtocol (e.g. "anthropic")
  const effectiveProvider = rawProvider || configProvider;
  if (effectiveProvider === 'openrouter' && model.api !== 'openai-completions') {
    model = { ...model, api: 'openai-completions' } as typeof model;
  }

  return model;
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
// Pending question resolver type
interface PendingQuestion {
  questionId: string;
  resolve: (answer: string) => void;
}

export class ClaudeAgentRunner {
  private sendToRenderer: (event: ServerEvent) => void;
  private saveMessage?: (message: Message) => void;
  private pathResolver: PathResolver;
  private mcpManager?: MCPManager;
  // @ts-expect-error stored for future plugin support
  private _pluginRuntimeService?: PluginRuntimeService;
  private activeControllers: Map<string, AbortController> = new Map();
  private piSessions: Map<string, PiAgentSession> = new Map(); // sessionId -> pi AgentSession
  private pendingQuestions: Map<string, PendingQuestion> = new Map(); // questionId -> resolver

  // Per-instance caches — invalidated when the underlying config changes.
  private _mcpServersCache: { fingerprint: string; servers: Record<string, unknown> } | null = null;
  private _skillsSetupDone = false;
  private _skillsPromptCache: { workingDir: string; prompt: string } | null = null;

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
    this._skillsPromptCache = null;
  }

  /** Call after the user changes MCP server config so the next query rebuilds mcpServers. */
  invalidateMcpServersCache(): void {
    this._mcpServersCache = null;
  }

  /**
   * Get MCP tools prompt for system instructions
   */
  private getMCPToolsPrompt(): string {
    return buildMcpToolsPrompt(this.mcpManager);
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

  /**
   * Scan for available skills and return formatted list for system prompt
   */
  private getAvailableSkillsPrompt(workingDir?: string): string {
    const skills: { name: string; description: string; skillMdPath: string }[] = [];
    
    // 1. Check built-in skills (highest priority for reading)
    const builtinSkillsPath = this.getBuiltinSkillsPath();
    if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
      try {
        const dirs = fs.readdirSync(builtinSkillsPath, { withFileTypes: true });
        for (const dir of dirs) {
          if (dir.isDirectory()) {
            const skillMdPath = path.join(builtinSkillsPath, dir.name, 'SKILL.md');
            if (fs.existsSync(skillMdPath)) {
              // Try to read description from SKILL.md frontmatter
              let description = `Skill for ${dir.name} file operations`;
              try {
                const content = fs.readFileSync(skillMdPath, 'utf-8');
                const descMatch = content.match(/description:\s*["']?([^"'\n]+)["']?/);
                if (descMatch) {
                  description = descMatch[1];
                }
              } catch (e) { /* ignore */ }
              
              skills.push({
                name: dir.name,
                description,
                skillMdPath,
              });
            }
          }
        }
      } catch (e) {
        logError('[ClaudeAgentRunner] Error scanning built-in skills:', e);
      }
    }
    
    // 2. Check global skills (configured skills directory)
    const globalSkillsPath = this.getConfiguredGlobalSkillsDir();
    if (fs.existsSync(globalSkillsPath)) {
      try {
        const dirs = fs.readdirSync(globalSkillsPath, { withFileTypes: true });
        for (const dir of dirs) {
          if (dir.isDirectory()) {
            const skillMdPath = path.join(globalSkillsPath, dir.name, 'SKILL.md');
            if (fs.existsSync(skillMdPath)) {
              // Global skills can override built-in but not project-level
              const existingIdx = skills.findIndex(s => s.name === dir.name);
              let description = `User skill for ${dir.name}`;
              try {
                const content = fs.readFileSync(skillMdPath, 'utf-8');
                const descMatch = content.match(/description:\s*["']?([^"'\n]+)["']?/);
                if (descMatch) {
                  description = descMatch[1];
                }
              } catch (e) { /* ignore */ }

              const skill = { name: dir.name, description, skillMdPath };
              if (existingIdx >= 0) {
                skills[existingIdx] = skill;
              } else {
                skills.push(skill);
              }
            }
          }
        }
      } catch (e) {
        logError('[ClaudeAgentRunner] Error scanning global skills:', e);
      }
    }

    // 3. Check project-level skills (in working directory)
    if (workingDir) {
      const projectSkillsPaths = [
        path.join(workingDir, '.claude', 'skills'),
        path.join(workingDir, '.skills'),
        path.join(workingDir, 'skills'),
      ];

      for (const skillsDir of projectSkillsPaths) {
        if (fs.existsSync(skillsDir)) {
          try {
            const dirs = fs.readdirSync(skillsDir, { withFileTypes: true });
            for (const dir of dirs) {
              if (dir.isDirectory()) {
                const skillMdPath = path.join(skillsDir, dir.name, 'SKILL.md');
                if (fs.existsSync(skillMdPath)) {
                  // Project skills can override built-in and global
                  const existingIdx = skills.findIndex(s => s.name === dir.name);
                  let description = `Project skill for ${dir.name}`;
                  try {
                    const content = fs.readFileSync(skillMdPath, 'utf-8');
                    const descMatch = content.match(/description:\s*["']?([^"'\n]+)["']?/);
                    if (descMatch) {
                      description = descMatch[1];
                    }
                  } catch (e) { /* ignore */ }

                  const skill = { name: dir.name, description, skillMdPath };
                  if (existingIdx >= 0) {
                    skills[existingIdx] = skill;
                  } else {
                    skills.push(skill);
                  }
                }
              }
            }
          } catch (e) { /* ignore */ }
        }
      }
    }
    
    if (skills.length === 0) {
      return '<available_skills>\nNo skills available.\n</available_skills>';
    }
    
    // Format the skills list – include both SKILL.md path and skill base directory
    // so the model can resolve relative script references.
    const skillsList = skills.map(s => {
      const skillDir = path.dirname(s.skillMdPath);
      return `- **${s.name}**: ${s.description}\n  SKILL.md path: ${s.skillMdPath}\n  Skill directory: ${skillDir}`;
    }).join('\n');

    return `<available_skills>
The following skills are available. **CRITICAL**: Before starting any task that involves creating or editing files of these types, you MUST first read the corresponding SKILL.md file using the Read tool:

${skillsList}

**How to use skills:**
1. Identify which skill is relevant to your task (e.g., "pptx" for PowerPoint, "docx" for Word, "pdf" for PDF)
2. Use the Read tool to read the SKILL.md file at the path shown above
3. Follow the instructions in the SKILL.md file exactly
4. The skills contain proven workflows that produce high-quality results

**CRITICAL – Resolving script and resource paths inside skills:**
Skills reference helper scripts and resources using **relative paths** (e.g. \`python scripts/rearrange.py\`, \`tar -xzf html2pptx.tgz\`). These paths are relative to the **Skill directory** shown above, NOT the current working directory.
When you encounter a relative path in a SKILL.md, you MUST resolve it against that skill's directory. For example:
- SKILL.md says: \`python scripts/rearrange.py template.pptx out.pptx 0,1,2\`
- Skill directory is: /path/to/.claude/skills/pptx
- You should run: \`python /path/to/.claude/skills/pptx/scripts/rearrange.py template.pptx out.pptx 0,1,2\`

Similarly, for \`python3\` / \`python\` / \`node\` commands, always use the full command name available on this system. If a command is not found, try common alternatives (python3 instead of python, node instead of nodejs, etc.).

**Example**: If the user asks to create a PowerPoint presentation:
\`\`\`
Read the file: ${skills.find(s => s.name === 'pptx')?.skillMdPath || '[pptx skill path]'}
\`\`\`
Then follow the workflow described in that file, resolving all script paths against the skill directory.
</available_skills>`;
  }

  constructor(
    options: AgentRunnerOptions,
    pathResolver: PathResolver,
    mcpManager?: MCPManager,
    pluginRuntimeService?: PluginRuntimeService
  ) {
    this.sendToRenderer = options.sendToRenderer;
    this.saveMessage = options.saveMessage;
    this.pathResolver = pathResolver;
    this.mcpManager = mcpManager;
    this._pluginRuntimeService = pluginRuntimeService;
    
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

  // Handle user's answer to AskUserQuestion
  handleQuestionResponse(questionId: string, answer: string): boolean {
    const pending = this.pendingQuestions.get(questionId);
    if (pending) {
      log(`[ClaudeAgentRunner] Question ${questionId} answered:`, answer);
      pending.resolve(answer);
      this.pendingQuestions.delete(questionId);
      return true;
    } else {
      logWarn(`[ClaudeAgentRunner] No pending question found for ID: ${questionId}`);
      return false;
    }
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
      let piModel = resolvePiModel(modelString, configProtocol, runtimeConfig.baseUrl?.trim() || undefined, runtimeConfig.provider);

      if (!piModel) {
        // Synthetic fallback: construct a Model for unknown/custom models
        const parts = modelString.split('/');
        const syntheticId = parts.length >= 2 ? parts.slice(1).join('/') : modelString;
        const syntheticProvider = parts.length >= 2 ? parts[0] : (configProtocol === 'custom' ? 'anthropic' : configProtocol);
        piModel = buildSyntheticModel(syntheticId, syntheticProvider, configProtocol, runtimeConfig.baseUrl?.trim() || undefined);
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

      // Build available skills section dynamically (cached per workingDir)
      const cacheKey = workingDir ?? '';
      const availableSkillsPrompt = (this._skillsPromptCache?.workingDir === cacheKey)
        ? this._skillsPromptCache.prompt
        : (() => {
          const prompt = this.getAvailableSkillsPrompt(workingDir);
          this._skillsPromptCache = { workingDir: cacheKey, prompt };
          return prompt;
        })();

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
          logError(
            '[ClaudeAgentRunner] Failed to read enabled MCP configs; continuing without MCP overrides',
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

      const includeVerboseMcpPrompt = process.env.COWORK_INCLUDE_MCP_TOOLS_PROMPT !== '0';
      const includeCredentialsPrompt = /login|sign[\s-]?in|credential|password|gmail|邮箱|登录|账号|密码/i.test(prompt);
      const systemPromptSections = [
        'You are an Open Cowork assistant. Be concise, accurate, and tool-capable.',
        `CRITICAL BEHAVIORAL RULES:
1. CHAT FIRST: By default, respond to the user in plain text within the conversation. Do NOT create, write, or edit files unless the user explicitly asks you to (e.g., "create a file", "write this to...", "edit the code", "save as...", mentions a specific file path, or describes code changes they want applied). For questions, summaries, explanations, analysis, and general conversation — always reply directly in chat text.
2. NEVER ask clarification questions in plain text. When a request is actionable, proceed immediately with reasonable assumptions. If you truly cannot proceed without user input, you MUST use the AskUserQuestion tool — never write questions as regular assistant text.
3. For relative time windows like "within two days" in browsing or research tasks, assume the most recent two relevant publication days unless the user explicitly defines another date range.
4. For bracketed placeholders like [Agent], [Topic], etc., treat the word inside brackets as the literal search keyword unless the user says otherwise.
5. When given a task, START DOING IT. Do not restate the task, do not list what you will do, do not ask for confirmation. Just execute.`,
        workspaceInfoPrompt,
        availableSkillsPrompt,
        includeVerboseMcpPrompt
          ? this.getMCPToolsPrompt()
          : `<mcp_tools>
MCP tools are available at runtime. Use tool names exactly as exposed by the init system message (mcp__<ServerName>__<toolName>).
</mcp_tools>`,
        `<citation_requirements>
If your answer uses linkable content from MCP tools, include a "Sources:" section and otherwise use standard Markdown links: [Title](https://claude.ai/chat/URL).
</citation_requirements>`,
        `<tool_behavior>
AskUserQuestion:
- ONLY use AskUserQuestion when you absolutely cannot proceed without user input AND the missing detail would make the next action likely wrong.
- NEVER write questions, confirmations, or "before I start" preambles in plain assistant text. This is strictly forbidden.
- When in doubt, make a reasonable assumption and proceed. Action is always preferred over asking.

TodoWrite:
- Use TodoWrite for non-trivial tasks that involve tool calls.
- Keep one item marked as in_progress when actively executing.
- Include a final verification step before completion.

Tool routing:
- If user explicitly asks to use Chrome/browser/web navigation, prioritize Chrome MCP tools (mcp__Chrome__*) over generic WebSearch/WebFetch.
- Use WebSearch/WebFetch only when Chrome MCP is unavailable or the user explicitly asks for generic web search.
</tool_behavior>`,
        includeCredentialsPrompt ? this.getCredentialsPrompt() : '',
      ].filter((section): section is string => Boolean(section && section.trim()));
      const systemPromptText = systemPromptSections.join('\n\n');

      logTiming('before pi-coding-agent session creation');

      // Resolve thinking level for pi-coding-agent
      type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
      const thinkingLevel: PiThinkingLevel = enableThinking ? 'medium' : 'off';

      // Create or reuse pi-coding-agent session
      const effectiveCwd = (useSandboxIsolation && sandboxPath) ? sandboxPath : (workingDir || process.cwd());

      const { DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
      const resourceLoader = new DefaultResourceLoader({
        cwd: effectiveCwd,
        systemPromptOverride: () => systemPromptText,
      });
      await resourceLoader.reload();

      const modelRegistry = new ModelRegistry(authStorage);
      const { session: piSession } = await createAgentSession({
        model: piModel,
        thinkingLevel,
        authStorage,
        modelRegistry,
        tools: createCodingTools(effectiveCwd),
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
                }
              }
              if (contentBlocks.length > 0) {
                // Clear any partial text
                this.sendToRenderer({
                  type: 'stream.partial',
                  payload: { sessionId: session.id, delta: '' },
                });
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

      // Execute the prompt
      try {
        const promptResult = await piSession.prompt(contextualPrompt);
        log('[ClaudeAgentRunner] prompt() returned:', JSON.stringify(promptResult ?? 'void').substring(0, 1000));
      } finally {
        unsubscribe();
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
