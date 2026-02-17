import { spawn, type ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import type { Message, ServerEvent, Session, TraceStep } from '../../renderer/types';
import type { MCPManager } from '../mcp/mcp-manager';
import { configStore } from '../config/config-store';
import { buildCodexMcpOverrides } from '../mcp/codex-mcp-overrides';
import { extractArtifactsFromText, buildArtifactTraceSteps } from '../utils/artifact-parser';
import { buildOpenAICoworkInstructions } from '../utils/cowork-instructions';
import { log, logError, logWarn } from '../utils/logger';
import { CodexCliEventMapper, type CodexJsonEvent } from './codex-cli-event-mapper';
import { buildScreenInterpretVisionQuestion, isScreenInterpretationPrompt } from './screen-interpret-intent';

interface CodexCliRunnerOptions {
  sendToRenderer: (event: ServerEvent) => void;
  saveMessage?: (message: Message) => void;
  mcpManager?: MCPManager;
}

interface BuildCodexArgsParams {
  cwd: string;
  prompt: string;
  threadId?: string;
  model?: string;
  mcpOverrides: string[];
}

type ParsedMcpToolResult = {
  text: string;
  images: Array<{ data: string; mimeType: string }>;
};

type AutoTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

type AutoTodoItem = {
  content: string;
  status: AutoTodoStatus;
  id: string;
  activeForm: string;
};

export class CodexCliRunner {
  private sendToRenderer: (event: ServerEvent) => void;
  private saveMessage?: (message: Message) => void;
  private mcpManager?: MCPManager;

  private activeProcesses: Map<string, ChildProcess> = new Map();
  private threadBySession: Map<string, string> = new Map();
  private currentThinkingStepBySession: Map<string, string> = new Map();
  private cancelledSessions: Set<string> = new Set();
  private sawTodoWriteBySession: Map<string, boolean> = new Map();

  constructor(options: CodexCliRunnerOptions) {
    this.sendToRenderer = options.sendToRenderer;
    this.saveMessage = options.saveMessage;
    this.mcpManager = options.mcpManager;
  }

  async run(session: Session, prompt: string, _existingMessages: Message[]): Promise<void> {
    const cwd = session.cwd || session.mountedPaths?.[0]?.real || process.cwd();
    const initialThreadId = this.threadBySession.get(session.id);
    const model = configStore.get('model') || process.env.OPENAI_MODEL || 'gpt-5.2-codex';
    this.sawTodoWriteBySession.set(session.id, false);

    if (await this.tryRunDirectScreenInterpretation(session, prompt)) {
      return;
    }

    const composedPrompt = this.buildPromptWithInstructions(session, prompt);
    const mcpOverrides = buildCodexMcpOverrides({ runtimeEnv: process.env });
    const runtimeAuthSummary = summarizeRuntimeAuthEnv(process.env);
    const mcpOverrideAuthSummary = summarizeOverrideAuthEnv(mcpOverrides);
    const runOnce = async (threadId?: string): Promise<void> => {
      const args = buildCodexCliArgs({
        cwd,
        prompt: composedPrompt,
        threadId,
        model,
        mcpOverrides,
      });
      await this.executeCodexProcess(session, cwd, args);
    };

    log('[CodexCliRunner] Starting run', {
      sessionId: session.id,
      cwd,
      model,
      threadId: initialThreadId || '(new)',
      mcpOverrideCount: mcpOverrides.length,
      runtimeAuthSummary,
      mcpOverrideAuthSummary,
    });

    this.cancelledSessions.delete(session.id);
    const autoTodoSeed = this.buildAutoTodoSeed(prompt);
    let autoTodoShown = false;
    const autoTodoTimer = autoTodoSeed
      ? setTimeout(() => {
          if (this.sawTodoWriteBySession.get(session.id)) {
            return;
          }
          this.emitTodoWriteWidget(session.id, autoTodoSeed.map((item) => ({ ...item })));
          autoTodoShown = true;
        }, 2500)
      : null;
    if (autoTodoTimer) {
      autoTodoTimer.unref();
    }

    try {
      await runOnce(initialThreadId);
      if (autoTodoTimer) {
        clearTimeout(autoTodoTimer);
      }
      if (autoTodoShown && autoTodoSeed && !this.sawTodoWriteBySession.get(session.id)) {
        const completed = autoTodoSeed.map((item) => ({
          ...item,
          status: 'completed' as const,
          activeForm: item.activeForm || item.content,
        }));
        this.emitTodoWriteWidget(session.id, completed);
      }
    } catch (error) {
      if (autoTodoTimer) {
        clearTimeout(autoTodoTimer);
      }
      if (initialThreadId && this.shouldRetryWithoutResume(error)) {
        logWarn('[CodexCliRunner] Resume failed, retrying with fresh thread', {
          sessionId: session.id,
          threadId: initialThreadId,
        });
        this.threadBySession.delete(session.id);
        try {
          await runOnce(undefined);
          if (autoTodoShown && autoTodoSeed && !this.sawTodoWriteBySession.get(session.id)) {
            const completed = autoTodoSeed.map((item) => ({
              ...item,
              status: 'completed' as const,
              activeForm: item.activeForm || item.content,
            }));
            this.emitTodoWriteWidget(session.id, completed);
          }
          return;
        } catch (retryError) {
          error = retryError;
        }
      }

      if (this.cancelledSessions.has(session.id)) {
        return;
      }

      const message = this.formatRunError(error);
      logError('[CodexCliRunner] Run failed:', error);
      if (autoTodoShown && autoTodoSeed && !this.sawTodoWriteBySession.get(session.id)) {
        const failed = autoTodoSeed.map((item) => {
          if (item.status === 'in_progress') {
            return { ...item, status: 'cancelled' as const };
          }
          return item;
        });
        this.emitTodoWriteWidget(session.id, failed);
      }

      this.sendMessage(session.id, {
        id: uuidv4(),
        sessionId: session.id,
        role: 'assistant',
        content: [{ type: 'text', text: `**Error**: ${message}` }],
        timestamp: Date.now(),
      });

      const thinkingStepId = this.currentThinkingStepBySession.get(session.id);
      if (thinkingStepId) {
        this.sendTraceUpdate(session.id, thinkingStepId, {
          status: 'error',
          title: 'Error occurred',
          toolOutput: message,
          isError: true,
        });
      } else {
        this.sendTraceStep(session.id, {
          id: uuidv4(),
          type: 'thinking',
          status: 'error',
          title: 'Error occurred',
          content: message,
          timestamp: Date.now(),
        });
      }
    } finally {
      this.sawTodoWriteBySession.delete(session.id);
    }
  }

  cancel(sessionId: string): void {
    this.cancelledSessions.add(sessionId);
    const process = this.activeProcesses.get(sessionId);
    if (!process) {
      return;
    }

    log('[CodexCliRunner] Cancelling session:', sessionId);
    process.kill('SIGTERM');
    setTimeout(() => {
      if (this.activeProcesses.get(sessionId) === process) {
        process.kill('SIGKILL');
      }
    }, 1500).unref();
  }

  handleQuestionResponse(_questionId: string, _answer: string): void {
    // Codex CLI path does not currently use AskUserQuestion callbacks.
  }

  clearSdkSession(sessionId: string): void {
    this.threadBySession.delete(sessionId);
  }

  private async executeCodexProcess(session: Session, cwd: string, args: string[]): Promise<void> {
    const mapper = new CodexCliEventMapper({ cwd });
    const childProcess = spawn('codex', args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.activeProcesses.set(session.id, childProcess);

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let chain: Promise<void> = Promise.resolve();

    const queueLine = (line: string) => {
      chain = chain
        .then(() => this.handleOutputLine(session.id, mapper, line))
        .catch((error) => {
          logError('[CodexCliRunner] Failed to handle line:', error);
        });
    };

    childProcess.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        queueLine(line);
      }
    });

    childProcess.stderr?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderrBuffer += text;
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) {
          logWarn('[CodexCliRunner][stderr]', trimmed);
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      childProcess.on('error', (error: unknown) => {
        finish(error instanceof Error ? error : new Error(String(error)));
      });

      childProcess.on('close', (code: number | null) => {
        void (async () => {
          if (stdoutBuffer.trim()) {
            queueLine(stdoutBuffer);
            stdoutBuffer = '';
          }
          await chain;

          this.activeProcesses.delete(session.id);
          const wasCancelled = this.cancelledSessions.delete(session.id);
          if (wasCancelled) {
            finish();
            return;
          }

          if (code === 0) {
            finish();
            return;
          }

          const errorMessage = this.buildExitErrorMessage(code, stderrBuffer);
          finish(new Error(errorMessage));
        })();
      });
    });

    this.currentThinkingStepBySession.delete(session.id);
  }

  private async handleOutputLine(sessionId: string, mapper: CodexCliEventMapper, line: string): Promise<void> {
    const event = parseCodexJsonLine(line);
    if (!event) {
      const trimmed = line.trim();
      if (trimmed) {
        log('[CodexCliRunner] Ignoring non-JSON output:', trimmed.slice(0, 180));
      }
      return;
    }

    const actions = mapper.map(event);
    for (const action of actions) {
      if (action.type === 'thread.started') {
        this.threadBySession.set(sessionId, action.threadId);
        continue;
      }

      if (action.type === 'trace.step') {
        if (action.step.type === 'thinking' && action.step.status === 'running') {
          this.currentThinkingStepBySession.set(sessionId, action.step.id);
        }
        this.sendTraceStep(sessionId, action.step);
        continue;
      }

      if (action.type === 'trace.update') {
        this.sendTraceUpdate(sessionId, action.stepId, action.updates);
        if (action.updates.status && action.updates.status !== 'running') {
          const currentStep = this.currentThinkingStepBySession.get(sessionId);
          if (currentStep === action.stepId) {
            this.currentThinkingStepBySession.delete(sessionId);
          }
        }
        continue;
      }

      if (action.type === 'tool.use') {
        if (action.toolUse.name === 'TodoWrite') {
          this.sawTodoWriteBySession.set(sessionId, true);
        }
        this.sendMessage(sessionId, {
          id: uuidv4(),
          sessionId,
          role: 'assistant',
          content: [action.toolUse],
          timestamp: Date.now(),
        });
        continue;
      }

      if (action.type === 'tool.result') {
        this.sendMessage(sessionId, {
          id: uuidv4(),
          sessionId,
          role: 'assistant',
          content: [action.toolResult],
          timestamp: Date.now(),
        });
        continue;
      }

      if (action.type === 'assistant.message') {
        await this.streamAssistantMessage(sessionId, action.text);
      }
    }
  }

  private async streamAssistantMessage(sessionId: string, text: string): Promise<void> {
    const { cleanText, artifacts } = extractArtifactsFromText(text);
    for (const step of buildArtifactTraceSteps(artifacts)) {
      this.sendTraceStep(sessionId, step);
    }

    const chunks = cleanText.match(/.{1,30}/g) || [cleanText];
    for (const chunk of chunks) {
      if (!chunk) continue;
      if (this.cancelledSessions.has(sessionId)) {
        return;
      }
      this.sendPartial(sessionId, chunk);
      await this.delay(10);
    }

    this.sendPartial(sessionId, '');
    this.sendMessage(sessionId, {
      id: uuidv4(),
      sessionId,
      role: 'assistant',
      content: [{ type: 'text', text: cleanText }],
      timestamp: Date.now(),
    });
  }

  private buildPromptWithInstructions(session: Session, prompt: string): string {
    const instructions = buildOpenAICoworkInstructions(session, this.mcpManager);
    const behaviorPrefix = [
      'Execution rules:',
      '- Prioritize MCP Chrome tools for browser/web tasks when available.',
      '- If missing details are non-blocking, make a reasonable assumption and continue.',
      '- Use tools proactively instead of answering hypothetically when tool execution is possible.',
      '- Do not repeat the same screenshot/tool call with identical arguments in a single turn unless the user explicitly asks to retry.',
      '- If a required tool fails (especially vision), stop retries quickly and report the exact error plus the next actionable step.',
      '- For requests like "截图并解读屏幕信息", capture at most one screenshot in the same turn before giving the interpretation.',
      '- For screenshot interpretation tasks, never use execute_command/screencapture when GUI_Operate screenshot_for_display is available.',
      '- Before tool execution, output at most one short preamble sentence; do not repeat the same intent announcement.',
    ].join('\n');

    return [
      '<system_instructions>',
      instructions,
      '</system_instructions>',
      '',
      '<behavior_prefix>',
      behaviorPrefix,
      '</behavior_prefix>',
      '',
      prompt,
    ].join('\n');
  }

  private buildExitErrorMessage(code: number | null, stderr: string): string {
    const lines = stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const filtered = lines.filter((line) => !isBenignCodexStateNoise(line));
    const snippet = filtered.join(' ').trim().slice(0, 800);
    const lower = snippet.toLowerCase();

    if (lower.includes('auth') || lower.includes('login') || lower.includes('unauthorized')) {
      return 'Codex CLI authentication failed. Please run `codex auth login` and try again.';
    }

    if (snippet) {
      return `Codex CLI exited with code ${code ?? 'unknown'}: ${snippet}`;
    }

    if (lines.length > 0) {
      return 'Codex CLI session state is inconsistent. Retrying usually fixes it; if repeated, run `codex auth login` and restart the app.';
    }

    return `Codex CLI exited with code ${code ?? 'unknown'}.`;
  }

  private formatRunError(error: unknown): string {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return 'Codex CLI is not installed or not found in PATH. Please install Codex CLI and run `codex auth login`.';
    }

    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private shouldRetryWithoutResume(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('state db missing rollout path')) {
      return true;
    }
    if (message.includes('record_discrepancy')) {
      return true;
    }
    if (message.includes('resume') && message.includes('thread')) {
      return true;
    }
    return false;
  }

  private async tryRunDirectScreenInterpretation(session: Session, prompt: string): Promise<boolean> {
    if (!this.mcpManager || !isScreenInterpretationPrompt(prompt)) {
      return false;
    }

    const screenshotToolName = this.resolveMcpToolName('screenshot_for_display');
    const visionToolName = this.resolveMcpToolName('gui_verify_vision');
    if (!screenshotToolName || !visionToolName) {
      logWarn('[CodexCliRunner] Direct screenshot interpretation skipped: required GUI MCP tools unavailable', {
        sessionId: session.id,
        screenshotToolName,
        visionToolName,
      });
      return false;
    }

    const thinkingStepId = uuidv4();
    this.currentThinkingStepBySession.set(session.id, thinkingStepId);
    this.sendTraceStep(session.id, {
      id: thinkingStepId,
      type: 'thinking',
      status: 'running',
      title: 'Capturing and interpreting screen',
      timestamp: Date.now(),
    });

    log('[CodexCliRunner] Handling prompt via direct screenshot interpretation flow', {
      sessionId: session.id,
      screenshotToolName,
      visionToolName,
      mcpServerStatus: this.mcpManager.getServerStatus().map((status) => ({
        name: status.name,
        connected: status.connected,
        toolCount: status.toolCount,
      })),
    });

    try {
      await this.callMcpToolWithUi(session.id, screenshotToolName, {
        display_index: 0,
        force_refresh: true,
        reason: '用户请求截图并解读屏幕信息',
      });

      const visionQuestion = buildScreenInterpretVisionQuestion(prompt);
      const visionResult = await this.callMcpToolWithUi(session.id, visionToolName, {
        display_index: 0,
        question: visionQuestion,
      });

      const visionEnvelope = parseVisionEnvelope(visionResult.text);
      const answerSource = visionEnvelope?.answer || visionResult.text;
      const answer = sanitizeScreenInterpretationAnswer(answerSource);
      if (!answer) {
        throw new Error('Vision tool returned empty response.');
      }
      await this.streamAssistantMessage(session.id, answer);

      this.sendTraceUpdate(session.id, thinkingStepId, {
        status: 'completed',
        title: 'Screen interpretation completed',
      });
      return true;
    } catch (error) {
      const message = this.formatRunError(error);
      this.sendTraceUpdate(session.id, thinkingStepId, {
        status: 'error',
        title: 'Screen interpretation failed',
        toolOutput: message,
        isError: true,
      });
      this.sendMessage(session.id, {
        id: uuidv4(),
        sessionId: session.id,
        role: 'assistant',
        content: [{ type: 'text', text: `截图或视觉解读失败：${message}` }],
        timestamp: Date.now(),
      });
      return true;
    } finally {
      this.currentThinkingStepBySession.delete(session.id);
    }
  }

  private resolveMcpToolName(toolLeafName: string): string | null {
    if (!this.mcpManager) {
      return null;
    }

    const exact = `mcp__GUI_Operate__${toolLeafName}`;
    if (this.mcpManager.getTool(exact)) {
      return exact;
    }

    const normalizedLeaf = toolLeafName.toLowerCase();
    const tools = this.mcpManager.getTools();
    const guiMatch = tools.find((tool) => {
      const nameLower = tool.name.toLowerCase();
      const serverLower = tool.serverName.toLowerCase();
      return nameLower.endsWith(`__${normalizedLeaf}`) && serverLower.includes('gui');
    });

    return guiMatch?.name || null;
  }

  private async callMcpToolWithUi(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<ParsedMcpToolResult> {
    if (!this.mcpManager) {
      throw new Error('MCP manager unavailable');
    }

    const toolUseId = uuidv4();
    this.sendMessage(sessionId, {
      id: uuidv4(),
      sessionId,
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: toolName,
          input,
        },
      ],
      timestamp: Date.now(),
    });

    this.sendTraceStep(sessionId, {
      id: toolUseId,
      type: 'tool_call',
      status: 'running',
      title: toolName,
      toolName,
      toolInput: input,
      timestamp: Date.now(),
    });

    try {
      const raw = await this.mcpManager.callTool(toolName, input);
      const parsed = parseMcpToolResult(raw);
      const structuredError = extractStructuredToolError(parsed.text);
      const isError = Boolean(structuredError);
      const content = structuredError || parsed.text || 'MCP tool call completed';

      this.sendTraceUpdate(sessionId, toolUseId, {
        status: isError ? 'error' : 'completed',
        toolOutput: content.slice(0, 800),
        isError,
      });

      this.sendMessage(sessionId, {
        id: uuidv4(),
        sessionId,
        role: 'assistant',
        content: [
          {
            type: 'tool_result',
            toolUseId,
            content,
            isError,
            ...(parsed.images.length > 0 ? { images: parsed.images } : {}),
          },
        ],
        timestamp: Date.now(),
      });

      if (isError) {
        const structuredToolError = new Error(content) as Error & { toolResultAlreadySent?: boolean };
        structuredToolError.toolResultAlreadySent = true;
        throw structuredToolError;
      }
      return parsed;
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      logWarn('[CodexCliRunner] MCP tool call failed', {
        sessionId,
        toolName,
        errorText,
        mcpServerStatus: this.mcpManager.getServerStatus().map((status) => ({
          name: status.name,
          connected: status.connected,
          toolCount: status.toolCount,
        })),
      });
      const alreadyReported = Boolean(
        error &&
        typeof error === 'object' &&
        (error as { toolResultAlreadySent?: boolean }).toolResultAlreadySent
      );

      this.sendTraceUpdate(sessionId, toolUseId, {
        status: 'error',
        toolOutput: errorText.slice(0, 800),
        isError: true,
      });

      if (!alreadyReported) {
        this.sendMessage(sessionId, {
          id: uuidv4(),
          sessionId,
          role: 'assistant',
          content: [
            {
              type: 'tool_result',
              toolUseId,
              content: errorText,
              isError: true,
            },
          ],
          timestamp: Date.now(),
        });
      }

      throw error;
    }
  }

  private buildAutoTodoSeed(prompt: string): AutoTodoItem[] | null {
    if (process.env.COWORK_AUTO_TODO !== '0') {
      const trimmed = (prompt || '').trim();
      if (!trimmed) {
        return null;
      }
      const complex = isLikelyComplexTask(trimmed);
      if (!complex) {
        return null;
      }
      const templates = buildTodoTemplate(trimmed);
      return templates.map((content, index) => ({
        content,
        status: index === 0 ? 'in_progress' : 'pending',
        id: `auto-todo-${index + 1}`,
        activeForm: content,
      }));
    }
    return null;
  }

  private emitTodoWriteWidget(sessionId: string, todos: AutoTodoItem[]): void {
    const toolUseId = `todo-auto-${uuidv4()}`;
    this.sendMessage(sessionId, {
      id: uuidv4(),
      sessionId,
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: 'TodoWrite',
          input: { todos },
        },
      ],
      timestamp: Date.now(),
    });

    this.sendTraceStep(sessionId, {
      id: toolUseId,
      type: 'tool_call',
      status: 'completed',
      title: 'TodoWrite',
      toolName: 'TodoWrite',
      toolInput: { todos },
      toolOutput: `Todo list updated (${todos.length} items)`,
      timestamp: Date.now(),
      isError: false,
    });

    this.sendMessage(sessionId, {
      id: uuidv4(),
      sessionId,
      role: 'assistant',
      content: [
        {
          type: 'tool_result',
          toolUseId,
          content: `Todo list updated (${todos.length} items)`,
          isError: false,
        },
      ],
      timestamp: Date.now(),
    });
  }

  private sendTraceStep(sessionId: string, step: TraceStep): void {
    this.sendToRenderer({ type: 'trace.step', payload: { sessionId, step } });
  }

  private sendTraceUpdate(sessionId: string, stepId: string, updates: Partial<TraceStep>): void {
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function summarizeRuntimeAuthEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return {
    OPENAI_API_KEY: env.OPENAI_API_KEY?.trim() ? 'set' : 'unset',
    OPENAI_BASE_URL: env.OPENAI_BASE_URL?.trim() || '(unset)',
    OPENAI_MODEL: env.OPENAI_MODEL?.trim() || '(unset)',
    OPENAI_ACCOUNT_ID: env.OPENAI_ACCOUNT_ID?.trim() ? 'set' : 'unset',
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY?.trim() ? 'set' : 'unset',
    ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN?.trim() ? 'set' : 'unset',
  };
}

function summarizeOverrideAuthEnv(overrides: string[]): Record<string, string | number> {
  const joined = overrides.join('\n');
  return {
    overrideCount: overrides.length,
    containsOpenAIKey: joined.includes('OPENAI_API_KEY=') ? 'yes' : 'no',
    containsOpenAIBaseUrl: joined.includes('OPENAI_BASE_URL=') ? 'yes' : 'no',
    containsOpenAIModel: joined.includes('OPENAI_MODEL=') ? 'yes' : 'no',
    containsAnthropicKey: joined.includes('ANTHROPIC_API_KEY=') ? 'yes' : 'no',
    containsAnthropicToken: joined.includes('ANTHROPIC_AUTH_TOKEN=') ? 'yes' : 'no',
  };
}

export function parseCodexJsonLine(line: string): CodexJsonEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed.type !== 'string') {
      return null;
    }
    return parsed as unknown as CodexJsonEvent;
  } catch {
    return null;
  }
}

export function buildCodexCliArgs(params: BuildCodexArgsParams): string[] {
  const args: string[] = ['--dangerously-bypass-approvals-and-sandbox', 'exec'];

  if (params.threadId) {
    args.push('resume', '--json', '--skip-git-repo-check');
  } else {
    args.push('--json', '--skip-git-repo-check', '-C', params.cwd);
  }

  if (params.model?.trim()) {
    args.push('-m', params.model.trim());
  }

  for (const override of params.mcpOverrides) {
    args.push('-c', override);
  }

  if (params.threadId) {
    args.push(params.threadId, params.prompt);
  } else {
    args.push(params.prompt);
  }

  return args;
}

function isBenignCodexStateNoise(line: string): boolean {
  const lower = line.toLowerCase();
  if (lower.includes('state db missing rollout path')) {
    return true;
  }
  if (lower.includes('state db record_discrepancy')) {
    return true;
  }
  if (lower.includes('codex_core::rollout::list')) {
    return true;
  }
  return false;
}

function parseMcpToolResult(raw: unknown): ParsedMcpToolResult {
  if (typeof raw === 'string') {
    return { text: raw, images: [] };
  }

  const record = asRecord(raw);
  if (!record) {
    return { text: String(raw ?? ''), images: [] };
  }

  const content = record.content;
  if (!Array.isArray(content)) {
    try {
      return { text: JSON.stringify(record, null, 2), images: [] };
    } catch {
      return { text: 'MCP tool call completed', images: [] };
    }
  }

  const textParts: string[] = [];
  const images: Array<{ data: string; mimeType: string }> = [];
  for (const block of content) {
    const blockRecord = asRecord(block);
    if (!blockRecord) continue;

    const type = typeof blockRecord.type === 'string' ? blockRecord.type : '';
    if (type === 'text' && typeof blockRecord.text === 'string') {
      textParts.push(blockRecord.text);
      continue;
    }
    if (type === 'image') {
      const image = parseImageBlock(blockRecord);
      if (image) {
        images.push(image);
      }
    }
  }

  if (textParts.length === 0 && images.length > 0) {
    textParts.push(`MCP tool call completed (${images.length} image${images.length > 1 ? 's' : ''})`);
  }

  return { text: textParts.join('\n').trim(), images };
}

function parseVisionEnvelope(text: string): { answer: string; operationSuccess?: boolean } | null {
  const trimmed = (text || '').trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      answer?: unknown;
      operationSuccess?: unknown;
      success?: unknown;
    };
    if (typeof parsed.answer !== 'string' || !parsed.answer.trim()) {
      return null;
    }

    const operationSuccess =
      typeof parsed.operationSuccess === 'boolean' ? parsed.operationSuccess : undefined;

    // `success` only means tool-call execution succeeded, not necessarily operation correctness.
    // We only unwrap the human-readable answer field here.
    return {
      answer: parsed.answer.trim(),
      operationSuccess,
    };
  } catch {
    return null;
  }
}

function extractStructuredToolError(text: string): string | null {
  const trimmed = (text || '').trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
    if (parsed.error === true && typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    return null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
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

function isLikelyComplexTask(prompt: string): boolean {
  const text = prompt.toLowerCase();
  if (text.length > 120) return true;
  const keywords = [
    'search',
    'summarize',
    'analysis',
    'compare',
    'report',
    'research',
    'crawl',
    'collect',
    'chrome',
    'browser',
    '检索',
    '搜索',
    '总结',
    '分析',
    '调研',
    '报告',
    '多步',
    '两天',
  ];
  return keywords.some((keyword) => text.includes(keyword));
}

function buildTodoTemplate(prompt: string): string[] {
  const text = prompt.toLowerCase();
  const isResearch =
    text.includes('search') ||
    text.includes('summarize') ||
    text.includes('paper') ||
    text.includes('huggingface') ||
    text.includes('检索') ||
    text.includes('总结') ||
    text.includes('论文');

  if (isResearch) {
    return [
      'Open target source pages and collect candidates for the requested two-day window',
      'Filter LLM-related items and extract vote/comment information',
      'Write brief summaries for each selected paper',
      'Verify constraints (exactly two days, source scope) and finalize report',
    ];
  }

  return [
    'Break down the user request into executable steps',
    'Execute required tools and gather necessary evidence',
    'Draft the response based on verified results',
    'Verify completeness and deliver final answer',
  ];
}

function sanitizeScreenInterpretationAnswer(raw: string): string {
  let text = (raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) {
    return text;
  }

  text = collapseLikelyEchoedCjk(text);
  text = cutRepeatedScreenReport(text);
  return text.trim();
}

function collapseLikelyEchoedCjk(text: string): string {
  const cjk = text.match(/[\u4e00-\u9fff]/g) || [];
  if (cjk.length < 60) {
    return text;
  }
  const doubled = text.match(/([\u4e00-\u9fff])\1/g) || [];
  const ratio = doubled.length / cjk.length;
  if (ratio < 0.18) {
    return text;
  }
  return text.replace(/([\u4e00-\u9fff])\1/g, '$1');
}

function cutRepeatedScreenReport(text: string): string {
  const intros = ['下面是基于截图', '以下是我基于截图', '以下是基于截图'];
  for (const intro of intros) {
    const first = text.indexOf(intro);
    if (first < 0) continue;
    const second = text.indexOf(intro, first + intro.length);
    if (second > first + 80) {
      return text.slice(0, second).trim();
    }
  }

  const headingRegex = /###\s*1[\)\.]/g;
  const matches = [...text.matchAll(headingRegex)];
  if (matches.length >= 2) {
    const firstIndex = matches[0].index ?? -1;
    const secondIndex = matches[1].index ?? -1;
    if (firstIndex >= 0 && secondIndex > firstIndex + 120) {
      return text.slice(0, secondIndex).trim();
    }
  }
  return text;
}
