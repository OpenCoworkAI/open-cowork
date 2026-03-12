import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const agentRunnerPath = path.resolve(process.cwd(), 'src/main/claude/agent-runner.ts');
const agentRunnerContent = readFileSync(agentRunnerPath, 'utf8');

describe('ClaudeAgentRunner pi-coding-agent integration', () => {
  it('avoids dynamic re-import shadowing for config store singletons', () => {
    expect(agentRunnerContent).toContain("import { mcpConfigStore } from '../mcp/mcp-config-store'");
    expect(agentRunnerContent).not.toContain("const { configStore } = await import('../config/config-store')");
    expect(agentRunnerContent).not.toContain("const { mcpConfigStore } = await import('../mcp/mcp-config-store')");
  });

  it('keeps MCP config build resilient', () => {
    expect(agentRunnerContent).toContain('function safeStringify');
    expect(agentRunnerContent).toContain('Failed to prepare MCP server config, skipping server');
  });

  it('uses standard markdown link guidance for sources citations', () => {
    expect(agentRunnerContent).toContain('otherwise use standard Markdown links: [Title](https://claude.ai/chat/URL)');
  });

  it('avoids duplicating the current user prompt in contextual history assembly', () => {
    expect(agentRunnerContent).toContain('const conversationMessages = existingMessages');
    expect(agentRunnerContent).toContain('conversationMessages.slice(0, -1)');
    expect(agentRunnerContent).toContain("conversationMessages[conversationMessages.length - 1]?.role === 'user'");
  });

  it('keeps MCP server logging compact unless full debug logging is enabled', () => {
    expect(agentRunnerContent).toContain("log('[ClaudeAgentRunner] Final mcpServers summary:'");
    expect(agentRunnerContent).toContain("if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === '1') {");
    expect(agentRunnerContent).toContain("log('[ClaudeAgentRunner] Final mcpServers config:'");
  });

  it('maps watchdog timeout to a user-friendly message', () => {
    expect(agentRunnerContent).toContain('function toUserFacingErrorText');
    expect(agentRunnerContent).toContain('模型响应超时：长时间未收到上游返回');
    expect(agentRunnerContent).toContain('const errorText = toUserFacingErrorText(toErrorText(error));');
  });

  it('uses pi DefaultResourceLoader with additionalSkillPaths and appendSystemPrompt', () => {
    expect(agentRunnerContent).toContain('additionalSkillPaths: skillPaths');
    expect(agentRunnerContent).toContain('appendSystemPrompt: coworkAppendPrompt');
    expect(agentRunnerContent).not.toContain('systemPromptOverride');
  });

  it('nudges the model to proceed with reasonable assumptions', () => {
    expect(agentRunnerContent).toContain('proceed immediately with reasonable assumptions');
    expect(agentRunnerContent).toContain('within two days');
    expect(agentRunnerContent).toContain('most recent two relevant publication days');
  });

  it('does not reference removed AskUserQuestion or TodoWrite tools', () => {
    expect(agentRunnerContent).not.toContain('AskUserQuestion');
    expect(agentRunnerContent).not.toContain('TodoWrite');
    expect(agentRunnerContent).not.toContain('pendingQuestions');
  });

  it('chat-first behavioral rules are present', () => {
    expect(agentRunnerContent).toContain('CHAT FIRST');
    expect(agentRunnerContent).toContain('Do NOT create, write, or edit files unless the user explicitly asks');
    expect(agentRunnerContent).toContain('START DOING IT');
  });
});
