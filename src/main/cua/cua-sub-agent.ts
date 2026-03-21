/**
 * @module main/cua/cua-sub-agent
 *
 * CUA Sub-Agent: spawns a second Pi SDK session with the same Ollama model
 * for context-isolated GUI task execution.
 *
 * The sub-agent gets its own context window (filled with screenshots),
 * executes the GUI task, and returns only a text summary to the main agent.
 * All screenshot context is discarded when the sub-agent session ends.
 */

import {
  createAgentSession,
  SessionManager as PiSessionManager,
  SettingsManager as PiSettingsManager,
} from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { getSharedAuthStorage, ModelRegistry } from '../claude/shared-auth';
import { buildSyntheticPiModel } from '../claude/pi-model-resolution';
import { buildCuaTools } from './cua-tools';
import { CUA_FEW_SHOT_EXAMPLES } from './cua-few-shot-examples';
import { TrajectoryLogger } from './cua-trajectory';
import { LoopDetector } from './cua-loop-detector';
import { log, logError } from '../utils/logger';
import * as http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

const execFileAsync = promisify(execFile);
const PLATFORM = os.platform();

// ─── CUA System Prompt (minimal — details go in tool descriptions) ──────────

const CUA_SYSTEM_PROMPT = `/no_think
You are a computer use agent. Complete the task by taking screenshots and performing actions.
Always screenshot first, then act. Verify each action with another screenshot.
Be concise and efficient. If stuck after 3 attempts, explain why and stop.
Never click Send, Submit, Delete, or Purchase unless explicitly required.
IMPORTANT: To open applications, use the launch_app tool instead of Win key shortcuts.
The Win key can lock the screen on Windows 11 and must NOT be used.`;

// ─── Ollama Health Check ────────────────────────────────────────────────────

/**
 * Validate that Ollama is running and the model is available.
 * Returns null if healthy, or an error message string.
 */
async function validateOllamaHealth(baseUrl: string, model: string): Promise<string | null> {
  const ollamaBase = baseUrl.replace(/\/v1\/?$/, '');
  try {
    // Check Ollama is running
    const tagsResult = await httpGet(`${ollamaBase}/api/tags`, 3000);
    if (!tagsResult) return `Ollama is not running at ${ollamaBase}. Run: ollama serve`;

    // Check model is downloaded
    const showResult = await httpPost(`${ollamaBase}/api/show`, { name: model }, 5000);
    if (!showResult) return `Model "${model}" not found in Ollama. Run: ollama pull ${model}`;

    return null; // healthy
  } catch {
    return `Cannot connect to Ollama at ${ollamaBase}. Run: ollama serve`;
  }
}

function httpGet(url: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => data += chunk);
      res.on('end', () => resolve(res.statusCode === 200 ? data : null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function httpPost(url: string, body: object, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => data += chunk);
      res.on('end', () => resolve(res.statusCode === 200 ? data : null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

// ─── Display Wake Lock ──────────────────────────────────────────────────────

async function preventDisplaySleep(): Promise<void> {
  if (PLATFORM === 'win32') {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Add-Type @"\nusing System.Runtime.InteropServices;\npublic class CuaPower { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f); }\n"@\n[CuaPower]::SetThreadExecutionState(0x80000003)`,
    ]).catch(() => {});
  }
  // macOS: caffeinate is handled by Electron's powerSaveBlocker
}

async function allowDisplaySleep(): Promise<void> {
  if (PLATFORM === 'win32') {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Add-Type @"\nusing System.Runtime.InteropServices;\npublic class CuaPower { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f); }\n"@\n[CuaPower]::SetThreadExecutionState(0x80000000)`,
    ]).catch(() => {});
  }
}

// ─── Sub-Agent Execution ────────────────────────────────────────────────────

export interface CuaTaskResult {
  success: boolean;
  summary: string;
  stepsUsed: number;
  trajectoryDir?: string;
  failureType?: 'max_steps' | 'loop' | 'exception' | 'model_gave_up' | 'ollama_unavailable';
}

export async function executeCuaTask(
  instruction: string,
  options: {
    model?: string;
    provider?: string;
    baseUrl?: string;
    maxTurns?: number;
  } = {},
): Promise<CuaTaskResult> {
  const {
    model = 'qwen3.5:9b',
    provider = 'ollama',
    baseUrl = 'http://localhost:11434/v1',
    maxTurns = 15,
  } = options;

  log('[CUA] Starting sub-agent task:', instruction);
  log('[CUA] Model:', model, 'Provider:', provider, 'Max turns:', maxTurns);

  // #29: Validate Ollama health before creating session
  const healthError = await validateOllamaHealth(baseUrl, model);
  if (healthError) {
    logError('[CUA] Ollama health check failed:', healthError);
    return {
      success: false,
      summary: healthError,
      stepsUsed: 0,
      failureType: 'ollama_unavailable',
    };
  }

  // #31: Prevent display sleep during CUA task
  await preventDisplaySleep();

  const trajectory = new TrajectoryLogger();
  const loopDetector = new LoopDetector();

  // #32: Temperature 0 for deterministic coordinate output
  const piModel = buildSyntheticPiModel(
    model,
    provider,
    'openai',
    baseUrl,
    undefined,
    false,    // reasoning off
    32768,    // contextWindow: 32K
    4096,     // maxTokens
  );

  const authStorage = getSharedAuthStorage();
  const cuaTools = buildCuaTools({ loopDetector, trajectory });

  const { session: subSession } = await createAgentSession({
    model: piModel,
    authStorage,
    modelRegistry: new ModelRegistry(authStorage),
    tools: [],
    customTools: cuaTools,
    sessionManager: PiSessionManager.inMemory(),
    settingsManager: PiSettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: true, maxRetries: 2 },
    }),
    cwd: process.cwd(),
    resourceLoader: {
      loadResource: async () => null,
      listResources: async () => [],
      reload: async () => {},
      watchResources: () => ({ close: () => {} }),
    } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  log('[CUA] Sub-agent session created');
  log('[CUA] Trajectory dir:', trajectory.getSessionDir());

  let failureType: CuaTaskResult['failureType'];
  let finalResponse = '';
  let turnCount = 0;
  let toolCallCount = 0;
  let unsubscribe: (() => void) | undefined;

  // beforeToolCall hook for step budget enforcement
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent = subSession.agent as any;
  if (typeof agent.setBeforeToolCall === 'function') {
    agent.setBeforeToolCall(async () => {
      toolCallCount++;
      if (toolCallCount > maxTurns * 2) {
        return { block: true, reason: `Step budget exhausted (${toolCallCount} tool calls). Summarize what you accomplished.` };
      }
      return undefined;
    });
  }

  try {
    unsubscribe = subSession.subscribe((event) => {
      if (event.type === 'message_end') {
        turnCount++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const message = (event as any).message;
        if (message?.role === 'assistant' && message?.content) {
          const textParts = message.content
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((c: any) => c.type === 'text')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((c: any) => c.text);
          if (textParts.length > 0) {
            finalResponse = textParts.join('\n');
          }
        }
        log(`[CUA] Turn ${turnCount}/${maxTurns} (${toolCallCount} tool calls)`);
      }
    });

    // #35: Simplified system prompt + few-shot examples
    const taskMessage = `${CUA_SYSTEM_PROMPT}\n\n${CUA_FEW_SHOT_EXAMPLES}\n\n## Your Task\n${instruction}\n\nStart by taking a screenshot.`;
    await subSession.prompt(taskMessage);

    log('[CUA] Sub-agent completed after', turnCount, 'turns');

    if (turnCount >= maxTurns && !finalResponse.toLowerCase().includes('complete')) {
      failureType = 'max_steps';
    }

    await trajectory.writeSummary({
      success: !failureType,
      summary: finalResponse || 'No text response',
      totalSteps: turnCount,
    });

    return {
      success: !failureType,
      summary: finalResponse || 'Task completed (no text response from agent)',
      stepsUsed: turnCount,
      trajectoryDir: trajectory.getSessionDir(),
      failureType,
    };
  } catch (error) {
    logError('[CUA] Sub-agent task failed:', error);
    failureType = 'exception';

    await trajectory.writeSummary({
      success: false,
      summary: `Exception: ${error instanceof Error ? error.message : String(error)}`,
      totalSteps: 0,
    }).catch(() => {});

    return {
      success: false,
      summary: `Task failed: ${error instanceof Error ? error.message : String(error)}`,
      stepsUsed: 0,
      trajectoryDir: trajectory.getSessionDir(),
      failureType,
    };
  } finally {
    unsubscribe?.();
    subSession.dispose();
    await allowDisplaySleep(); // #31: Release wake lock
    log('[CUA] Sub-agent session disposed');
  }
}

// ─── Main Agent Tool Definition ─────────────────────────────────────────────

export function buildComputerUseTool(
  modelConfig?: { model?: string; provider?: string; baseUrl?: string },
): ToolDefinition {
  return {
    name: 'computer_use',
    label: 'Computer Use',
    description: 'Execute a GUI task on the computer. A sub-agent will take screenshots, click, type, and perform actions autonomously. Only a text summary is returned — screenshots stay in the sub-agent\'s isolated context. Use this for tasks that require visual interaction with the desktop, like opening apps, clicking buttons, filling forms, etc.',
    promptSnippet: 'computer_use: Execute a GUI task on the computer via a sub-agent (context-isolated)',
    parameters: Type.Object({
      instruction: Type.String({ description: 'Natural language description of the GUI task to perform' }),
      max_steps: Type.Optional(Type.Number({ description: 'Maximum number of agent turns (default: 15)', default: 15 })),
    }),
    async execute(_toolCallId, params) {
      const { instruction, max_steps } = params as { instruction: string; max_steps?: number };
      log('[CUA] Main agent delegated task:', instruction);

      const result = await executeCuaTask(instruction, {
        ...modelConfig,
        maxTurns: max_steps || 15,
      });

      const statusText = result.success ? 'DONE' : 'FAILED';
      const summary = `[CUA ${statusText}] ${result.summary} (${result.stepsUsed} steps)`;

      return {
        content: [{ type: 'text' as const, text: summary }],
        details: undefined,
      };
    },
  };
}
