/**
 * TinyBench Runner — drives GUI tasks through Pi Agent SDK + MCP tools.
 *
 * Flow:
 * 1. Connect to gui-operate MCP server (stdio)
 * 2. Bridge MCP tools as Pi SDK customTools
 * 3. Create Pi AgentSession with GUI system prompt
 * 4. Execute task prompt — SDK auto-loops tool_use calls
 * 5. Collect metrics and return RunResult
 */
import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type {
  SamplingMessage,
  SamplingMessageContentBlock,
  CreateMessageResult,
} from '@modelcontextprotocol/sdk/types.js';
import {
  createAgentSession,
  SessionManager as PiSessionManager,
  SettingsManager as PiSettingsManager,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent';
import { Type, type TSchema } from '@sinclair/typebox';
import { getSharedAuthStorage, ModelRegistry } from '../claude/shared-auth';
import {
  resolvePiRegistryModel,
  buildSyntheticPiModel,
} from '../claude/pi-model-resolution';
import type { RunResult, TaskSpec, ToolCallRecord } from './types';
import OpenAI from 'openai';
import sharp from 'sharp';

const execAsync = promisify(exec);
const IS_WINDOWS = os.platform() === 'win32';

// ---------------------------------------------------------------------------
// Screenshot compression — resize to logical resolution + JPEG to keep
// API payloads under relay size limits (~4.5MB PNG → ~200KB JPEG)
// ---------------------------------------------------------------------------
const MAX_SCREENSHOT_WIDTH = 1512;
const JPEG_QUALITY = 80;

async function compressScreenshot(
  base64Png: string,
): Promise<{ data: string; mimeType: string }> {
  const inputBuffer = Buffer.from(base64Png, 'base64');
  const jpegBuffer = await sharp(inputBuffer)
    .resize({ width: MAX_SCREENSHOT_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return {
    data: jpegBuffer.toString('base64'),
    mimeType: 'image/jpeg',
  };
}

// ---------------------------------------------------------------------------
// MCP Sampling: message format conversion
// ---------------------------------------------------------------------------

/**
 * Convert MCP SamplingMessage[] to OpenAI Responses API `input` format.
 *
 * MCP:  [{role:'user', content:[{type:'image', data, mimeType}, {type:'text', text}]}]
 * Resp: [{type:'message', role:'user', content:[{type:'input_image', image_url:'data:...'}, {type:'input_text', text}]}]
 */
export function convertMcpMessagesToResponsesInput(
  messages: SamplingMessage[],
): Array<Record<string, unknown>> {
  return messages.map((msg) => {
    const blocks: SamplingMessageContentBlock[] = Array.isArray(msg.content)
      ? msg.content
      : [msg.content];

    const content = blocks.map((block) => {
      if (block.type === 'image') {
        return {
          type: 'input_image',
          image_url: `data:${block.mimeType};base64,${block.data}`,
        };
      }
      if (block.type === 'text') {
        return { type: 'input_text', text: block.text };
      }
      return block;
    });

    return { type: 'message', role: msg.role, content };
  });
}

const GUI_SYSTEM_PROMPT = `You are a GUI automation agent controlling a real ${IS_WINDOWS ? 'Windows' : 'macOS'} desktop through tools.

## Coordinate System
- All coordinates are **absolute logical pixels** (not normalized, not physical).
- The screenshot resolution matches the display logical resolution.
- (0, 0) is the top-left corner of the primary display.
- Click the **CENTER** of the target UI element.

## Critical Rule
**You MUST perform at least one mutating action (click, type_text, key_press, scroll) before claiming a task is complete.** The screen may show STALE results from a previous session. Simply observing a result on screen does NOT mean you performed the task. Always execute the required actions yourself, then verify the result.

## Workflow
1. Use the **observe** tool to see the current screen state (screenshot + active app + mouse position).
2. Identify the UI element you need to interact with.
3. Execute exactly **ONE action** per turn (click, type_text, key_press, or scroll).
4. The action result includes an updated screenshot — examine it immediately.
5. Repeat steps 2-4 until the task is complete.
6. After you have performed ALL required actions and verified the result visually, state the final result and stop.

## Action Discipline
- Execute **ONE action per turn**. Never chain multiple actions without checking results.
- Prefer **keyboard shortcuts** over mouse clicks when possible (e.g., Cmd+V to paste, Enter to confirm, Escape to cancel, Cmd+Q to quit). Shortcuts are faster and more reliable.
- For Calculator: use key_press with digit keys ("0"-"9"), operator keys ("+", "-", "*", "/"), and "=" or Enter. This is far more reliable than clicking buttons.${IS_WINDOWS ? '\n- On Windows, use Ctrl instead of Cmd for keyboard shortcuts (e.g., Ctrl+C, Ctrl+V).' : ''}
- After typing or clicking, examine the screenshot feedback before proceeding.

## Error Recovery
- **NEVER repeat the exact same action more than twice.** If it didn't work twice, try a different approach.
- If a click doesn't hit the intended target, try adjusting coordinates by ±10-20 pixels.
- If an app becomes unresponsive, try Cmd+W to close the window and restart.
- If you see an unexpected dialog or popup, dismiss it first (Escape or click the close button).

## Stuck Detection
- If you notice you're making no progress after 3 actions, STOP and reassess.
- Ask yourself: "Am I interacting with the right element? Is the app in the expected state?"
- Try a completely different approach rather than repeating failed actions.
- If truly stuck, report what you see and what you've tried, then stop.

## Completion
- You may ONLY report completion AFTER you have performed all required actions yourself.
- If you see a result on screen but have not performed any actions yet, that is STALE state — you must still execute the task.
- When done, state the result in one sentence.
- Do NOT take extra screenshots after you already see the verified answer.`;

async function resolveGuiOperateServerPath(): Promise<string> {
  const explicit = process.env.GUI_OPERATE_SERVER_PATH?.trim();
  const candidates = [
    explicit,
    path.join(process.cwd(), 'dist-mcp', 'gui-operate-server.js'),
    path.join(process.cwd(), 'resources', 'mcp', 'gui-operate-server.js'),
  ].filter((v): v is string => Boolean(v));

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // not found, try next
    }
  }

  throw new Error(
    'gui-operate-server.js not found. Build MCP assets first: npm run build:mcp'
  );
}

// --- GUI safety zone: allowed-app check ---

const MUTATING_TOOLS = new Set([
  'click',
  'type_text',
  'key_press',
  'scroll',
  'drag',
  'move_mouse',
]);

export async function checkActiveAppAllowed(
  allowedApps: string[]
): Promise<{ allowed: boolean; activeApp: string }> {
  let activeApp: string;
  if (IS_WINDOWS) {
    // PowerShell: get foreground window process name
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "(Get-Process | Where-Object {$_.MainWindowHandle -eq (Add-Type -MemberDefinition '[DllImport(\\\"user32.dll\\\")] public static extern IntPtr GetForegroundWindow();' -Name Win32 -Namespace Temp -PassThru)::GetForegroundWindow()}).ProcessName"`,
      { shell: 'cmd.exe' }
    );
    activeApp = stdout.trim();
  } else {
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`
    );
    activeApp = stdout.trim();
  }
  const allowed = allowedApps.some((app) =>
    activeApp.toLowerCase().includes(app.toLowerCase())
  );
  return { allowed, activeApp };
}

interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

async function connectGuiOperate(
  envOverrides?: Record<string, string>,
  samplingConfig?: { apiKey: string; baseUrl: string; model: string }
): Promise<{
  client: Client;
  transport: StdioClientTransport;
  tools: McpToolInfo[];
}> {
  const serverPath = await resolveGuiOperateServerPath();
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
  if (envOverrides) {
    Object.assign(env, envOverrides);
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env,
  });

  // Declare sampling capability so the server can delegate vision calls back
  const client = new Client(
    { name: 'tinybench', version: '0.1.0' },
    { capabilities: samplingConfig ? { sampling: {} } : {} }
  );

  // Register sampling/createMessage handler — routes vision calls through
  // OpenAI Responses API using the same verified route as the main agent.
  if (samplingConfig) {
    const { apiKey, baseUrl, model } = samplingConfig;
    client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
      const { messages, maxTokens } = request.params;
      const input = convertMcpMessagesToResponsesInput(messages);

      const openai = new OpenAI({ apiKey, baseURL: baseUrl });
      const response = await openai.responses.create({
        model,
        input: input as never,
        max_output_tokens: maxTokens,
      });

      const text = response.output
        .filter((b: { type: string }) => b.type === 'message')
        .flatMap((b: { type: string; content?: Array<{ type: string; text?: string }> }) =>
          b.content ?? [],
        )
        .filter((c: { type: string }) => c.type === 'output_text')
        .map((c: { type: string; text?: string }) => c.text ?? '')
        .join('');

      return {
        model,
        role: 'assistant',
        content: { type: 'text', text },
      } satisfies CreateMessageResult;
    });
  }

  await client.connect(transport);

  const { tools: rawTools } = await client.listTools();
  const tools: McpToolInfo[] = rawTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));

  return { client, transport, tools };
}

// Only bridge these essential tools — reduces model confusion and action space
// Note: observe replaces screenshot_for_display — it returns screenshot + metadata
// (active app, mouse position, display info) in one call for richer context.
const CORE_TOOLS = new Set([
  'click',
  'type_text',
  'key_press',
  'scroll',
  'observe',
  'screenshot_for_display',
  'wait',
]);

// Stuck detection: ring buffer of recent tool calls
export interface RecentCall {
  tool: string;
  x?: number;
  y?: number;
  timestamp: number;
}

const STUCK_BUFFER_SIZE = 5;
const STUCK_WARN_THRESHOLD = 3;
const STUCK_ERROR_THRESHOLD = 5;
const STUCK_COORD_TOLERANCE = 20; // pixels

export function detectStuck(recentCalls: RecentCall[]): 'ok' | 'warn' | 'error' {
  if (recentCalls.length < STUCK_WARN_THRESHOLD) return 'ok';

  // Check last N calls for same tool + similar coordinates
  const checkCount = Math.min(recentCalls.length, STUCK_ERROR_THRESHOLD);
  const tail = recentCalls.slice(-checkCount);
  const first = tail[0];

  let consecutiveSame = 0;
  for (const call of tail) {
    if (call.tool !== first.tool) break;
    if (first.x !== undefined && call.x !== undefined) {
      if (Math.abs(call.x - first.x) > STUCK_COORD_TOLERANCE) break;
      if (first.y !== undefined && call.y !== undefined && Math.abs(call.y - first.y) > STUCK_COORD_TOLERANCE) break;
    }
    consecutiveSame++;
  }

  if (consecutiveSame >= STUCK_ERROR_THRESHOLD) return 'error';
  if (consecutiveSame >= STUCK_WARN_THRESHOLD) return 'warn';
  return 'ok';
}

function bridgeToolsForPiSdk(
  client: Client,
  mcpTools: McpToolInfo[],
  allowedApps?: string[],
  screenshotCapture?: { lastBase64: string | undefined }
): ToolDefinition[] {
  const recentCalls: RecentCall[] = [];

  return mcpTools.filter((tool) => CORE_TOOLS.has(tool.name)).map((tool) => {
    const parameters = Type.Unsafe<Record<string, unknown>>(
      tool.inputSchema as TSchema
    );
    return {
      name: tool.name,
      label: tool.name,
      description: tool.description || tool.name,
      parameters,
      async execute(
        _toolCallId: string,
        params: Record<string, unknown>,
        _signal: unknown,
        _onUpdate: unknown,
        _ctx: unknown
      ) {
        // Stuck detection: track and check recent calls
        const callEntry: RecentCall = {
          tool: tool.name,
          x: typeof params.x === 'number' ? params.x : undefined,
          y: typeof params.y === 'number' ? params.y : undefined,
          timestamp: Date.now(),
        };
        recentCalls.push(callEntry);
        if (recentCalls.length > STUCK_BUFFER_SIZE) recentCalls.shift();

        const stuckLevel = detectStuck(recentCalls);
        if (stuckLevel === 'error') {
          return {
            content: [{
              type: 'text' as const,
              text: 'STUCK DETECTED: You have repeated the same action 5 times with no progress. You MUST try a completely different approach. Consider using keyboard shortcuts, different coordinates, or reassessing the screen state.',
            }],
            details: undefined as unknown,
          };
        }

        // Soft focus check: try to bring allowed app to front, but don't block the action.
        // In automated bench mode, the terminal may hold focus — let the agent proceed
        // and discover wrong-app state via screenshot feedback (more robust than hard blocking).
        if (allowedApps?.length && MUTATING_TOOLS.has(tool.name)) {
          const { allowed, activeApp } = await checkActiveAppAllowed(allowedApps);
          if (!allowed) {
            console.warn(
              `[TinyBench] Focus check: "${activeApp}" is active, expected [${allowedApps.join(', ')}]. Attempting refocus...`
            );
            await focusAllowedApp(allowedApps);
            // Brief check after focus attempt
            const retry = await checkActiveAppAllowed(allowedApps);
            if (retry.allowed) {
              console.log(`[TinyBench] Refocused to "${retry.activeApp}" — proceeding with ${tool.name}`);
            } else {
              console.warn(
                `[TinyBench] Focus still on "${retry.activeApp}" — proceeding anyway (agent will verify via screenshot)`
              );
            }
          }
        }

        const result = (await client.callTool({
          name: tool.name,
          arguments: params,
        })) as {
          content?: Array<{
            type: string;
            text?: string;
            data?: string;
            mimeType?: string;
          }>;
          isError?: boolean;
        };

        // Build response — pass through ImageContent natively so Pi SDK's
        // Responses API adapter can send it as input_image (not bloated text)
        const contentParts: Array<
          { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
        > = [];
        if (result?.content) {
          for (const part of result.content) {
            if (part.type === 'text') {
              contentParts.push({ type: 'text' as const, text: part.text || '' });
            } else if (part.type === 'image' && part.data) {
              // Save raw base64 for judge evaluation
              if (screenshotCapture) {
                screenshotCapture.lastBase64 = part.data;
              }
              // Compress: 3024×1964 PNG (~4.7MB) → 1512×982 JPEG (~200KB)
              // to stay under MSRA relay request size limits
              const compressed = await compressScreenshot(part.data);
              contentParts.push({
                type: 'image' as const,
                data: compressed.data,
                mimeType: compressed.mimeType,
              });
            } else {
              contentParts.push({ type: 'text' as const, text: JSON.stringify(part) });
            }
          }
        }

        // Inject stuck warning if approaching threshold
        if (stuckLevel === 'warn') {
          contentParts.push({
            type: 'text' as const,
            text: '\n⚠️ WARNING: You seem stuck — you have repeated a similar action 3 times. Try a different approach or use keyboard shortcuts instead.',
          });
        }

        return {
          content: contentParts.length > 0 ? contentParts : [{ type: 'text' as const, text: 'OK' }],
          details: undefined as unknown,
        };
      },
    } as ToolDefinition;
  });
}

function resolveModel(
  modelName: string,
  apiKey?: string,
  baseUrl?: string
) {
  // Try pi-ai registry first
  const modelString = modelName.includes('/') ? modelName : `openai/${modelName}`;
  const parts = modelString.split('/');
  const provider = parts[0];
  const modelId = parts.slice(1).join('/');

  let piModel = resolvePiRegistryModel(modelString, {
    configProvider: provider,
    customBaseUrl: baseUrl,
    rawProvider: provider,
    customProtocol: 'openai',
  });

  if (!piModel) {
    // Use Responses API — completions is being deprecated by OpenAI
    piModel = buildSyntheticPiModel(modelId, provider, 'openai', baseUrl || '', 'openai-responses');
  }

  // Set API key
  if (apiKey) {
    const authStorage = getSharedAuthStorage();
    authStorage.setRuntimeApiKey(provider, apiKey);
    if (piModel && piModel.provider !== provider) {
      authStorage.setRuntimeApiKey(piModel.provider, apiKey);
    }
  }

  return { piModel: piModel!, modelString };
}

async function runSetup(command: string | undefined, allowedApps?: string[]): Promise<void> {
  if (!command) return;
  const shell = IS_WINDOWS ? 'cmd.exe' : '/bin/zsh';
  await execAsync(command, { shell });

  // Poll for the app window to be ready (up to 5s) instead of fixed sleep
  if (allowedApps?.length) {
    const appName = allowedApps[0];
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        let windowCount = 0;
        if (IS_WINDOWS) {
          const { stdout } = await execAsync(
            `powershell -NoProfile -Command "(Get-Process '${appName}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }).Count"`,
            { shell: 'cmd.exe' }
          );
          windowCount = parseInt(stdout.trim(), 10) || 0;
        } else {
          const { stdout } = await execAsync(
            `osascript -e 'tell application "System Events" to count windows of process "${appName}"'`
          );
          windowCount = parseInt(stdout.trim(), 10);
        }
        if (windowCount > 0) {
          console.log(`[TinyBench] Setup verified: "${appName}" has ${windowCount} window(s)`);
          return;
        }
      } catch {
        // Process not found yet — keep polling
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.warn(`[TinyBench] Setup timeout: "${appName}" window not detected after 5s, proceeding anyway`);
  } else {
    // No specific app to check — fallback to a short delay
    await new Promise((r) => setTimeout(r, 1500));
  }
}

export async function focusAllowedApp(allowedApps?: string[]): Promise<void> {
  if (!allowedApps?.length) return;
  const appName = allowedApps[0];
  if (IS_WINDOWS) {
    // PowerShell: bring window to front
    await execAsync(
      `powershell -NoProfile -Command "$p = Get-Process '${appName}' -ErrorAction SilentlyContinue | Select-Object -First 1; if($p) { [void][System.Reflection.Assembly]::LoadWithPartialName('Microsoft.VisualBasic'); [Microsoft.VisualBasic.Interaction]::AppActivate($p.Id) }"`,
      { shell: 'cmd.exe' }
    );
  } else {
    await execAsync(
      `osascript -e 'tell application "${appName}" to activate'`
    );
  }
  // Wait for window activation (1s is enough, 3s was too conservative)
  await new Promise((r) => setTimeout(r, 1000));
}

async function runTeardown(command: string | undefined): Promise<void> {
  if (!command) return;
  try {
    const shell = IS_WINDOWS ? 'cmd.exe' : '/bin/zsh';
    await execAsync(command, { shell });
  } catch {
    // best-effort
  }
}

export async function runTask(
  spec: TaskSpec,
  options?: { apiKey?: string; baseUrl?: string; signal?: AbortSignal }
): Promise<RunResult> {
  const startedAt = Date.now();
  await fs.mkdir(spec.outputDir, { recursive: true });

  const toolCalls: ToolCallRecord[] = [];
  let tokens = { input: 0, output: 0, total: 0 };
  let finalText = '';
  let steps = 0;
  const screenshotCapture: { lastBase64: string | undefined } = { lastBase64: undefined };

  // Build env overrides so the MCP server's vision API uses the correct model/key/base
  const mcpEnv: Record<string, string> = {};
  const apiKey = options?.apiKey || process.env.GUI_CUA_API_KEY || process.env.OPENAI_API_KEY || '';
  const baseUrl = options?.baseUrl || process.env.GUI_CUA_BASE_URL || process.env.OPENAI_BASE_URL || '';
  if (apiKey) mcpEnv.OPENAI_API_KEY = apiKey;
  if (baseUrl) mcpEnv.OPENAI_BASE_URL = baseUrl;
  mcpEnv.OPENAI_MODEL = spec.model;

  // Connect to gui-operate MCP — pass sampling config so vision calls route
  // through client's OpenAI SDK instead of server's broken HTTP path
  const samplingConfig = apiKey && baseUrl
    ? { apiKey, baseUrl, model: spec.model }
    : undefined;
  const { client, transport, tools } = await connectGuiOperate(mcpEnv, samplingConfig);

  try {
    // Setup
    await runSetup(spec.setupCommand, spec.allowedApps);
    await focusAllowedApp(spec.allowedApps);

    // Bridge MCP tools for Pi SDK
    const customTools = bridgeToolsForPiSdk(client, tools, spec.allowedApps, screenshotCapture);
    console.log(
      `[TinyBench] ${customTools.length} GUI tools bridged:`,
      customTools.map((t) => t.name).join(', ')
    );

    // Resolve model
    const { piModel, modelString } = resolveModel(
      spec.model,
      options?.apiKey || process.env.GUI_CUA_API_KEY || process.env.OPENAI_API_KEY,
      options?.baseUrl || process.env.GUI_CUA_BASE_URL || process.env.OPENAI_BASE_URL
    );
    console.log(`[TinyBench] Model: ${modelString}, provider: ${piModel.provider}`);

    // Create Pi Agent Session
    const authStorage = getSharedAuthStorage();
    const modelRegistry = new ModelRegistry(authStorage);

    const { DefaultResourceLoader } = await import(
      '@mariozechner/pi-coding-agent'
    );
    const resourceLoader = new DefaultResourceLoader({
      cwd: process.cwd(),
      appendSystemPrompt: GUI_SYSTEM_PROMPT,
    });
    await resourceLoader.reload();

    const { session: piSession } = await createAgentSession({
      model: piModel as any,
      thinkingLevel: 'off',
      authStorage,
      modelRegistry,
      tools: [] as unknown as ReturnType<typeof import('@mariozechner/pi-coding-agent').createCodingTools>,
      customTools,
      sessionManager: PiSessionManager.inMemory(),
      settingsManager: PiSettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: true, maxRetries: 2 },
      }),
      resourceLoader,
      cwd: process.cwd(),
    });

    // Track tool calls via subscription
    let toolCallIndex = 0;
    const unsubscribe = piSession.subscribe((event) => {
      if (event.type === 'message_update') {
        const ame = event.assistantMessageEvent;
        if (ame.type === 'toolcall_start') {
          const partial = ame.partial;
          const toolContent = partial?.content?.[ame.contentIndex];
          if (toolContent?.type === 'toolCall') {
            console.log(`[TinyBench]   → tool: ${toolContent.name}`);
          }
        }
      } else if (event.type === 'message_end') {
        const msg = event.message as { content?: Array<{ type: string; text?: string; name?: string }>; usage?: Record<string, number> };
        // Accumulate token usage from each message
        const usage = (msg as any)?.usage;
        if (usage) {
          tokens.input += usage.input ?? 0;
          tokens.output += usage.output ?? 0;
          tokens.total += usage.totalTokens ?? (usage.input ?? 0) + (usage.output ?? 0);
        }
        if (msg?.content) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              finalText = block.text;
            }
            if (block.type === 'toolCall') {
              steps++;
              toolCalls.push({
                index: toolCallIndex++,
                toolName: (block as { name?: string }).name || 'unknown',
                args: {},
                result: '',
                durationMs: 0,
                isError: false,
              });
            }
          }
        }
      } else if (event.type === 'turn_end') {
        const msg = event.message as { content?: Array<{ type: string; text?: string }>; usage?: Record<string, number> };
        // Also accumulate from turn_end in case message_end didn't carry usage
        const usage = (msg as any)?.usage;
        if (usage) {
          tokens.input += usage.input ?? 0;
          tokens.output += usage.output ?? 0;
          tokens.total += usage.totalTokens ?? (usage.input ?? 0) + (usage.output ?? 0);
        }
        if (msg?.content) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              finalText = block.text;
            }
          }
        }
      }
    });

    // Execute with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Timeout: ${spec.timeoutMs}ms`));
    }, spec.timeoutMs);

    try {
      await piSession.prompt(spec.prompt);
    } finally {
      clearTimeout(timeoutId);
      try { unsubscribe(); } catch { /* noop */ }
    }

    return {
      taskId: spec.id,
      passed: false, // evaluator decides
      steps,
      durationMs: Date.now() - startedAt,
      tokens,
      finalText,
      toolCalls,
      artifactDir: spec.outputDir,
      lastScreenshotBase64: screenshotCapture.lastBase64,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      taskId: spec.id,
      passed: false,
      steps,
      durationMs: Date.now() - startedAt,
      tokens,
      finalText,
      toolCalls,
      error: message,
      artifactDir: spec.outputDir,
      lastScreenshotBase64: screenshotCapture.lastBase64,
    };
  } finally {
    await runTeardown(spec.teardownCommand);
    try { await client.close(); } catch { /* noop */ }
    try { await transport.close(); } catch { /* noop */ }
  }
}
