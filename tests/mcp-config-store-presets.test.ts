import { describe, expect, it, vi } from 'vitest';

vi.mock('electron-store', () => ({
  default: class MockStore {
    get(_key: string, fallback: unknown): unknown {
      return fallback;
    }

    set(): void {}
  },
}));

import { MCP_SERVER_PRESETS, mcpConfigStore } from '../src/main/mcp/mcp-config-store';

describe('MCP server presets', () => {
  it('provides anonymous Parallel Search as an opt-in Streamable HTTP server', () => {
    expect(MCP_SERVER_PRESETS['parallel-search']).toEqual({
      name: 'Parallel Search',
      type: 'streamable-http',
      url: 'https://search.parallel.ai/mcp',
    });

    expect(mcpConfigStore.createFromPreset('parallel-search')).toEqual({
      id: expect.stringMatching(/^mcp-parallel-search-/),
      enabled: false,
      name: 'Parallel Search',
      type: 'streamable-http',
      url: 'https://search.parallel.ai/mcp',
    });
  });
});
