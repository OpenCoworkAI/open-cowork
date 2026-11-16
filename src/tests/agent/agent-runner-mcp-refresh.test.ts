import { describe, expect, it, vi } from 'vitest';
import type { PathResolver } from '../../main/sandbox/path-resolver';

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: vi.fn(),
  getModel: vi.fn(() => undefined),
}));
vi.mock('../../main/agent/shared-auth', () => ({
  getSharedAuthStorage: () => ({ setRuntimeApiKey: vi.fn() }),
  ModelRegistry: vi.fn(),
}));
import { CoworkAgentRunner } from '../../main/agent/agent-runner';

describe('MCP tool changes in cached SDK sessions', () => {
  it('keeps the executing session alive and replaces its tools at the next turn boundary', () => {
    const runner = new CoworkAgentRunner({ sendToRenderer: vi.fn() }, {} as PathResolver);
    const cached = { session: { dispose: vi.fn() }, mcpToolsVersion: 0 };
    const internal = runner as unknown as {
      piSessions: Map<string, typeof cached>;
      refreshCachedMcpSession(id: string, entry: typeof cached): typeof cached | undefined;
    };
    internal.piSessions.set('chat', cached);
    expect(internal.refreshCachedMcpSession('chat', cached)).toBe(cached);
    runner.invalidateMcpServersCache();
    expect(cached.session.dispose).not.toHaveBeenCalled();
    expect(internal.refreshCachedMcpSession('chat', cached)).toBeUndefined();
    expect(cached.session.dispose).toHaveBeenCalledTimes(1);
    expect(internal.piSessions.has('chat')).toBe(false);
  });
});
