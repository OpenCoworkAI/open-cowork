import { v4 as uuidv4 } from 'uuid';
import { type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { configStore } from '../config/config-store';
import { spawnCodexExecProcess } from './codex-cli';
import type {
  Session,
  Message,
  ServerEvent,
  TraceStep,
  ImageContent,
  TokenUsage,
} from '../../renderer/types';

interface CodexAgentRunnerOptions {
  sendToRenderer: (event: ServerEvent) => void;
  saveMessage?: (message: Message) => void;
  updateSession?: (sessionId: string, updates: Partial<Session>) => void;
}

interface CodexThreadStartedEvent {
  type: 'thread.started';
  thread_id: string;
}

interface CodexTurnCompletedEvent {
  type: 'turn.completed';
  usage: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
  };
}

interface CodexTurnFailedEvent {
  type: 'turn.failed';
  error: { message: string };
}

interface CodexThreadErrorEvent {
  type: 'error';
  message: string;
}

interface CodexItemEvent {
  type: 'item.started' | 'item.updated' | 'item.completed';
  item: {
    id: string;
    type: string;
    text?: string;
    command?: string;
    aggregated_output?: string;
    exit_code?: number;
    status?: string;
    server?: string;
    tool?: string;
    arguments?: unknown;
    result?: { content?: unknown[]; structured_content?: unknown };
    error?: { message?: string };
    query?: string;
    changes?: Array<{ path: string; kind: string }>;
    items?: Array<{ text: string; completed: boolean }>;
  };
}

type CodexEvent =
  | CodexThreadStartedEvent
  | CodexTurnCompletedEvent
  | CodexTurnFailedEvent
  | CodexThreadErrorEvent
  | CodexItemEvent
  | { type: 'turn.started' };

function toErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function mediaTypeToExtension(mediaType: string): string {
  switch (mediaType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    default:
      return '.img';
  }
}

function toTokenUsage(event: CodexTurnCompletedEvent | null): TokenUsage | undefined {
  if (!event) {
    return undefined;
  }
  return {
    input: event.usage.input_tokens + event.usage.cached_input_tokens,
    output: event.usage.output_tokens,
  };
}

function buildHistoryPreamble(existingMessages: Message[]): string {
  const conversationMessages = existingMessages.filter(
    (message) => message.role === 'user' || message.role === 'assistant'
  );
  const historyMessages = conversationMessages.length > 0 ? conversationMessages.slice(0, -1) : [];

  const historyItems = historyMessages
    .map((message) => {
      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { text: string }).text)
        .join('\n')
        .trim();
      if (!text) {
        return null;
      }
      return `<turn role="${message.role}">${text}</turn>`;
    })
    .filter((item): item is string => Boolean(item))
    .slice(-12);

  if (historyItems.length === 0) {
    return '';
  }

  return `<conversation_history>\n${historyItems.join('\n')}\n</conversation_history>`;
}

function formatTodoList(items: Array<{ text: string; completed: boolean }> | undefined): string {
  return (items || []).map((item) => `${item.completed ? '[x]' : '[ ]'} ${item.text}`).join('\n');
}

export class CodexAgentRunner {
  private sendToRenderer: (event: ServerEvent) => void;
  private saveMessage?: (message: Message) => void;
  private updateSession?: (sessionId: string, updates: Partial<Session>) => void;
  private activeControllers = new Map<string, AbortController>();
  private activeProcesses = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(options: CodexAgentRunnerOptions) {
    this.sendToRenderer = options.sendToRenderer;
    this.saveMessage = options.saveMessage;
    this.updateSession = options.updateSession;
  }

  clearSdkSession(_sessionId: string): void {
    // No-op: Codex thread state is persisted by the CLI itself.
  }

  cancel(sessionId: string): void {
    this.activeControllers.get(sessionId)?.abort();
    this.activeProcesses.get(sessionId)?.kill();
  }

  async run(session: Session, prompt: string, existingMessages: Message[]): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.set(session.id, controller);

    const thinkingStepId = uuidv4();
    let usageEvent: CodexTurnCompletedEvent | null = null;
    const partialTextByItem = new Map<string, string>();
    const imagePaths: string[] = [];

    this.sendTraceStep(session.id, {
      id: thinkingStepId,
      type: 'thinking',
      status: 'running',
      title: 'Processing request...',
      timestamp: Date.now(),
    });

    try {
      const config = configStore.getAll();
      const lastUserMessage = existingMessages[existingMessages.length - 1];
      const workingDirectory = session.cwd || process.cwd();
      const reasoningEffort = config.enableThinking ? 'medium' : undefined;
      const historyPreamble = session.openaiThreadId ? '' : buildHistoryPreamble(existingMessages);
      const input = historyPreamble ? `${historyPreamble}\n\n${prompt}` : prompt;

      for (const block of lastUserMessage?.content || []) {
        if (block.type !== 'image') {
          continue;
        }
        imagePaths.push(this.writeTempImage(block));
      }

      const child = spawnCodexExecProcess({
        codexPath: config.codexPath,
        input,
        threadId: session.openaiThreadId,
        model: config.model || 'gpt-5-codex',
        workingDirectory,
        additionalDirectories: session.mountedPaths.map((mountedPath) => mountedPath.real),
        imagePaths,
        reasoningEffort,
        signal: controller.signal,
      });
      this.activeProcesses.set(session.id, child);

      const stderrChunks: Buffer[] = [];
      child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));

      const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      try {
        for await (const line of rl) {
          if (!line.trim()) {
            continue;
          }
          const event = JSON.parse(line) as CodexEvent;
          if (event.type === 'thread.started') {
            if (event.thread_id && event.thread_id !== session.openaiThreadId) {
              session.openaiThreadId = event.thread_id;
              this.updateSession?.(session.id, { openaiThreadId: event.thread_id });
            }
            continue;
          }
          if (event.type === 'turn.completed') {
            usageEvent = event;
            continue;
          }
          if (event.type === 'turn.failed') {
            throw new Error(event.error.message);
          }
          if (event.type === 'error') {
            throw new Error(event.message);
          }
          if (event.type === 'turn.started') {
            continue;
          }
          this.handleItemEvent(session.id, event, partialTextByItem, () =>
            toTokenUsage(usageEvent)
          );
        }
      } finally {
        rl.close();
      }

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      if (exitCode !== 0 && !controller.signal.aborted) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        throw new Error(stderr || `Codex exited with code ${exitCode}`);
      }

      this.sendTraceUpdate(session.id, thinkingStepId, {
        status: controller.signal.aborted ? 'completed' : 'completed',
        title: controller.signal.aborted ? 'Cancelled' : 'Task completed',
      });
    } catch (error) {
      if (controller.signal.aborted) {
        this.sendTraceUpdate(session.id, thinkingStepId, {
          status: 'completed',
          title: 'Cancelled',
        });
        return;
      }

      const finalErrorText = toErrorText(error);
      this.sendMessage(session.id, {
        id: uuidv4(),
        sessionId: session.id,
        role: 'assistant',
        content: [{ type: 'text', text: `**Error**: ${finalErrorText}` }],
        timestamp: Date.now(),
      });
      this.sendTraceUpdate(session.id, thinkingStepId, {
        status: 'error',
        title: 'Request failed',
      });

      if (error instanceof Error) {
        (error as Error & { alreadyReportedToUser?: boolean }).alreadyReportedToUser = true;
      }
      throw error;
    } finally {
      for (const imagePath of imagePaths) {
        try {
          fs.unlinkSync(imagePath);
        } catch {
          // Ignore temp cleanup errors.
        }
      }
      this.activeControllers.delete(session.id);
      this.activeProcesses.delete(session.id);
    }
  }

  private writeTempImage(block: ImageContent): string {
    const filePath = path.join(
      os.tmpdir(),
      `open-cowork-codex-${Date.now()}-${Math.random().toString(36).slice(2)}${mediaTypeToExtension(block.source.media_type)}`
    );
    fs.writeFileSync(filePath, Buffer.from(block.source.data, 'base64'));
    return filePath;
  }

  private handleItemEvent(
    sessionId: string,
    event: CodexItemEvent,
    partialTextByItem: Map<string, string>,
    getTokenUsage: () => TokenUsage | undefined
  ): void {
    const item = event.item;
    switch (item.type) {
      case 'agent_message': {
        const nextText = item.text || '';
        const previousText = partialTextByItem.get(item.id) || '';
        if (nextText.startsWith(previousText) && nextText.length > previousText.length) {
          this.sendPartial(sessionId, nextText.slice(previousText.length));
        }
        partialTextByItem.set(item.id, nextText);
        if (event.type === 'item.completed' && nextText.trim()) {
          this.sendPartial(sessionId, '');
          this.sendMessage(sessionId, {
            id: uuidv4(),
            sessionId,
            role: 'assistant',
            content: [{ type: 'text', text: nextText }],
            timestamp: Date.now(),
            tokenUsage: getTokenUsage(),
          });
        }
        break;
      }
      case 'reasoning': {
        if (event.type === 'item.started') {
          this.sendTraceStep(sessionId, {
            id: item.id,
            type: 'thinking',
            status: 'running',
            title: 'Reasoning',
            content: item.text || '',
            timestamp: Date.now(),
          });
        } else {
          this.sendTraceUpdate(sessionId, item.id, {
            status: event.type === 'item.completed' ? 'completed' : 'running',
            content: item.text || '',
          });
        }
        break;
      }
      case 'command_execution': {
        const toolName = 'bash';
        if (event.type === 'item.started') {
          this.sendTraceStep(sessionId, {
            id: item.id,
            type: 'tool_call',
            status: 'running',
            title: item.command || 'Command execution',
            toolName,
            toolInput: item.command ? { command: item.command } : undefined,
            timestamp: Date.now(),
          });
        } else {
          this.sendTraceUpdate(sessionId, item.id, {
            status:
              event.type === 'item.completed'
                ? item.status === 'failed'
                  ? 'error'
                  : 'completed'
                : 'running',
            toolOutput: item.aggregated_output?.slice(0, 800) || '',
          });
          if (event.type === 'item.completed') {
            this.sendMessage(sessionId, {
              id: uuidv4(),
              sessionId,
              role: 'assistant',
              content: [
                {
                  type: 'tool_result',
                  toolUseId: item.id,
                  content: item.aggregated_output || '',
                  isError: item.status === 'failed',
                },
              ],
              timestamp: Date.now(),
            });
          }
        }
        break;
      }
      case 'mcp_tool_call': {
        const title = `${item.server || 'MCP'} -> ${item.tool || 'tool'}`;
        if (event.type === 'item.started') {
          this.sendTraceStep(sessionId, {
            id: item.id,
            type: 'tool_call',
            status: 'running',
            title,
            toolName: item.tool || 'mcp',
            toolInput: item.arguments as Record<string, unknown> | undefined,
            timestamp: Date.now(),
          });
        } else {
          this.sendTraceUpdate(sessionId, item.id, {
            status:
              event.type === 'item.completed'
                ? item.status === 'failed'
                  ? 'error'
                  : 'completed'
                : 'running',
            toolOutput: item.error?.message || '',
          });
        }
        break;
      }
      case 'todo_list': {
        const content = formatTodoList(item.items);
        if (event.type === 'item.started') {
          this.sendTraceStep(sessionId, {
            id: item.id,
            type: 'thinking',
            status: 'running',
            title: 'Plan',
            content,
            timestamp: Date.now(),
          });
        } else {
          this.sendTraceUpdate(sessionId, item.id, {
            status: event.type === 'item.completed' ? 'completed' : 'running',
            content,
          });
        }
        break;
      }
      case 'web_search': {
        if (event.type === 'item.started') {
          this.sendTraceStep(sessionId, {
            id: item.id,
            type: 'tool_call',
            status: 'running',
            title: item.query || 'Web search',
            toolName: 'web_search',
            timestamp: Date.now(),
          });
        } else {
          this.sendTraceUpdate(sessionId, item.id, {
            status: event.type === 'item.completed' ? 'completed' : 'running',
          });
        }
        break;
      }
      case 'file_change': {
        const summary = (item.changes || [])
          .map((change) => `${change.kind}: ${change.path}`)
          .join('\n');
        if (event.type === 'item.started') {
          this.sendTraceStep(sessionId, {
            id: item.id,
            type: 'text',
            status: 'running',
            title: 'Applying file changes',
            content: summary,
            timestamp: Date.now(),
          });
        } else {
          this.sendTraceUpdate(sessionId, item.id, {
            status:
              event.type === 'item.completed'
                ? item.status === 'failed'
                  ? 'error'
                  : 'completed'
                : 'running',
            content: summary,
          });
        }
        break;
      }
      case 'error': {
        this.sendTraceStep(sessionId, {
          id: item.id,
          type: 'thinking',
          status: 'error',
          title: 'Error occurred',
          content: item.text || item.error?.message || '',
          timestamp: Date.now(),
        });
        break;
      }
      default:
        break;
    }
  }

  private sendTraceStep(sessionId: string, step: TraceStep): void {
    this.sendToRenderer({ type: 'trace.step', payload: { sessionId, step } });
  }

  private sendTraceUpdate(sessionId: string, stepId: string, updates: Partial<TraceStep>): void {
    this.sendToRenderer({ type: 'trace.update', payload: { sessionId, stepId, updates } });
  }

  private sendMessage(sessionId: string, message: Message): void {
    this.saveMessage?.(message);
    this.sendToRenderer({ type: 'stream.message', payload: { sessionId, message } });
  }

  private sendPartial(sessionId: string, delta: string): void {
    this.sendToRenderer({ type: 'stream.partial', payload: { sessionId, delta } });
  }
}
