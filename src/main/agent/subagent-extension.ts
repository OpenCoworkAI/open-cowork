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
  AgentRuntimeCustomTool,
} from '../extensions/agent-runtime-extension';
import { getSharedAuthStorage, ModelRegistry } from './shared-auth';
import { MCPManager } from '../mcp/mcp-manager';
import { configStore } from '../config/config-store';
import { log, logError } from '../utils/logger';
import { resolvePiRegistryModel, resolvePiRouteProtocol } from './pi-model-resolution';

const MAX_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes
const TIMEOUT_MESSAGE = 'Subagent timed out';

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

function createSpawnSubagentTool(mcpManager: MCPManager | null): AgentRuntimeCustomTool {
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

      const timeoutMs = Math.min(
        (timeout_seconds || DEFAULT_TIMEOUT_MS / 1000) * 1000,
        MAX_TIMEOUT_MS
      );

      log(`[SubagentExtension] Spawning child for task: "${task.slice(0, 100)}..."`);
      const startTime = Date.now();

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

        // Filter allowed_tools if specified
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
        });

        let timeoutId: NodeJS.Timeout | undefined;
        try {
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(TIMEOUT_MESSAGE)), timeoutMs);
          });
          await Promise.race([childSession.prompt(task), timeoutPromise]);
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
          unsubscribe();
          childSession.dispose();
        }

        const durationMs = Date.now() - startTime;
        log(`[SubagentExtension] Child completed in ${durationMs}ms`);

        return {
          content: [
            { type: 'text' as const, text: finalText || '(subagent produced no text output)' },
          ],
          details: undefined as unknown,
        };
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        const message = err instanceof Error ? err.message : String(err);
        logError(`[SubagentExtension] Child failed after ${durationMs}ms:`, message);

        const isTimeout = message === TIMEOUT_MESSAGE;
        return {
          content: [
            {
              type: 'text' as const,
              text: isTimeout
                ? `Subagent timed out after ${Math.round(durationMs / 1000)}s. Consider simplifying the task or increasing timeout_seconds.`
                : `Subagent error: ${message}`,
            },
          ],
          details: undefined as unknown,
        };
      }
    },
  };
}

export class SubagentExtension implements AgentRuntimeExtension {
  readonly name = 'subagent';

  constructor(private readonly getMcpManager: () => MCPManager | null) {}

  async beforeSessionRun(): Promise<BeforeSessionRunResult> {
    return {
      customTools: [createSpawnSubagentTool(this.getMcpManager())],
    };
  }
}
