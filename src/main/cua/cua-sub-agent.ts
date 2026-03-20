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
// AgentSessionEventListener handles subscribe events
import { getSharedAuthStorage, ModelRegistry } from '../claude/shared-auth';
import { buildSyntheticPiModel } from '../claude/pi-model-resolution';
import { buildCuaTools } from './cua-tools';
import { log, logError } from '../utils/logger';

// ─── CUA System Prompt ──────────────────────────────────────────────────────

const CUA_SYSTEM_PROMPT = `/no_think
You are a computer use agent. You interact with the screen using the provided tools.

## Workflow
1. Take a **screenshot** to see the current screen.
2. Analyze what you see. Identify the specific UI element you need to interact with.
3. Execute ONE action (click, type_text, key_press, or scroll).
4. Take another **screenshot** to verify the action worked.
5. Repeat until the task is complete.

## Coordinates
- Screenshots are ${1280}×${720} pixels.
- When clicking, use pixel coordinates from the screenshot image.
- (0,0) is top-left, (${1280},${720}) is bottom-right.
- Look carefully at the screenshot to identify the exact position of UI elements before clicking.

## Rules
- Always screenshot FIRST to observe the current state.
- After every click or key_press, take a screenshot to verify the result.
- If the screen looks unchanged after an action, your action may have missed. Try a different approach.
- If you see an unexpected dialog or popup, handle it (close or respond) before continuing.
- If you are stuck after 3 attempts at the same action, explain why and stop.
- Never click buttons labeled Send, Submit, Delete, or Purchase unless the task explicitly requires it.
- Be concise. Focus on completing the task efficiently.`;

// ─── Sub-Agent Execution ────────────────────────────────────────────────────

export interface CuaTaskResult {
  success: boolean;
  summary: string;
  stepsUsed: number;
}

/**
 * Execute a CUA task by spawning a sub-agent session.
 *
 * The sub-agent uses the same Ollama model as the main agent,
 * but has its own isolated context window. All screenshots and
 * tool interactions stay in the sub-agent's context and are
 * discarded when this function returns.
 */
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

  // Build model — same function used by main agent for Ollama
  const piModel = buildSyntheticPiModel(
    model,
    provider,
    'openai',     // Ollama uses OpenAI-compatible protocol
    baseUrl,
    undefined,    // api override
    false,        // reasoning off for CUA (avoids </think> corruption bug)
    32768,        // contextWindow: 32K for CUA sub-agent (not 258K — prevents OOM)
    4096,         // maxTokens: action responses are short
  );

  // Auth — Ollama doesn't need API keys, but Pi SDK requires auth storage
  const authStorage = getSharedAuthStorage();

  // Build GUI tools
  const cuaTools = buildCuaTools();

  // Create isolated sub-agent session
  const { session: subSession } = await createAgentSession({
    model: piModel,
    authStorage,
    modelRegistry: new ModelRegistry(authStorage),
    tools: [],                                    // No coding tools — GUI only
    customTools: cuaTools,
    sessionManager: PiSessionManager.inMemory(),  // Isolated — no persistence
    settingsManager: PiSettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    }),
    cwd: process.cwd(),
    resourceLoader: {
      // Minimal resource loader — sub-agent doesn't need skills/prompts
      loadResource: async () => null,
      listResources: async () => [],
      reload: async () => {},
      watchResources: () => ({ close: () => {} }),
    } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  log('[CUA] Sub-agent session created');

  try {
    // Subscribe to events to capture the agent's messages
    let finalResponse = '';
    let turnCount = 0;

    const unsubscribe = subSession.subscribe((event) => {
      // Capture assistant text messages (the last one will be the task summary)
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
        log(`[CUA] Turn ${turnCount}`);
      }
    });

    // Send the task instruction — Pi SDK handles the agentic loop
    // (the agent will take screenshots, call tools, etc. autonomously)
    const taskMessage = `${CUA_SYSTEM_PROMPT}\n\n## Your Task\n${instruction}\n\nStart by taking a screenshot to see the current screen.`;
    await subSession.prompt(taskMessage);

    // Wait for the agent to finish (prompt() returns when done)
    unsubscribe();
    log('[CUA] Sub-agent completed after', turnCount, 'turns');

    return {
      success: true,
      summary: finalResponse || 'Task completed (no text response from agent)',
      stepsUsed: turnCount,
    };
  } catch (error) {
    logError('[CUA] Sub-agent task failed:', error);
    return {
      success: false,
      summary: `Task failed: ${error instanceof Error ? error.message : String(error)}`,
      stepsUsed: 0,
    };
  } finally {
    // Dispose sub-agent session — all screenshots and context are freed
    subSession.dispose();
    log('[CUA] Sub-agent session disposed');
  }
}

// ─── Main Agent Tool Definition ─────────────────────────────────────────────

/**
 * Build the computer_use ToolDefinition for the main agent.
 * This tool spawns a sub-agent to execute GUI tasks with context isolation.
 */
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
