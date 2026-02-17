import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEnabledServers: vi.fn(() => []),
  createFromPreset: vi.fn(() => null),
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getEnabledServers: mocks.getEnabledServers,
    createFromPreset: mocks.createFromPreset,
  },
}));
vi.mock('../src/main/auth/local-auth', () => ({
  importLocalAuthToken: vi.fn(() => null),
}));

import {
  buildCodexMcpOverrides,
  normalizeCodexMcpServerKey,
  resolveCodexMcpServerArgs,
} from '../src/main/mcp/codex-mcp-overrides';

describe('codex mcp overrides', () => {
  it('normalizes server keys with spaces and special chars', () => {
    expect(normalizeCodexMcpServerKey('Software Development')).toBe('Software_Development');
    expect(normalizeCodexMcpServerKey('GUI-Operate')).toBe('GUI_Operate');
    expect(normalizeCodexMcpServerKey('123 Tool')).toBe('server_123_Tool');
  });

  it('resolves placeholder args', () => {
    const args = resolveCodexMcpServerArgs(
      ['{SOFTWARE_DEV_SERVER_PATH}', '{GUI_OPERATE_SERVER_PATH}', 'keep'],
      { softwareDevPath: '/tmp/dev.js', guiOperatePath: '/tmp/gui.js' },
    );
    expect(args).toEqual(['/tmp/dev.js', '/tmp/gui.js', 'keep']);
  });

  it('builds stdio and sse overrides for codex exec -c', () => {
    const overrides = buildCodexMcpOverrides({
      servers: [
        {
          id: 's1',
          name: 'Software Development',
          type: 'stdio',
          command: 'node',
          args: ['{SOFTWARE_DEV_SERVER_PATH}'],
          env: { WORKSPACE_DIR: '/repo' },
          enabled: true,
        },
        {
          id: 's2',
          name: 'Chrome',
          type: 'sse',
          url: 'http://localhost:3000/sse',
          headers: { Authorization: 'Bearer token' },
          enabled: true,
        },
      ] as any,
      placeholderValues: {
        softwareDevPath: '/tmp/software-dev.js',
      },
      runtimeEnv: {},
    });

    expect(overrides).toEqual([
      'mcp_servers.Software_Development={command="node",args=["/tmp/software-dev.js"],env={WORKSPACE_DIR="/repo"}}',
      'mcp_servers.Chrome={url="http://localhost:3000/sse",headers={Authorization="Bearer token"}}',
    ]);
  });

  it('deduplicates server keys stably', () => {
    const overrides = buildCodexMcpOverrides({
      servers: [
        { id: 'a', name: 'Chrome', type: 'stdio', command: 'npx', args: ['a'], enabled: true },
        { id: 'b', name: 'Chrome', type: 'stdio', command: 'npx', args: ['b'], enabled: true },
      ] as any,
      placeholderValues: {},
      runtimeEnv: {},
    });

    expect(overrides[0]).toMatch(/^mcp_servers\.Chrome=/);
    expect(overrides[1]).toMatch(/^mcp_servers\.Chrome_2=/);
  });

  it('injects runtime OpenAI auth env into stdio servers', () => {
    const overrides = buildCodexMcpOverrides({
      servers: [
        {
          id: 'gui',
          name: 'GUI_Operate',
          type: 'stdio',
          command: 'node',
          args: ['/tmp/gui.js'],
          env: {},
          enabled: true,
        },
      ] as any,
      runtimeEnv: {
        OPENAI_API_KEY: 'token-123',
        OPENAI_BASE_URL: 'https://chatgpt.com/backend-api/codex',
        OPENAI_MODEL: 'gpt-5.3-codex',
        OPENAI_ACCOUNT_ID: 'account-1',
      },
    });

    expect(overrides).toEqual([
      'mcp_servers.GUI_Operate={command="node",args=["/tmp/gui.js"],env={OPENAI_API_KEY="token-123",OPENAI_BASE_URL="https://chatgpt.com/backend-api/codex",OPENAI_MODEL="gpt-5.3-codex",OPENAI_ACCOUNT_ID="account-1"}}',
    ]);
  });

  it('does not override explicit per-server auth env values', () => {
    const overrides = buildCodexMcpOverrides({
      servers: [
        {
          id: 'gui',
          name: 'GUI_Operate',
          type: 'stdio',
          command: 'node',
          args: ['/tmp/gui.js'],
          env: {
            OPENAI_API_KEY: 'custom-key',
            WORKSPACE_DIR: '',
          },
          enabled: true,
        },
      ] as any,
      runtimeEnv: {
        OPENAI_API_KEY: 'runtime-key',
        OPENAI_BASE_URL: 'https://chatgpt.com/backend-api/codex',
      },
    });

    expect(overrides).toEqual([
      'mcp_servers.GUI_Operate={command="node",args=["/tmp/gui.js"],env={OPENAI_API_KEY="custom-key",WORKSPACE_DIR="",OPENAI_BASE_URL="https://chatgpt.com/backend-api/codex"}}',
    ]);
  });
});
