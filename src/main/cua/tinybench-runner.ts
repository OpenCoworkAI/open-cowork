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
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
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
  inferPiApi,
} from '../claude/pi-model-resolution';
import type { RunResult, TaskSpec, ToolCallRecord } from './types';

const execAsync = promisify(exec);

const GUI_SYSTEM_PROMPT = `You are a GUI automation agent. You operate a real desktop computer through tools.

## Workflow
1. First, take a screenshot with screenshot_for_display to see the current screen state.
2. Analyze the screenshot to identify UI elements you need to interact with.
3. Execute actions using click, type_text, key_press, scroll, or drag tools.
4. Take another screenshot to verify your action worked.
5. Repeat until the task is complete.
6. When done, clearly state the result.

## Important Rules
- ALWAYS take a screenshot before and after actions to verify state.
- Use absolute coordinates from the screenshot. The screenshot resolution matches the display.
- For click targets, aim for the CENTER of the UI element.
- Wait briefly after actions that trigger animations or loading (use the wait tool).
- If an action fails, try an alternative approach.
- Be concise in your responses — focus on completing the task.`;

function resolveGuiOperateServerPath(): string {
  const explicit = process.env.GUI_OPERATE_SERVER_PATH?.trim();
  const candidates = [
    explicit,
    path.join(process.cwd(), 'dist-mcp', 'gui-operate-server.js'),
    path.join(process.cwd(), 'resources', 'mcp', 'gui-operate-server.js'),
  ].filter((v): v is string => Boolean(v));

  for (const candidate of candidates) {
    try {
      // Use sync check — only runs once at startup
      const stat = require('node:fs').statSync(candidate);
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
  const { stdout } = await execAsync(
    `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`
  );
  const activeApp = stdout.trim();
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

async function connectGuiOperate(): Promise<{
  client: Client;
  transport: StdioClientTransport;
  tools: McpToolInfo[];
}> {
  const serverPath = resolveGuiOperateServerPath();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env,
  });

  const client = new Client(
    { name: 'tinybench', version: '0.1.0' },
    { capabilities: {} }
  );

  await client.connect(transport);

  const { tools: rawTools } = await client.listTools();
  const tools: McpToolInfo[] = rawTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));

  return { client, transport, tools };
}

function bridgeToolsForPiSdk(
  client: Client,
  mcpTools: McpToolInfo[],
  allowedApps?: string[]
): ToolDefinition[] {
  return mcpTools.map((tool) => {
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
        // Safety zone check: block mutating tools if active app not in whitelist
        if (allowedApps?.length && MUTATING_TOOLS.has(tool.name)) {
          const { allowed, activeApp } = await checkActiveAppAllowed(allowedApps);
          if (!allowed) {
            console.warn(
              `[TinyBench] BLOCKED: "${tool.name}" — active app "${activeApp}" not in allowedApps [${allowedApps.join(', ')}]`
            );
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Action blocked: active application "${activeApp}" is not in the allowed list [${allowedApps.join(', ')}]. Please switch to an allowed application first.`,
                },
              ],
              details: undefined as unknown,
            };
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

        const textParts: string[] = [];
        if (result?.content) {
          for (const part of result.content) {
            if (part.type === 'text') textParts.push(part.text || '');
            else if (part.type === 'image')
              textParts.push('[image data returned]');
            else textParts.push(JSON.stringify(part));
          }
        }
        return {
          content: [{ type: 'text' as const, text: textParts.join('\n') }],
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
    const api = inferPiApi('openai');
    piModel = buildSyntheticPiModel(modelId, provider, 'openai', baseUrl || '', api);
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

async function runSetup(command: string | undefined): Promise<void> {
  if (!command) return;
  await execAsync(command, { shell: '/bin/zsh' });
  await new Promise((r) => setTimeout(r, 1500));
}

async function runTeardown(command: string | undefined): Promise<void> {
  if (!command) return;
  try {
    await execAsync(command, { shell: '/bin/zsh' });
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

  // Connect to gui-operate MCP
  const { client, transport, tools } = await connectGuiOperate();

  try {
    // Setup
    await runSetup(spec.setupCommand);

    // Bridge MCP tools for Pi SDK
    const customTools = bridgeToolsForPiSdk(client, tools, spec.allowedApps);
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
      model: piModel as unknown as Parameters<typeof createAgentSession>[0]['model'],
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
    };
  } finally {
    await runTeardown(spec.teardownCommand);
    try { await client.close(); } catch { /* noop */ }
    try { await transport.close(); } catch { /* noop */ }
  }
}
