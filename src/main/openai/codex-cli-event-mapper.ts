import { v4 as uuidv4 } from 'uuid';
import type { ToolResultContent, ToolUseContent, TraceStep } from '../../renderer/types';

export interface CodexJsonEvent {
  type: string;
  thread_id?: string;
  item?: Record<string, unknown>;
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TodoWriteItem {
  content: string;
  status: TodoStatus;
  id: string;
  activeForm: string;
}

type ToolContext = {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
};

export type CodexMappedAction =
  | { type: 'thread.started'; threadId: string }
  | { type: 'trace.step'; step: TraceStep }
  | { type: 'trace.update'; stepId: string; updates: Partial<TraceStep> }
  | { type: 'tool.use'; toolUse: ToolUseContent }
  | { type: 'tool.result'; toolResult: ToolResultContent }
  | { type: 'assistant.message'; text: string };

export interface CodexCliEventMapperOptions {
  cwd?: string;
  now?: () => number;
  idFactory?: () => string;
}

export class CodexCliEventMapper {
  private cwd: string;
  private now: () => number;
  private idFactory: () => string;
  private currentThinkingStepId: string | null = null;
  private toolContexts: Map<string, ToolContext> = new Map();
  private suppressedToolItems: Set<string> = new Set();
  private recentScreenshotCalls: Map<string, { at: number; itemId: string }> = new Map();

  constructor(options: CodexCliEventMapperOptions = {}) {
    this.cwd = options.cwd || '.';
    this.now = options.now || (() => Date.now());
    this.idFactory = options.idFactory || (() => uuidv4());
  }

  map(event: CodexJsonEvent): CodexMappedAction[] {
    const actions: CodexMappedAction[] = [];

    if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
      actions.push({ type: 'thread.started', threadId: event.thread_id });
      return actions;
    }

    if (event.type === 'turn.started') {
      const stepId = this.idFactory();
      this.currentThinkingStepId = stepId;
      actions.push({
        type: 'trace.step',
        step: {
          id: stepId,
          type: 'thinking',
          status: 'running',
          title: 'Thinking',
          timestamp: this.now(),
        },
      });
      return actions;
    }

    if (event.type === 'turn.completed') {
      if (this.currentThinkingStepId) {
        actions.push({
          type: 'trace.update',
          stepId: this.currentThinkingStepId,
          updates: {
            status: 'completed',
            title: 'Task completed',
          },
        });
        this.currentThinkingStepId = null;
      }
      return actions;
    }

    if ((event.type === 'item.started' || event.type === 'item.completed') && event.item) {
      const status = event.type === 'item.started' ? 'started' : 'completed';
      const item = event.item;
      const itemType = typeof item.type === 'string' ? item.type : '';
      const itemId = typeof item.id === 'string' ? item.id : this.idFactory();

      if (itemType === 'command_execution') {
        const input = {
          command: typeof item.command === 'string' ? item.command : '',
          cwd: this.cwd,
        };
        const context = this.ensureToolContext(actions, itemId, 'execute_command', input);
        if (status === 'completed') {
          const exitCode = typeof item.exit_code === 'number' ? item.exit_code : null;
          const output = formatCommandOutput(item);
          const isError = exitCode !== null && exitCode !== 0;
          actions.push({
            type: 'trace.update',
            stepId: context.toolUseId,
            updates: {
              status: isError ? 'error' : 'completed',
              toolOutput: output.slice(0, 800),
              isError,
            },
          });
          actions.push({
            type: 'tool.result',
            toolResult: {
              type: 'tool_result',
              toolUseId: context.toolUseId,
              content: output,
              isError,
            },
          });
          this.toolContexts.delete(itemId);
        }
        return actions;
      }

      if (itemType === 'mcp_tool_call') {
        const toolName = buildMcpToolName(item);
        const args = asRecord(item.arguments) || {};
        if (this.shouldSuppressDuplicateScreenshot(itemId, toolName, args, status)) {
          return actions;
        }
        const context = this.ensureToolContext(actions, itemId, toolName, args);
        if (status === 'completed') {
          const hasError = typeof item.error === 'string' && item.error.trim().length > 0;
          const parsedResult = hasError
            ? { text: item.error as string, images: [] as Array<{ data: string; mimeType: string }> }
            : formatMcpResult(item.result);
          const output = parsedResult.text;
          actions.push({
            type: 'trace.update',
            stepId: context.toolUseId,
            updates: {
              status: hasError ? 'error' : 'completed',
              toolOutput: output.slice(0, 800),
              isError: hasError,
            },
          });
          actions.push({
            type: 'tool.result',
            toolResult: {
              type: 'tool_result',
              toolUseId: context.toolUseId,
              content: output,
              isError: hasError,
              ...(parsedResult.images.length > 0 ? { images: parsedResult.images } : {}),
            },
          });
          this.toolContexts.delete(itemId);
        }
        return actions;
      }

      if (itemType === 'todo_list') {
        const todos = mapCodexTodoItems(item.items);
        const context = this.ensureToolContext(actions, itemId, 'TodoWrite', { todos });
        if (status === 'completed') {
          const output = `Todo list updated (${todos.length} items)`;
          actions.push({
            type: 'trace.update',
            stepId: context.toolUseId,
            updates: {
              status: 'completed',
              toolOutput: output,
              isError: false,
            },
          });
          actions.push({
            type: 'tool.result',
            toolResult: {
              type: 'tool_result',
              toolUseId: context.toolUseId,
              content: output,
              isError: false,
            },
          });
          this.toolContexts.delete(itemId);
        }
        return actions;
      }

      if (itemType === 'agent_message' && status === 'completed') {
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        if (text) {
          actions.push({ type: 'assistant.message', text });
        }
        return actions;
      }
    }

    return actions;
  }

  private ensureToolContext(
    actions: CodexMappedAction[],
    itemId: string,
    toolName: string,
    input: Record<string, unknown>
  ): ToolContext {
    const existing = this.toolContexts.get(itemId);
    if (existing) {
      return existing;
    }

    const toolUseId = itemId || this.idFactory();
    const context: ToolContext = {
      toolUseId,
      name: toolName,
      input,
    };
    this.toolContexts.set(itemId, context);

    actions.push({
      type: 'tool.use',
      toolUse: {
        type: 'tool_use',
        id: toolUseId,
        name: toolName,
        input,
      },
    });

    actions.push({
      type: 'trace.step',
      step: {
        id: toolUseId,
        type: 'tool_call',
        status: 'running',
        title: toolName,
        toolName,
        toolInput: input,
        timestamp: this.now(),
      },
    });

    return context;
  }

  private shouldSuppressDuplicateScreenshot(
    itemId: string,
    toolName: string,
    input: Record<string, unknown>,
    status: 'started' | 'completed'
  ): boolean {
    if (!toolName.endsWith('__screenshot_for_display')) {
      return false;
    }

    if (this.suppressedToolItems.has(itemId)) {
      return true;
    }

    const signature = `${toolName}:${stableStringify(input)}`;
    const now = this.now();
    const lastEntry = this.recentScreenshotCalls.get(signature);
    const windowMs = 90_000;

    // Keep first call lifecycle intact (started -> completed with same itemId).
    if (status === 'completed' && this.toolContexts.has(itemId)) {
      return false;
    }

    if (lastEntry && lastEntry.itemId !== itemId && now - lastEntry.at < windowMs) {
      this.suppressedToolItems.add(itemId);
      return true;
    }

    if (status === 'started') {
      this.recentScreenshotCalls.set(signature, { at: now, itemId });
    }
    return false;
  }
}

export function mapCodexTodoItems(rawItems: unknown): TodoWriteItem[] {
  if (!Array.isArray(rawItems)) {
    return [];
  }

  return rawItems.map((raw, index) => {
    const item = asRecord(raw) || {};
    const text = typeof item.text === 'string' ? item.text : `Task ${index + 1}`;
    const status = resolveTodoStatus(item.completed, item.status);
    return {
      content: text,
      status,
      id: typeof item.id === 'string' ? item.id : '',
      activeForm: typeof item.activeForm === 'string' ? item.activeForm : '',
    };
  });
}

function resolveTodoStatus(completed: unknown, status: unknown): TodoStatus {
  if (typeof status === 'string') {
    const normalized = status.toLowerCase();
    if (normalized === 'completed') return 'completed';
    if (normalized === 'in_progress') return 'in_progress';
    if (normalized === 'cancelled') return 'cancelled';
    if (normalized === 'pending') return 'pending';
  }
  if (completed === true) {
    return 'completed';
  }
  return 'pending';
}

function buildMcpToolName(item: Record<string, unknown>): string {
  const server = typeof item.server === 'string' ? item.server : 'MCP';
  const tool = typeof item.tool === 'string' ? item.tool : 'unknown';
  return `mcp__${server}__${tool}`;
}

function formatCommandOutput(item: Record<string, unknown>): string {
  const output = typeof item.aggregated_output === 'string' ? item.aggregated_output : '';
  const exitCode = typeof item.exit_code === 'number' ? item.exit_code : null;
  if (output.trim()) {
    return output;
  }
  if (exitCode === null) {
    return 'Command finished.';
  }
  return `Command exited with code ${exitCode}`;
}

function formatMcpResult(result: unknown): {
  text: string;
  images: Array<{ data: string; mimeType: string }>;
} {
  if (typeof result === 'string') {
    return { text: result, images: [] };
  }

  const resultRecord = asRecord(result);
  if (!resultRecord) {
    return { text: 'MCP tool call completed', images: [] };
  }

  const content = resultRecord.content;
  if (Array.isArray(content)) {
    const textParts: string[] = [];
    const images: Array<{ data: string; mimeType: string }> = [];
    for (const block of content) {
      const blockRecord = asRecord(block);
      if (!blockRecord) continue;
      const blockType = typeof blockRecord.type === 'string' ? blockRecord.type : '';
      if (typeof blockRecord.text === 'string') {
        textParts.push(blockRecord.text);
      } else if (blockType === 'image') {
        const image = parseImageBlock(blockRecord);
        if (image) {
          images.push(image);
        }
      }
    }
    if (textParts.length === 0 && images.length > 0) {
      textParts.push(`MCP tool call completed (${images.length} image${images.length > 1 ? 's' : ''})`);
    }
    return { text: textParts.join('\n'), images };
  }

  try {
    return { text: JSON.stringify(resultRecord, null, 2), images: [] };
  } catch {
    return { text: 'MCP tool call completed', images: [] };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function parseImageBlock(block: Record<string, unknown>): { data: string; mimeType: string } | null {
  const source = asRecord(block.source);
  const sourceData = source && typeof source.data === 'string' ? source.data.trim() : '';
  const directData = typeof block.data === 'string' ? block.data.trim() : '';
  const data = sourceData || directData;
  if (!data) {
    return null;
  }

  const sourceMimeType = source && typeof source.media_type === 'string' ? source.media_type.trim() : '';
  const directMimeType = typeof block.mimeType === 'string'
    ? block.mimeType.trim()
    : (typeof block.media_type === 'string' ? block.media_type.trim() : '');
  const mimeType = sourceMimeType || directMimeType || 'image/png';

  return { data, mimeType };
}
