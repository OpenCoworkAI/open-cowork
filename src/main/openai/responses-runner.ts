import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Message, PermissionResult, ServerEvent, Session, TraceStep } from '../../renderer/types';
import { PathResolver } from '../sandbox/path-resolver';
import { ToolExecutor } from '../tools/tool-executor';
import { log, logError, logWarn } from '../utils/logger';
import { extractArtifactsFromText, buildArtifactTraceSteps } from '../utils/artifact-parser';

type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

type ToolConfig = {
  responseTools: Array<Record<string, unknown>>;
  chatTools: Array<Record<string, unknown>>;
  allowedToolNames: Set<string>;
};

type RawToolCall = {
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
};

type ParsedToolCall = {
  toolUseId: string;
  callId: string;
  name: string;
  arguments: string;
  input: Record<string, unknown> | null;
  parseError?: string;
};

type ToolOutput = {
  callId: string;
  toolUseId: string;
  toolName: string;
  output: string;
  isError: boolean;
};

type QuestionOption = {
  label: string;
  description?: string;
};

type QuestionItem = {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
};

type TodoItem = {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  id?: string;
  activeForm?: string;
};

const ARTIFACT_INSTRUCTION =
  '\n\nIf you produce a final deliverable file, declare it once using this exact block so the app can show it as the final artifact:\n\n' +
  '```artifact\n' +
  '{"path":"/workspace/path/to/file.ext","name":"optional display name","type":"optional type"}\n' +
  '```\n';

const TOOL_SPECS: Record<string, ToolSpec> = {
  AskUserQuestion: {
    name: 'AskUserQuestion',
    description: 'Ask the user a question and wait for their response.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              header: { type: 'string' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    description: { type: 'string' },
                  },
                  required: ['label', 'description'],
                  additionalProperties: false,
                },
              },
              multiSelect: { type: 'boolean' },
            },
            required: ['question', 'header', 'options', 'multiSelect'],
            additionalProperties: false,
          },
        },
      },
      required: ['questions'],
      additionalProperties: false,
    },
  },
  TodoWrite: {
    name: 'TodoWrite',
    description: 'Update the task list for this session. Use empty strings for id/activeForm if not needed.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'List of todo items.',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
              },
              id: { type: 'string' },
              activeForm: { type: 'string' },
            },
            required: ['content', 'status', 'id', 'activeForm'],
            additionalProperties: false,
          },
        },
      },
      required: ['todos'],
      additionalProperties: false,
    },
  },
  TodoRead: {
    name: 'TodoRead',
    description: 'Read the current task list for this session.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  WebFetch: {
    name: 'WebFetch',
    description: 'Fetch a URL and return text content.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch.',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  WebSearch: {
    name: 'WebSearch',
    description: 'Search the web and return summarized results.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  read_file: {
    name: 'read_file',
    description: 'Read a file from the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file. Relative paths are resolved from the workspace root.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  write_file: {
    name: 'write_file',
    description: 'Write a file to the workspace, creating parent directories if needed.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file. Relative paths are resolved from the workspace root.',
        },
        content: {
          type: 'string',
          description: 'File contents to write.',
        },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  edit_file: {
    name: 'edit_file',
    description: 'Edit a file by replacing the first occurrence of a string.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file. Relative paths are resolved from the workspace root.',
        },
        old_string: {
          type: 'string',
          description: 'Text to replace.',
        },
        new_string: {
          type: 'string',
          description: 'Replacement text.',
        },
      },
      required: ['path', 'old_string', 'new_string'],
      additionalProperties: false,
    },
  },
  list_directory: {
    name: 'list_directory',
    description: 'List directory contents under a path.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list. Use "." for the workspace root.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  glob: {
    name: 'glob',
    description: 'Find files by glob pattern under a path.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern, e.g. "**/*.ts".',
        },
        path: {
          type: 'string',
          description: 'Search root inside the workspace. Use "." for the workspace root.',
        },
      },
      required: ['pattern', 'path'],
      additionalProperties: false,
    },
  },
  grep: {
    name: 'grep',
    description: 'Search file contents using a regex pattern.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for.',
        },
        path: {
          type: 'string',
          description: 'Search root inside the workspace. Use "." for the workspace root.',
        },
      },
      required: ['pattern', 'path'],
      additionalProperties: false,
    },
  },
  execute_command: {
    name: 'execute_command',
    description: 'Run a shell command inside the workspace.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to run.',
        },
        cwd: {
          type: 'string',
          description: 'Working directory inside the workspace. Use "." for the workspace root.',
        },
      },
      required: ['command', 'cwd'],
      additionalProperties: false,
    },
  },
};

const TOOL_ALIASES: Record<string, string> = {
  askuserquestion: 'AskUserQuestion',
  todowrite: 'TodoWrite',
  todoread: 'TodoRead',
  webfetch: 'WebFetch',
  websearch: 'WebSearch',
  read: 'read_file',
  write: 'write_file',
  edit: 'edit_file',
  bash: 'execute_command',
  ls: 'list_directory',
};

const MAX_TOOL_TURNS = 6;

interface OpenAIResponsesRunnerOptions {
  sendToRenderer: (event: ServerEvent) => void;
  saveMessage?: (message: Message) => void;
  pathResolver?: PathResolver;
  requestPermission?: (
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ) => Promise<PermissionResult>;
}

export class OpenAIResponsesRunner {
  private sendToRenderer: (event: ServerEvent) => void;
  private saveMessage?: (message: Message) => void;
  private pathResolver?: PathResolver;
  private toolExecutor?: ToolExecutor;
  private alwaysAllowTools: Set<string> = new Set();
  private todoBySession: Map<string, TodoItem[]> = new Map();
  private pendingQuestions: Map<string, (answer: string) => void> = new Map();
  private requestPermission?: (
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ) => Promise<PermissionResult>;
  private activeControllers: Map<string, AbortController> = new Map();

  constructor(options: OpenAIResponsesRunnerOptions) {
    this.sendToRenderer = options.sendToRenderer;
    this.saveMessage = options.saveMessage;
    this.pathResolver = options.pathResolver;
    this.requestPermission = options.requestPermission;
    this.toolExecutor = options.pathResolver ? new ToolExecutor(options.pathResolver) : undefined;
  }

  async run(session: Session, prompt: string, existingMessages: Message[]): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.set(session.id, controller);

    if (this.pathResolver) {
      this.pathResolver.registerSession(session.id, session.mountedPaths);
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL,
    });

    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    const mode = this.getApiMode();
    const toolConfig = this.buildToolConfig(session.allowedTools);
    const thinkingStepId = uuidv4();

    this.sendTraceStep(session.id, {
      id: thinkingStepId,
      type: 'thinking',
      status: 'running',
      title: 'Thinking',
      timestamp: Date.now(),
    });

    try {
      if (mode === 'chat') {
        const text = await this.requestChatText(client, model, existingMessages, prompt, controller.signal);
        if (text) {
          await this.streamText(session.id, text, controller.signal);
          const { cleanText } = extractArtifactsFromText(text);
          this.sendMessage(session.id, {
            id: uuidv4(),
            sessionId: session.id,
            role: 'assistant',
            content: [{ type: 'text', text: cleanText }],
            timestamp: Date.now(),
          });
        }
      } else {
        try {
          await this.runResponsesLoop(
            session,
            client,
            model,
            existingMessages,
            prompt,
            toolConfig,
            controller.signal
          );
        } catch (error) {
          if (this.shouldFallbackToChat(error)) {
            logWarn('[OpenAIResponsesRunner] Responses unsupported by provider, falling back to Chat Completions');
            const text = await this.requestChatText(client, model, existingMessages, prompt, controller.signal);
            if (text) {
              await this.streamText(session.id, text, controller.signal);
              const { cleanText } = extractArtifactsFromText(text);
              this.sendMessage(session.id, {
                id: uuidv4(),
                sessionId: session.id,
                role: 'assistant',
                content: [{ type: 'text', text: cleanText }],
                timestamp: Date.now(),
              });
            }
          } else {
            throw error;
          }
        }
      }

      this.sendTraceUpdate(session.id, thinkingStepId, {
        status: 'completed',
        title: 'Task completed',
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        log('[OpenAIResponsesRunner] Aborted');
        return;
      }

      logError('[OpenAIResponsesRunner] Error:', error);
      const errorText = error instanceof Error ? error.message : String(error);
      this.sendMessage(session.id, {
        id: uuidv4(),
        sessionId: session.id,
        role: 'assistant',
        content: [{ type: 'text', text: `**Error**: ${errorText}` }],
        timestamp: Date.now(),
      });

      this.sendTraceStep(session.id, {
        id: uuidv4(),
        type: 'thinking',
        status: 'error',
        title: 'Error occurred',
        timestamp: Date.now(),
      });
    } finally {
      this.activeControllers.delete(session.id);
      if (this.pathResolver) {
        this.pathResolver.unregisterSession(session.id);
      }
    }
  }

  cancel(sessionId: string): void {
    const controller = this.activeControllers.get(sessionId);
    if (controller) controller.abort();
  }

  handleQuestionResponse(questionId: string, answer: string): void {
    const resolver = this.pendingQuestions.get(questionId);
    if (resolver) {
      resolver(answer);
      this.pendingQuestions.delete(questionId);
      return;
    }
    log('[OpenAIResponsesRunner] Question response ignored:', questionId);
  }

  private getApiMode(): 'responses' | 'chat' {
    const mode = (process.env.OPENAI_API_MODE || 'responses').toLowerCase();
    return mode === 'chat' ? 'chat' : 'responses';
  }

  private shouldFallbackToChat(error: unknown): boolean {
    const message = error instanceof Error ? error.message : '';
    const apiMessage = (error as { error?: { message?: string } } | undefined)?.error?.message || '';
    const combined = `${message} ${apiMessage}`.toLowerCase();

    if (combined.includes('input_text')) return true;
    if (combined.includes('supported values') && combined.includes('refusal')) return true;

    return false;
  }

  private shouldFallbackWithoutPreviousResponseId(error: unknown): boolean {
    const message = error instanceof Error ? error.message : '';
    const apiMessage = (error as { error?: { message?: string } } | undefined)?.error?.message || '';
    const combined = `${message} ${apiMessage}`.toLowerCase();

    if (combined.includes('previous_response_id')) return true;
    if (combined.includes('unsupported parameter')) return true;

    return false;
  }

  private shouldFallbackToPlainResponses(error: unknown): boolean {
    const message = error instanceof Error ? error.message : '';
    const apiMessage = (error as { error?: { message?: string } } | undefined)?.error?.message || '';
    const combined = `${message} ${apiMessage}`.toLowerCase();

    if (combined.includes('input_text')) return true;
    if (combined.includes('supported values') && combined.includes('refusal')) return true;

    return false;
  }

  private shouldFallbackToOutputResponses(error: unknown): boolean {
    const message = error instanceof Error ? error.message : '';
    const apiMessage = (error as { error?: { message?: string } } | undefined)?.error?.message || '';
    const combined = `${message} ${apiMessage}`.toLowerCase();

    if (combined.includes('output_text')) return true;
    if (combined.includes('supported values') && combined.includes('refusal')) return true;

    return false;
  }

  private shouldRetryChatWithPrompt(error: unknown): boolean {
    const message = error instanceof Error ? error.message : '';
    const apiMessage = (error as { error?: { message?: string } } | undefined)?.error?.message || '';
    const status = (error as { status?: number } | undefined)?.status;
    const combined = `${message} ${apiMessage}`.toLowerCase();

    if (status === 422) return true;
    if (combined.includes('context')) return true;
    if (combined.includes('上下文')) return true;
    if (combined.includes('messages')) return true;
    if (combined.includes('invalid')) return true;

    return false;
  }

  private buildToolConfig(allowedTools?: string[]): ToolConfig {
    const allowedToolNames = new Set<string>();
    const source = allowedTools || [];

    for (const tool of source) {
      const normalized = tool.trim().toLowerCase();
      if (!normalized) continue;
      const mapped = TOOL_ALIASES[normalized] || normalized;
      if (TOOL_SPECS[mapped]) {
        allowedToolNames.add(mapped);
      }
    }

    const responseTools: Array<Record<string, unknown>> = [];
    const chatTools: Array<Record<string, unknown>> = [];

    for (const toolName of allowedToolNames) {
      const spec = TOOL_SPECS[toolName];
      responseTools.push({
        type: 'function',
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters,
        strict: true,
      });
      chatTools.push({
        type: 'function',
        function: {
          name: spec.name,
          description: spec.description,
          parameters: spec.parameters,
        },
      });
    }

    return { responseTools, chatTools, allowedToolNames };
  }

  private async runResponsesLoop(
    session: Session,
    client: OpenAI,
    model: string,
    existingMessages: Message[],
    prompt: string,
    toolConfig: ToolConfig,
    signal: AbortSignal
  ): Promise<void> {
    let input: unknown[] = this.buildInput(existingMessages, prompt);
    let conversationItems: unknown[] = Array.isArray(input) ? [...input] : [];
    let previousResponseId: string | null = null;
    let supportsPreviousResponseId = true;
    let attempts = 0;
    let initialResponse: any;
    let initialStreamed = false;

    try {
      const initial = await this.createResponsesWithStreamingFallback(
        session.id,
        client,
        model,
        input,
        toolConfig,
        signal,
        null
      );
      initialResponse = initial.response;
      initialStreamed = initial.streamed;
    } catch (error) {
      if (!this.shouldFallbackToPlainResponses(error)) {
        throw error;
      }

      const plainMessages = this.buildChatMessages(existingMessages, prompt);
      if (!plainMessages.length) {
        throw error;
      }

      logWarn('[OpenAIResponsesRunner] Responses input_text unsupported, retrying with plain message list');
      try {
        const initial = await this.createResponsesWithStreamingFallback(
          session.id,
          client,
          model,
          plainMessages,
          toolConfig,
          signal,
          null
        );
        initialResponse = initial.response;
        initialStreamed = initial.streamed;
      } catch (plainError) {
        if (!this.shouldFallbackToOutputResponses(plainError)) {
          throw plainError;
        }

        logWarn('[OpenAIResponsesRunner] Responses plain list unsupported, retrying with output_text list');
        const outputMessages = this.buildOutputMessages(existingMessages, prompt);
        if (!outputMessages.length) {
          throw plainError;
        }

        const initial = await this.createResponsesWithStreamingFallback(
          session.id,
          client,
          model,
          outputMessages,
          toolConfig,
          signal,
          null
        );
        initialResponse = initial.response;
        initialStreamed = initial.streamed;
      }
    }

    let response = initialResponse;
    let streamed = initialStreamed;

    while (true) {
      const outputText = this.extractOutputText(response);
      if (outputText) {
        const { cleanText, artifacts } = extractArtifactsFromText(outputText);
        if (streamed) {
          for (const step of buildArtifactTraceSteps(artifacts)) {
            this.sendTraceStep(session.id, step);
          }
        } else {
          await this.streamText(session.id, outputText, signal);
        }
        this.sendMessage(session.id, {
          id: uuidv4(),
          sessionId: session.id,
          role: 'assistant',
          content: [{ type: 'text', text: cleanText }],
          timestamp: Date.now(),
        });
      }

      const outputItems = Array.isArray(response?.output) ? response.output : [];
      const toolCalls = this.parseToolCalls(outputItems);
      if (toolCalls.length === 0) {
        return;
      }

      if (attempts >= MAX_TOOL_TURNS) {
        throw new Error('Tool calls exceeded maximum turns');
      }

      const functionCallItems = toolCalls.map((call) => ({
        type: 'function_call',
        call_id: call.callId,
        name: call.name,
        arguments: call.arguments,
      }));

      conversationItems = conversationItems.concat(functionCallItems);

      const toolOutputs = await this.executeToolCalls(session, toolCalls, toolConfig.allowedToolNames);
      const toolOutputItems = toolOutputs.map((item) => ({
        type: 'function_call_output',
        call_id: item.callId,
        output: item.output,
      }));

      conversationItems = conversationItems.concat(toolOutputItems);

      previousResponseId = response?.id || previousResponseId;
      const nextInput = supportsPreviousResponseId ? toolOutputItems : conversationItems;

      try {
        const next = await this.createResponsesWithStreamingFallback(
          session.id,
          client,
          model,
          nextInput,
          toolConfig,
          signal,
          supportsPreviousResponseId ? previousResponseId : null
        );
        response = next.response;
        streamed = next.streamed;
      } catch (error) {
        if (supportsPreviousResponseId && this.shouldFallbackWithoutPreviousResponseId(error)) {
          logWarn('[OpenAIResponsesRunner] previous_response_id unsupported, retrying with full input list');
          supportsPreviousResponseId = false;
          try {
            const next = await this.createResponsesWithStreamingFallback(
              session.id,
              client,
              model,
              conversationItems,
              toolConfig,
              signal,
              null
            );
            response = next.response;
            streamed = next.streamed;
          } catch (fallbackError) {
            if (this.finishWithToolOutputs(session.id, toolOutputs, fallbackError)) {
              return;
            }
            throw fallbackError;
          }
        } else {
          if (this.finishWithToolOutputs(session.id, toolOutputs, error)) {
            return;
          }
          throw error;
        }
      }
      attempts += 1;
    }
  }

  private shouldUseResponsesStreaming(): boolean {
    const flag = (process.env.OPENAI_STREAM || 'true').toLowerCase();
    return !['0', 'false', 'off', 'no'].includes(flag);
  }

  private shouldFallbackFromStreaming(error: unknown): boolean {
    const message = error instanceof Error ? error.message : '';
    const name = error instanceof Error ? error.name : '';
    const apiMessage = (error as { error?: { message?: string } } | undefined)?.error?.message || '';
    const combined = `${message} ${apiMessage}`.toLowerCase();

    if (name === 'SyntaxError') return true;
    if (combined.includes('unexpected token')) return true;
    if (combined.includes('not valid json')) return true;
    if (combined.includes('invalid json')) return true;
    if (combined.includes('http/1.1')) return true;
    if (!combined.includes('stream')) return false;
    if (combined.includes('not supported')) return true;
    if (combined.includes('unsupported')) return true;
    if (combined.includes('invalid')) return true;
    if (combined.includes('parse')) return true;

    return false;
  }

  private async createResponsesWithStreamingFallback(
    sessionId: string,
    client: OpenAI,
    model: string,
    input: unknown,
    toolConfig: ToolConfig,
    signal: AbortSignal,
    previousResponseId: string | null
  ): Promise<{ response: any; streamed: boolean }> {
    const useStreaming = this.shouldUseResponsesStreaming();
    try {
      return await this.createResponses(
        sessionId,
        client,
        model,
        input,
        toolConfig,
        signal,
        previousResponseId,
        useStreaming
      );
    } catch (error) {
      if (useStreaming && this.shouldFallbackFromStreaming(error)) {
        logWarn('[OpenAIResponsesRunner] Responses stream unsupported, retrying without stream');
        return this.createResponses(
          sessionId,
          client,
          model,
          input,
          toolConfig,
          signal,
          previousResponseId,
          false
        );
      }
      throw error;
    }
  }

  private async createResponses(
    sessionId: string,
    client: OpenAI,
    model: string,
    input: unknown,
    toolConfig: ToolConfig,
    signal: AbortSignal,
    previousResponseId: string | null,
    useStreaming: boolean
  ): Promise<{ response: any; streamed: boolean }> {
    const body: Record<string, unknown> = { model, input };
    if (toolConfig.responseTools.length > 0) {
      body.tools = toolConfig.responseTools;
    }
    if (previousResponseId) {
      body.previous_response_id = previousResponseId;
    }

    if (useStreaming) {
      const stream = client.responses.stream(body, { signal });
      for await (const event of stream) {
        if (signal.aborted) break;
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          this.sendPartial(sessionId, event.delta);
        }
      }
      this.sendPartial(sessionId, '');
      const response = await stream.finalResponse();
      return { response, streamed: true };
    }

    const response = await client.responses.create(body, { signal });
    return { response, streamed: false };
  }

  private parseToolCalls(output: unknown): ParsedToolCall[] {
    if (!Array.isArray(output)) return [];

    const calls: ParsedToolCall[] = [];
    for (const item of output) {
      if (!item || (item as { type?: string }).type !== 'function_call') {
        continue;
      }

      const raw = item as RawToolCall;
      const name = raw.name || 'unknown';
      const args = typeof raw.arguments === 'string' ? raw.arguments : '';
      const callId = raw.call_id || raw.id || uuidv4();
      const toolUseId = raw.id || raw.call_id || callId;

      let input: Record<string, unknown> | null = null;
      let parseError: string | undefined;

      if (args) {
        try {
          const parsed = JSON.parse(args);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            input = parsed as Record<string, unknown>;
          } else {
            parseError = 'Arguments must be an object';
          }
        } catch (error) {
          parseError = error instanceof Error ? error.message : 'Invalid JSON';
        }
      } else {
        input = {};
      }

      calls.push({
        toolUseId,
        callId,
        name,
        arguments: args,
        input,
        parseError,
      });
    }

    return calls;
  }

  private getPermissionToolName(toolName: string): string {
    switch (toolName) {
      case 'write_file':
        return 'write';
      case 'edit_file':
        return 'edit';
      case 'execute_command':
        return 'bash';
      case 'read_file':
        return 'read';
      case 'list_directory':
        return 'read';
      case 'WebFetch':
        return 'webFetch';
      case 'WebSearch':
        return 'webSearch';
      default:
        return toolName;
    }
  }

  private async requestToolPermission(
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<PermissionResult> {
    if (toolName === 'AskUserQuestion' || toolName === 'TodoWrite' || toolName === 'TodoRead') {
      return 'allow';
    }
    if (!this.requestPermission) {
      return 'allow';
    }

    const permissionToolName = this.getPermissionToolName(toolName);
    if (this.alwaysAllowTools.has(permissionToolName)) {
      return 'allow';
    }

    const result = await this.requestPermission(sessionId, toolUseId, permissionToolName, input);
    if (result === 'allow_always') {
      this.alwaysAllowTools.add(permissionToolName);
    }
    return result;
  }

  private async executeToolCalls(
    session: Session,
    toolCalls: ParsedToolCall[],
    allowedToolNames: Set<string>
  ): Promise<ToolOutput[]> {
    const outputs: ToolOutput[] = [];

    for (const call of toolCalls) {
      const toolUseId = call.toolUseId || uuidv4();
      const toolName = call.name || 'unknown';
      const toolInput = call.input ?? {};
      const uiInput = call.input ?? { raw: call.arguments, error: call.parseError || 'Invalid arguments' };

      this.sendMessage(session.id, {
        id: uuidv4(),
        sessionId: session.id,
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: toolUseId,
          name: toolName,
          input: uiInput,
        }],
        timestamp: Date.now(),
      });

      this.sendTraceStep(session.id, {
        id: toolUseId,
        type: 'tool_call',
        status: 'running',
        title: toolName,
        toolName,
        toolInput: uiInput,
        timestamp: Date.now(),
      });

      let output = '';
      let isError = false;

      if (!allowedToolNames.has(toolName)) {
        output = `Tool not allowed: ${toolName}`;
        isError = true;
      } else if (!this.toolExecutor) {
        output = 'Tool executor unavailable';
        isError = true;
      } else if (call.parseError) {
        output = `Invalid tool arguments: ${call.parseError}`;
        isError = true;
      } else {
        const permission = await this.requestToolPermission(session.id, toolUseId, toolName, toolInput);
        if (permission === 'deny') {
          output = 'Permission denied';
          isError = true;
        } else {
          try {
            output = await this.executeToolCall(session, toolName, toolInput, toolUseId);
          } catch (error) {
            output = error instanceof Error ? error.message : String(error);
            isError = true;
          }
        }
      }

      if (!output) {
        output = isError ? 'Tool failed' : 'OK';
      }

      const outputPreview = output.slice(0, 800);
      this.sendTraceUpdate(session.id, toolUseId, {
        status: isError ? 'error' : 'completed',
        toolOutput: outputPreview,
        isError,
      });

      this.sendMessage(session.id, {
        id: uuidv4(),
        sessionId: session.id,
        role: 'assistant',
        content: [{
          type: 'tool_result',
          toolUseId,
          content: output,
          isError,
        }],
        timestamp: Date.now(),
      });

      outputs.push({
        callId: call.callId,
        toolUseId,
        toolName,
        output: isError ? `Error: ${output}` : output,
        isError,
      });
    }

    return outputs;
  }

  private async executeToolCall(
    session: Session,
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string
  ): Promise<string> {
    if (!this.toolExecutor) {
      throw new Error('Tool executor unavailable');
    }

    switch (toolName) {
      case 'read_file': {
        const filePath = typeof input.path === 'string' ? input.path.trim() : '';
        if (!filePath) throw new Error('path is required');
        return this.toolExecutor.readFile(session.id, filePath);
      }
      case 'write_file': {
        const filePath = typeof input.path === 'string' ? input.path.trim() : '';
        const content = typeof input.content === 'string' ? input.content : '';
        if (!filePath) throw new Error('path is required');
        if (!content) throw new Error('content is required');
        await this.toolExecutor.writeFile(session.id, filePath, content);
        return `File written: ${filePath}`;
      }
      case 'edit_file': {
        const filePath = typeof input.path === 'string' ? input.path.trim() : '';
        const oldString = typeof input.old_string === 'string' ? input.old_string : '';
        const newString = typeof input.new_string === 'string' ? input.new_string : '';
        if (!filePath) throw new Error('path is required');
        if (!oldString) throw new Error('old_string is required');
        if (!newString) throw new Error('new_string is required');
        await this.toolExecutor.editFile(session.id, filePath, oldString, newString);
        return `File edited: ${filePath}`;
      }
      case 'AskUserQuestion': {
        const rawQuestions = (input as { questions?: unknown }).questions;
        if (!Array.isArray(rawQuestions)) {
          throw new Error('questions is required and must be an array');
        }
        const questions = rawQuestions
          .map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
              return null;
            }
            const record = item as Record<string, unknown>;
            const question = typeof record.question === 'string' ? record.question.trim() : '';
            if (!question) return null;
            const header = typeof record.header === 'string' ? record.header : '';
            const multiSelect = typeof record.multiSelect === 'boolean' ? record.multiSelect : false;
            const rawOptions = Array.isArray(record.options) ? record.options : [];
            const options = rawOptions
              .map((option): QuestionOption | null => {
                if (!option || typeof option !== 'object' || Array.isArray(option)) {
                  return null;
                }
                const optRecord = option as Record<string, unknown>;
                const label = typeof optRecord.label === 'string' ? optRecord.label.trim() : '';
                if (!label) return null;
                const description = typeof optRecord.description === 'string' ? optRecord.description : undefined;
                return { label, description };
              })
              .filter((option): option is QuestionOption => option !== null);
            return { question, header, options, multiSelect } as QuestionItem;
          })
          .filter((item): item is QuestionItem => Boolean(item));

        if (!questions.length) {
          throw new Error('questions is required');
        }

        const answer = await this.requestUserQuestion(session.id, toolUseId, questions);
        return answer;
      }
      case 'TodoWrite': {
        const rawTodos = (input as { todos?: unknown }).todos;
        if (!Array.isArray(rawTodos)) {
          throw new Error('todos is required and must be an array');
        }
        const todos = rawTodos
          .map((item): TodoItem | null => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
              return null;
            }
            const record = item as Record<string, unknown>;
            const content = typeof record.content === 'string' ? record.content.trim() : '';
            if (!content) return null;
            const statusRaw = typeof record.status === 'string' ? record.status : 'pending';
            const status: TodoItem['status'] = ['pending', 'in_progress', 'completed', 'cancelled'].includes(statusRaw)
              ? (statusRaw as TodoItem['status'])
              : 'pending';
            const id = typeof record.id === 'string' ? record.id : undefined;
            const activeForm = typeof record.activeForm === 'string' ? record.activeForm : undefined;
            return { content, status, id, activeForm };
          })
          .filter((item): item is TodoItem => item !== null);
        this.todoBySession.set(session.id, todos);
        return `Todo list updated (${todos.length} items)`;
      }
      case 'TodoRead': {
        const todos = this.todoBySession.get(session.id) ?? [];
        return JSON.stringify({ todos });
      }
      case 'list_directory': {
        const rawPath = typeof input.path === 'string' ? input.path.trim() : '';
        const dirPath = rawPath || '.';
        return this.toolExecutor.listDirectory(session.id, dirPath);
      }
      case 'WebFetch': {
        const rawUrl = typeof input.url === 'string' ? input.url.trim() : '';
        if (!rawUrl) throw new Error('url is required');
        return this.toolExecutor.webFetch(rawUrl);
      }
      case 'WebSearch': {
        const rawQuery = typeof input.query === 'string' ? input.query.trim() : '';
        if (!rawQuery) throw new Error('query is required');
        return this.toolExecutor.webSearch(rawQuery);
      }
      case 'glob': {
        const pattern = typeof input.pattern === 'string' ? input.pattern : '';
        const rawPath = typeof input.path === 'string' ? input.path.trim() : '';
        const searchPath = rawPath || '.';
        if (!pattern) throw new Error('pattern is required');
        return this.toolExecutor.glob(session.id, pattern, searchPath);
      }
      case 'grep': {
        const pattern = typeof input.pattern === 'string' ? input.pattern : '';
        const rawPath = typeof input.path === 'string' ? input.path.trim() : '';
        const searchPath = rawPath || '.';
        if (!pattern) throw new Error('pattern is required');
        return this.toolExecutor.grep(session.id, pattern, searchPath);
      }
      case 'execute_command': {
        const command = typeof input.command === 'string' ? input.command : '';
        if (!command.trim()) throw new Error('command is required');
        const cwd = this.resolveCommandCwd(session, input.cwd);
        return this.toolExecutor.executeCommand(session.id, command, cwd);
      }
      default:
        throw new Error(`Unsupported tool: ${toolName}`);
    }
  }

  private async requestUserQuestion(sessionId: string, toolUseId: string, questions: QuestionItem[]): Promise<string> {
    const questionId = uuidv4();
    return new Promise((resolve) => {
      this.pendingQuestions.set(questionId, resolve);
      this.sendToRenderer({
        type: 'question.request',
        payload: {
          questionId,
          sessionId,
          toolUseId,
          questions,
        },
      });
    });
  }

  private resolveCommandCwd(session: Session, rawCwd: unknown): string {
    const mounts = this.pathResolver?.getMounts(session.id) || [];
    const fallback = session.cwd || mounts[0]?.real || process.cwd();
    const cwd = typeof rawCwd === 'string' ? rawCwd.trim() : '';

    if (!cwd) return fallback;

    if (this.pathResolver && cwd.startsWith('/')) {
      const resolved = this.pathResolver.resolve(session.id, cwd);
      if (resolved) return resolved;
    }

    if (path.isAbsolute(cwd) || /^[a-zA-Z]:/.test(cwd)) {
      return cwd;
    }

    return path.join(fallback, cwd);
  }

  private finishWithToolOutputs(sessionId: string, toolOutputs: ToolOutput[], error: unknown): boolean {
    if (toolOutputs.length === 0) {
      return false;
    }

    logWarn('[OpenAIResponsesRunner] Responses continuation failed, returning tool results only:', error);
    this.sendMessage(sessionId, {
      id: uuidv4(),
      sessionId,
      role: 'assistant',
      content: [{ type: 'text', text: '工具执行完成，结果已显示在上方。' }],
      timestamp: Date.now(),
    });
    return true;
  }

  private async requestChatText(
    client: OpenAI,
    model: string,
    existingMessages: Message[],
    prompt: string,
    signal: AbortSignal
  ): Promise<string> {
    const messages = this.buildChatMessages(existingMessages, prompt) as ChatCompletionMessageParam[];
    try {
      const completion = await client.chat.completions.create(
        {
          model,
          messages,
        },
        { signal }
      );

      return this.extractChatText(completion);
    } catch (error) {
      const trimmedPrompt = prompt.trim();
      if (trimmedPrompt && this.shouldRetryChatWithPrompt(error)) {
        logWarn('[OpenAIResponsesRunner] Chat request rejected, retrying with prompt-only context');
        try {
          const completion = await client.chat.completions.create(
            {
              model,
              messages: [{ role: 'user', content: trimmedPrompt }],
            },
            { signal }
          );

          return this.extractChatText(completion);
        } catch (retryError) {
          logError('[OpenAIResponsesRunner] Retry with prompt-only also failed:', retryError);
          if (this.shouldRetryChatWithPrompt(retryError)) {
            logWarn('[OpenAIResponsesRunner] Chat unsupported by provider, falling back to Completions');
            return this.requestCompletionsText(client, model, existingMessages, prompt, signal);
          }
          throw retryError;
        }
      }

      if (this.shouldRetryChatWithPrompt(error)) {
        logWarn('[OpenAIResponsesRunner] Chat unsupported by provider, falling back to Completions');
        return this.requestCompletionsText(client, model, existingMessages, prompt, signal);
      }

      throw error;
    }
  }

  private async requestCompletionsText(
    client: OpenAI,
    model: string,
    existingMessages: Message[],
    prompt: string,
    signal: AbortSignal
  ): Promise<string> {
    const promptText = this.buildPrompt(existingMessages, prompt);
    if (!promptText) {
      throw new Error('Prompt is empty');
    }

    try {
      const completion = await client.completions.create(
        {
          model,
          prompt: promptText,
          max_tokens: 512,
        },
        { signal }
      );

      const text = completion?.choices?.[0]?.text;
      return typeof text === 'string' ? text.trim() : '';
    } catch (error) {
      // If Completions API also fails, return a helpful error message
      logError('[OpenAIResponsesRunner] Completions API also failed:', error);
      throw new Error('All API methods failed. This provider may not support standard OpenAI APIs. Please check your model and base URL configuration.');
    }
  }

  private appendArtifactInstruction<T extends { role: string; content: any }>(items: T[]): void {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (items[i].role !== 'user') {
        continue;
      }
      const content = items[i].content;
      if (Array.isArray(content)) {
        const textItem = content.find((entry) => entry.type === 'input_text' || entry.type === 'output_text');
        if (textItem && typeof textItem.text === 'string' && !textItem.text.includes('```artifact')) {
          textItem.text = `${textItem.text}${ARTIFACT_INSTRUCTION}`;
        }
      } else if (typeof content === 'string' && !content.includes('```artifact')) {
        items[i].content = `${content}${ARTIFACT_INSTRUCTION}`;
      }
      break;
    }
  }

  private buildInput(existingMessages: Message[], prompt: string): unknown[] {
    const items: Array<{ role: string; content: Array<{ type: 'input_text' | 'output_text'; text: string }> }> = [];

    for (const message of existingMessages) {
      const text = this.flattenText(message);
      if (!text) continue;

      const role = this.mapRole(message.role);
      const contentType = role === 'assistant' ? 'output_text' : 'input_text';
      items.push({
        role,
        content: [{ type: contentType, text }],
      });
    }

    if (!items.length && prompt.trim()) {
      items.push({
        role: 'user',
        content: [{ type: 'input_text', text: prompt.trim() }],
      });
    }

    if (items.length > 0) {
      this.appendArtifactInstruction(items);
    }

    return items;
  }

  private buildChatMessages(existingMessages: Message[], prompt: string): Array<{ role: string; content: string }> {
    const items: Array<{ role: string; content: string }> = [];
    let lastUserText = '';

    for (const message of existingMessages) {
      const text = this.flattenText(message);
      if (!text) continue;

      const role = this.mapRole(message.role);
      if (role === 'user') {
        lastUserText = text;
      }

      items.push({ role, content: text });
    }

    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt && trimmedPrompt !== lastUserText) {
      items.push({ role: 'user', content: trimmedPrompt });
    }

    if (!items.length && trimmedPrompt) {
      items.push({ role: 'user', content: trimmedPrompt });
    }

    if (items.length > 0) {
      this.appendArtifactInstruction(items);
    }

    return items;
  }

  private buildOutputMessages(existingMessages: Message[], prompt: string): Array<{ role: string; content: Array<{ type: 'output_text'; text: string }> }> {
    const messages = this.buildChatMessages(existingMessages, prompt);
    return messages.map((message) => ({
      role: message.role,
      content: [{ type: 'output_text', text: message.content }],
    }));
  }

  private buildPrompt(existingMessages: Message[], prompt: string): string {
    const messages = this.buildChatMessages(existingMessages, prompt);
    const lines: string[] = [];

    for (const message of messages) {
      lines.push(`${message.role.toUpperCase()}: ${message.content}`);
    }

    return lines.join('\n').trim();
  }

  private flattenText(message: Message): string {
    const parts: string[] = [];
    for (const block of message.content) {
      if (block.type === 'text') {
        parts.push(block.text);
      }
    }
    return parts.join('\n').trim();
  }

  private mapRole(role: Message['role']): string {
    if (role === 'system') return 'system';
    if (role === 'assistant') return 'assistant';
    return 'user';
  }

  private extractOutputText(response: any): string {
    if (typeof response?.output_text === 'string' && response.output_text.trim()) {
      return response.output_text.trim();
    }

    const output = response?.output;
    if (!Array.isArray(output)) return '';

    const parts: string[] = [];
    for (const item of output) {
      if (item?.type === 'output_text' && typeof item.text === 'string') {
        parts.push(item.text);
        continue;
      }

      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const block of item.content) {
          if (block?.type === 'output_text' && typeof block.text === 'string') {
            parts.push(block.text);
          }
        }
      }
    }

    return parts.join('').trim();
  }

  private extractChatText(completion: any): string {
    const content = completion?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      return content.trim();
    }

    if (!Array.isArray(content)) return '';

    const parts: string[] = [];
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }

    return parts.join('').trim();
  }

  private async streamText(sessionId: string, text: string, signal: AbortSignal): Promise<void> {
    const { cleanText, artifacts } = extractArtifactsFromText(text);
    for (const step of buildArtifactTraceSteps(artifacts)) {
      this.sendTraceStep(sessionId, step);
    }

    const chunks = cleanText.match(/.{1,30}/g) || [cleanText];
    for (const chunk of chunks) {
      if (signal.aborted) break;
      this.sendPartial(sessionId, chunk);
      await this.delay(12, signal);
    }

    this.sendPartial(sessionId, '');
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
    if (this.saveMessage) {
      this.saveMessage(message);
    }
    this.sendToRenderer({ type: 'stream.message', payload: { sessionId, message } });
  }

  private sendPartial(sessionId: string, delta: string): void {
    this.sendToRenderer({ type: 'stream.partial', payload: { sessionId, delta } });
  }

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  }
}
