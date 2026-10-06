import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => {
  const electron = {
    app: {
      isPackaged: false,
      getPath: () => '/tmp',
      getVersion: () => '0.0.0',
    },
  };

  return {
    ...electron,
    default: electron,
  };
});

vi.mock('../src/main/config/config-store', () => ({
  configStore: {
    get: () => undefined,
    getAll: () => ({}),
  },
}));

vi.mock('../src/main/agent/agent-runner', () => ({
  CoworkAgentRunner: class {
    run = vi.fn();
    cancel = vi.fn();
    handleQuestionResponse = vi.fn();
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getEnabledServers: () => [],
  },
}));

import { SessionManager } from '../src/main/session/session-manager';
import {
  buildTitlePrompt,
  getDefaultTitleFromPrompt,
} from '../src/main/session/session-title-utils';
import { buildScheduledTaskTitle } from '../src/shared/schedule/task-title';

describe('SessionManager scheduled title generation', () => {
  it('uses session title generation flow and prefixes scheduled title', async () => {
    const proto = SessionManager.prototype as unknown as {
      generateSessionTitleFromPrompt(prompt: string, cwd?: string): Promise<string>;
      generateScheduledTaskTitle(prompt: string, cwd?: string): Promise<string>;
    };
    const fakeManager = {
      withTimeout: vi.fn(async (promise: Promise<string | null>) => await promise),
      generateTitleWithConfig: vi.fn(async () => '论文检索总结'),
      generateSessionTitleFromPrompt: proto.generateSessionTitleFromPrompt,
    };

    const title = await proto.generateScheduledTaskTitle.call(
      fakeManager,
      '请帮我总结过去一周 Agent 论文',
      '/tmp/project'
    );

    expect(fakeManager.generateTitleWithConfig).toHaveBeenCalledWith(
      buildTitlePrompt('请帮我总结过去一周 Agent 论文')
    );
    expect(title).toBe('[Scheduled] 论文检索总结');
  });

  it('falls back to default prompt title when model title generation returns null', async () => {
    const proto = SessionManager.prototype as unknown as {
      generateSessionTitleFromPrompt(prompt: string, cwd?: string): Promise<string>;
      generateScheduledTaskTitle(prompt: string, cwd?: string): Promise<string>;
    };
    const prompt = '请帮我使用 Chrome 搜索并总结 2026 年最近一天内与 [Agent] 相关的论文';
    const fakeManager = {
      withTimeout: vi.fn(async (promise: Promise<string | null>) => await promise),
      generateTitleWithConfig: vi.fn(async () => null),
      generateSessionTitleFromPrompt: proto.generateSessionTitleFromPrompt,
    };

    const title = await proto.generateScheduledTaskTitle.call(fakeManager, prompt, '/tmp/project');

    expect(title).toBe(buildScheduledTaskTitle(getDefaultTitleFromPrompt(prompt)));
  });
});
