import { Type } from '@sinclair/typebox';
import {
  createAgentSession,
  SessionManager as PiSessionManager,
  SettingsManager as PiSettingsManager,
  createCodingTools,
  DefaultResourceLoader,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent';
import type {
  AgentRuntimeExtension,
  BeforeSessionRunResult,
  BeforeSessionRunContext,
  AgentRuntimeCustomTool,
} from '../extensions/agent-runtime-extension';
import { getSharedAuthStorage, ModelRegistry } from './shared-auth';
import { MCPManager } from '../mcp/mcp-manager';
import { configStore } from '../config/config-store';
import { log, logError } from '../utils/logger';
import { resolvePiRegistryModel, resolvePiRouteProtocol } from './pi-model-resolution';
import type { ServerEvent } from '../../renderer/types';
import { v4 as uuidv4 } from 'uuid';

const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const TIMEOUT_MESSAGE = 'Subagent timed out';
const MAX_CONCURRENT_SUBAGENTS = 3;
const MAX_TASK_LENGTH = 10_000;

class SubagentTimeoutError extends Error {
  constructor() {
    super(TIMEOUT_MESSAGE);
  }
}

class ParentCancelledError extends Error {
  constructor() {
    super('Parent session cancelled');
  }
}

interface SubagentParams {
  task: string;
  result_format?: string;
  allowed_tools?: string[];
  timeout_seconds?: number;
}

function buildChildSystemPrompt(task: string, resultFormat?: string): string {
  const parts = [
    'You are a focused sub-agent. Complete the task below and return ONLY the result.',
    'Do not ask questions. Do not provide commentary beyond what is needed for the result.',
    '',
    `## Task`,
    task,
  ];
  if (resultFormat) {
    parts.push('', `## Expected Output Format`, resultFormat);
  }
  return parts.join('\n');
}

function safeSendEvent(sendEvent: SendEvent, event: ServerEvent): void {
  try {
    sendEvent(event);
  } catch {
    // Renderer may be disconnected — swallow to avoid disrupting tool execution
  }
}

type SubagentProgressPayload = Extract<ServerEvent, { type: 'subagent.progress' }>['payload'];

function buildProgressEvent(
  parentSessionId: string,
  subagentId: string,
  payload: Omit<SubagentProgressPayload, 'parentSessionId' | 'subagentId'>
): ServerEvent {
  return {
    type: 'subagent.progress',
    payload: { parentSessionId, subagentId, ...payload },
  };
}

type SendEvent = (event: ServerEvent) => void;
type PermissionHandler = (toolName: string, toolInput: unknown) => Promise<'allow' | 'deny'>;

function createSpawnSubagentTool(
  mcpManager: MCPManager | null,
  sendEvent: SendEvent,
  parentSessionId: string,
  requestPermission: PermissionHandler | null,
  getParentAbortSignal: () => AbortSignal | null,
  concurrencyState: { active: number }
): AgentRuntimeCustomTool {
  return {
    name: 'spawn_subagent',
    label: 'spawn_subagent',
    description:
      'Spawn a child agent to complete a focused sub-task in its own context. ' +
      'The child inherits your tools and config but not your conversation history. ' +
      'It cannot spawn further subagents. Use for tasks that benefit from isolated context.',
    parameters: Type.Object({
      task: Type.String({
        description:
          'A clear, self-contained description of what the child agent should accomplish. ' +
          'Include all necessary context since the child has no access to your conversation.',
      }),
      result_format: Type.Optional(
        Type.String({
          description:
            'Description of the desired output format. If omitted, the child returns free-form text.',
        })
      ),
      allowed_tools: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'Restrict MCP tools available to the child. Standard coding tools (read, write, edit, bash) are always available. If omitted, the child inherits all parent MCP tools.',
        })
      ),
      timeout_seconds: Type.Optional(
        Type.Number({
          description: 'Maximum execution time in seconds. Default: 120, max: 300.',
          minimum: 10,
          maximum: 300,
        })
      ),
    }),
    async execute(_toolCallId: string, params: unknown) {
      const { task, result_format, allowed_tools, timeout_seconds } = (params ||
        {}) as SubagentParams;

      if (!task || typeof task !== 'string' || task.trim().length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Error: task parameter is required.' }],
          details: undefined as unknown,
        };
      }

      if (task.length > MAX_TASK_LENGTH) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: task exceeds maximum length (${MAX_TASK_LENGTH} chars). Shorten the task description.`,
            },
          ],
          details: undefined as unknown,
        };
      }

      // Concurrency guard
      if (concurrencyState.active >= MAX_CONCURRENT_SUBAGENTS) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: maximum concurrent subagents (${MAX_CONCURRENT_SUBAGENTS}) reached. Wait for a running subagent to complete.`,
            },
          ],
          details: undefined as unknown,
        };
      }

      const timeoutMs = Math.min(
        (timeout_seconds || DEFAULT_TIMEOUT_MS / 1000) * 1000,
        MAX_TIMEOUT_MS
      );

      const subagentId = uuidv4();
      log(`[SubagentExtension] Spawning child ${subagentId} for task: "${task.slice(0, 100)}..."`);
      const startTime = Date.now();

      concurrencyState.active++;

      safeSendEvent(
        sendEvent,
        buildProgressEvent(parentSessionId, subagentId, {
          event: 'started',
          task: task.slice(0, 200),
        })
      );

      try {
        const config = configStore.getAll();
        const authStorage = getSharedAuthStorage();
        const modelRegistry = new ModelRegistry(authStorage);

        const modelString = config.model?.trim() || 'anthropic/claude-sonnet-4-6';
        const configProtocol = resolvePiRouteProtocol(config.provider, config.customProtocol);
        const piModel = resolvePiRegistryModel(modelString, {
          configProvider: configProtocol,
          customBaseUrl: config.baseUrl?.trim() || undefined,
          rawProvider: config.provider,
          customProtocol: config.customProtocol,
        });
        if (!piModel) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: could not resolve model for subagent. Check provider/model config.',
              },
            ],
            details: undefined as unknown,
          };
        }

        // Build MCP tools (minus spawn_subagent)
        let mcpCustomTools: ToolDefinition[] = [];
        if (mcpManager) {
          const mcpTools = mcpManager.getTools();
          mcpCustomTools = mcpTools.map((mcpTool) => {
            const parameters = Type.Unsafe<Record<string, unknown>>(
              mcpTool.inputSchema as Record<string, unknown>
            );
            return {
              name: mcpTool.name,
              label: `${mcpTool.serverName} → ${mcpTool.originalName || mcpTool.name}`,
              description: mcpTool.description || `MCP tool from ${mcpTool.serverName}`,
              parameters,
              async execute(_id: string, p: unknown) {
                const result = await mcpManager.callTool(
                  mcpTool.name,
                  p as Record<string, unknown>
                );
                const resultContent = (
                  result as { content?: Array<{ type: string; text?: string }> }
                )?.content;
                const text =
                  resultContent?.map((c) => (c.type === 'text' ? c.text : '')).join('') || '';
                return { content: [{ type: 'text' as const, text }], details: undefined };
              },
            } as ToolDefinition;
          });
        }

        if (allowed_tools && allowed_tools.length > 0) {
          const allowSet = new Set(allowed_tools);
          mcpCustomTools = mcpCustomTools.filter((t) => allowSet.has(t.name));
        }

        const cwd = config.defaultWorkdir || process.cwd();
        const codingTools = createCodingTools(cwd);

        const childSystemPrompt = buildChildSystemPrompt(task, result_format);
        const resourceLoader = new DefaultResourceLoader({
          cwd,
          appendSystemPrompt: childSystemPrompt,
        });
        await resourceLoader.reload();

        const { session: childSession } = await createAgentSession({
          model: piModel,
          authStorage,
          modelRegistry,
          tools: codingTools,
          customTools: mcpCustomTools,
          sessionManager: PiSessionManager.inMemory(),
          settingsManager: PiSettingsManager.inMemory({
            compaction: { enabled: false },
            retry: { enabled: true, maxRetries: 1 },
          }),
          resourceLoader,
          cwd,
        });

        // Install permission gating on child session (mirrors parent behavior)
        if (requestPermission) {
          const piSession = childSession as unknown as {
            setBeforeToolCall?: (
              hook: (call: {
                toolName: string;
                args: unknown;
              }) => Promise<{ block: boolean; reason?: string } | void>
            ) => void;
          };
          if (typeof piSession.setBeforeToolCall === 'function') {
            piSession.setBeforeToolCall(async (call) => {
              const decision = await requestPermission(call.toolName, call.args);
              if (decision === 'deny') {
                return { block: true, reason: 'Permission denied by parent session policy' };
              }
              return undefined;
            });
          } else {
            logError(
              '[SubagentExtension] Child session does not support setBeforeToolCall — permission gating disabled'
            );
          }
        }

        let finalText = '';
        const unsubscribe = childSession.subscribe((event) => {
          if (event.type === 'agent_end') {
            const messages = (event as { messages?: unknown[] }).messages || [];
            for (let i = messages.length - 1; i >= 0; i--) {
              const msg = messages[i] as { role?: string; content?: unknown } | undefined;
              if (msg && msg.role === 'assistant' && Array.isArray(msg.content)) {
                finalText = (msg.content as Array<{ type: string; text?: string }>)
                  .filter((b) => b.type === 'text' && b.text)
                  .map((b) => b.text)
                  .join('');
                break;
              }
            }
          }

          if (event.type === 'tool_execution_start') {
            safeSendEvent(
              sendEvent,
              buildProgressEvent(parentSessionId, subagentId, {
                event: 'tool_start',
                toolName: (event as { toolName?: string }).toolName || 'unknown',
              })
            );
          } else if (event.type === 'tool_execution_end') {
            const e = event as { toolName?: string; isError?: boolean };
            safeSendEvent(
              sendEvent,
              buildProgressEvent(parentSessionId, subagentId, {
                event: 'tool_end',
                toolName: e.toolName || 'unknown',
                isError: e.isError || false,
              })
            );
          } else if (event.type === 'message_update') {
            const e = event as { message?: { content?: unknown[] } };
            const content = e.message?.content;
            if (Array.isArray(content)) {
              const lastText = content
                .filter((b): b is { type: 'text'; text: string } => {
                  const block = b as { type?: string; text?: string };
                  return block.type === 'text' && typeof block.text === 'string';
                })
                .pop();
              if (lastText) {
                safeSendEvent(
                  sendEvent,
                  buildProgressEvent(parentSessionId, subagentId, {
                    event: 'text_delta',
                    text: lastText.text,
                  })
                );
              }
            }
          }
        });

        let timeoutId: NodeJS.Timeout | undefined;
        const parentSignal = getParentAbortSignal();
        let parentAbortHandler: (() => void) | undefined;

        try {
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new SubagentTimeoutError()), timeoutMs);
          });

          // Propagate parent cancellation
          const parentAbortPromise = parentSignal
            ? new Promise<never>((_, reject) => {
                if (parentSignal.aborted) {
                  reject(new ParentCancelledError());
                  return;
                }
                parentAbortHandler = () => reject(new ParentCancelledError());
                parentSignal.addEventListener('abort', parentAbortHandler);
              })
            : null;

          const racers: Promise<unknown>[] = [childSession.prompt(task), timeoutPromise];
          if (parentAbortPromise) racers.push(parentAbortPromise);

          await Promise.race(racers);
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
          if (parentAbortHandler && parentSignal) {
            parentSignal.removeEventListener('abort', parentAbortHandler);
          }
          unsubscribe();
          // Abort the child session to stop in-flight API calls and tool executions
          try {
            const abortable = childSession as unknown as { abort?: () => Promise<void> | void };
            if (abortable.abort) {
              const abortResult = abortable.abort();
              if (abortResult && typeof abortResult === 'object' && 'then' in abortResult) {
                const abortTimeout = new Promise<void>((r) => setTimeout(r, 5000));
                await Promise.race([abortResult, abortTimeout]);
              }
            }
          } catch {
            // abort may throw if session already completed — safe to ignore
          }
          childSession.dispose();
        }

        const durationMs = Date.now() - startTime;
        log(`[SubagentExtension] Child ${subagentId} completed in ${durationMs}ms`);

        safeSendEvent(
          sendEvent,
          buildProgressEvent(parentSessionId, subagentId, {
            event: 'completed',
            durationMs,
          })
        );

        return {
          content: [
            { type: 'text' as const, text: finalText || '(subagent produced no text output)' },
          ],
          details: undefined as unknown,
        };
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        const message = err instanceof Error ? err.message : String(err);
        logError(`[SubagentExtension] Child ${subagentId} failed after ${durationMs}ms:`, message);

        const isTimeout = err instanceof SubagentTimeoutError;
        const isCancelled = err instanceof ParentCancelledError;

        safeSendEvent(
          sendEvent,
          buildProgressEvent(parentSessionId, subagentId, {
            event: 'failed',
            error: isTimeout ? 'timeout' : isCancelled ? 'cancelled' : message.slice(0, 200),
            durationMs,
          })
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: isTimeout
                ? `Subagent timed out after ${Math.round(durationMs / 1000)}s. Consider simplifying the task or increasing timeout_seconds.`
                : isCancelled
                  ? 'Subagent cancelled: parent session was stopped.'
                  : `Subagent error: ${message}`,
            },
          ],
          details: undefined as unknown,
        };
      } finally {
        concurrencyState.active--;
      }
    },
  };
}

export class SubagentExtension implements AgentRuntimeExtension {
  readonly name = 'subagent';
  private concurrencyState = { active: 0 };

  constructor(
    private readonly getMcpManager: () => MCPManager | null,
    private readonly sendEvent: SendEvent,
    private readonly requestPermission: PermissionHandler | null = null,
    private readonly getParentAbortSignal: () => AbortSignal | null = () => null
  ) {}

  async beforeSessionRun(context: BeforeSessionRunContext): Promise<BeforeSessionRunResult> {
    return {
      customTools: [
        createSpawnSubagentTool(
          this.getMcpManager(),
          this.sendEvent,
          context.session.id,
          this.requestPermission,
          this.getParentAbortSignal,
          this.concurrencyState
        ),
      ],
    };
  }
}
