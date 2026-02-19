import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getEnabledServers: () => [],
  },
}));

vi.mock('../src/main/claude/agent-runner', () => ({
  ClaudeAgentRunner: class {
    run = vi.fn();
    cancel = vi.fn();
    handleQuestionResponse = vi.fn();
  },
}));

vi.mock('../src/main/openai/responses-runner', () => ({
  OpenAIResponsesRunner: class {
    run = vi.fn();
    cancel = vi.fn();
    handleQuestionResponse = vi.fn();
  },
}));

import type { Message, Session } from '../src/renderer/types';
import { configStore } from '../src/main/config/config-store';
import { CodexCliRunner } from '../src/main/openai/codex-cli-runner';
import { SessionManager } from '../src/main/session/session-manager';

function createSession(id: string): Session {
  return {
    id,
    title: 'test',
    status: 'idle',
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('SessionManager OpenAI failover guard', () => {
  const previous = {
    provider: configStore.get('provider'),
    customProtocol: configStore.get('customProtocol'),
    apiKey: configStore.get('apiKey'),
  };

  beforeEach(() => {
    configStore.set('provider', 'openai');
    configStore.set('customProtocol', 'openai');
    configStore.set('apiKey', 'sk-test');
  });

  afterEach(() => {
    configStore.set('provider', previous.provider);
    configStore.set('customProtocol', previous.customProtocol);
    configStore.set('apiKey', previous.apiKey);
    vi.restoreAllMocks();
  });

  it('blocks fallback rerun when codex turn already had side effects', async () => {
    const fallbackRun = vi.fn().mockResolvedValue(undefined);
    const fakeManager = {
      openaiBackendRoute: 'codex-cli',
      agentRunner: new CodexCliRunner({ sendToRenderer: () => undefined }),
      responsesFallbackRunnerBySession: new Map(),
      createOpenAIResponsesRunner: () => ({ run: fallbackRun, cancel: vi.fn() }),
      extractCodexFailureContext: (SessionManager.prototype as any).extractCodexFailureContext,
    } as any;

    const error: any = new Error('Codex CLI exited with code 1: runtime');
    error.codexFailureContext = {
      hasTurnOutput: true,
      hasTurnSideEffects: true,
    };

    const result = await (SessionManager.prototype as any).tryRunOpenAIResponsesFallback.call(
      fakeManager,
      createSession('s-1'),
      'prompt',
      [] as Message[],
      error
    );

    expect(result).toBe(false);
    expect(fallbackRun).not.toHaveBeenCalled();
  });

  it('runs responses fallback when codex failed before any output/side effects', async () => {
    const fallbackRun = vi.fn().mockResolvedValue(undefined);
    const fakeManager = {
      openaiBackendRoute: 'codex-cli',
      agentRunner: new CodexCliRunner({ sendToRenderer: () => undefined }),
      responsesFallbackRunnerBySession: new Map(),
      createOpenAIResponsesRunner: () => ({ run: fallbackRun, cancel: vi.fn() }),
      extractCodexFailureContext: (SessionManager.prototype as any).extractCodexFailureContext,
    } as any;

    const error: any = new Error('Codex CLI exited with code 1: runtime');
    error.codexFailureContext = {
      hasTurnOutput: false,
      hasTurnSideEffects: false,
    };

    const session = createSession('s-2');
    const result = await (SessionManager.prototype as any).tryRunOpenAIResponsesFallback.call(
      fakeManager,
      session,
      'prompt',
      [] as Message[],
      error
    );

    expect(result).toBe(true);
    expect(fallbackRun).toHaveBeenCalledTimes(1);
    expect(fallbackRun).toHaveBeenCalledWith(session, 'prompt', []);
  });

  it('does not fallback for unauthorized error without codex context', async () => {
    const fallbackRun = vi.fn().mockResolvedValue(undefined);
    const fakeManager = {
      openaiBackendRoute: 'codex-cli',
      agentRunner: new CodexCliRunner({ sendToRenderer: () => undefined }),
      responsesFallbackRunnerBySession: new Map(),
      createOpenAIResponsesRunner: () => ({ run: fallbackRun, cancel: vi.fn() }),
      extractCodexFailureContext: (SessionManager.prototype as any).extractCodexFailureContext,
    } as any;

    const error: any = new Error('upstream unauthorized');
    error.codexFailureContext = {
      hasTurnOutput: false,
      hasTurnSideEffects: false,
    };

    const result = await (SessionManager.prototype as any).tryRunOpenAIResponsesFallback.call(
      fakeManager,
      createSession('s-unauthorized'),
      'prompt',
      [] as Message[],
      error
    );

    expect(result).toBe(false);
    expect(fallbackRun).not.toHaveBeenCalled();
  });

  it('does not fallback for cancelled errors', async () => {
    const fallbackRun = vi.fn().mockResolvedValue(undefined);
    const fakeManager = {
      openaiBackendRoute: 'codex-cli',
      agentRunner: new CodexCliRunner({ sendToRenderer: () => undefined }),
      responsesFallbackRunnerBySession: new Map(),
      createOpenAIResponsesRunner: () => ({ run: fallbackRun, cancel: vi.fn() }),
      extractCodexFailureContext: (SessionManager.prototype as any).extractCodexFailureContext,
    } as any;

    const error = new Error('AbortError: The operation was aborted');
    const result = await (SessionManager.prototype as any).tryRunOpenAIResponsesFallback.call(
      fakeManager,
      createSession('s-3'),
      'prompt',
      [] as Message[],
      error
    );

    expect(result).toBe(false);
    expect(fallbackRun).not.toHaveBeenCalled();
  });
});
