import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const agentRunnerPath = path.resolve(process.cwd(), 'src/main/claude/agent-runner.ts');
const agentRunnerContent = readFileSync(agentRunnerPath, 'utf8');

describe('ClaudeAgentRunner plugin runtime integration', () => {
  it('injects SDK local plugins into query options', () => {
    expect(agentRunnerContent).toContain('await this.pluginRuntimeService.getEnabledRuntimePlugins()');
    expect(agentRunnerContent).toContain("plugins: sdkPlugins.length > 0 ? sdkPlugins : undefined");
  });

  it('emits runtime applied plugin event after SDK init', () => {
    expect(agentRunnerContent).toContain("type: 'plugins.runtimeApplied'");
    expect(agentRunnerContent).toContain('sdkPluginsInSession');
  });
});
