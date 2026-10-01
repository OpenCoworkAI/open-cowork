import { describe, expect, it, vi } from 'vitest';
import {
  createLimaSandboxCodingTools,
  type LimaSandboxOperationsOptions,
} from '../../main/agent/lima-sandbox-operations';
import {
  createBashTool,
  type ExtensionContext,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent';
import type { PathResolver } from '../../main/sandbox/path-resolver';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { rm } from 'fs/promises';

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: vi.fn(),
  getModel: vi.fn(() => undefined),
}));

vi.mock('../../main/agent/shared-auth', () => ({
  getSharedAuthStorage: () => ({ setRuntimeApiKey: vi.fn() }),
  ModelRegistry: vi.fn(),
}));

import { CoworkAgentRunner } from '../../main/agent/agent-runner';

describe('Lima sudo routing', () => {
  it('forwards overflow output updates through the real default-timeout wrapper', async () => {
    const child = new EventEmitter();
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const spawnProcess = vi.fn<NonNullable<LimaSandboxOperationsOptions['spawnProcess']>>(
      () => Object.assign(child, { stdout, stderr, kill: vi.fn() }) as unknown as ChildProcess
    );
    const tools = createLimaSandboxCodingTools('/home/lima/workspace', { spawnProcess });
    const runner = CoworkAgentRunner as unknown as {
      wrapBashToolWithDefaultTimeout: (tools: ToolDefinition[]) => ToolDefinition[];
    };
    const wrapped = runner.wrapBashToolWithDefaultTimeout(tools as ToolDefinition[]);
    const bash = wrapped.find((tool) => tool.name === 'bash')!;
    const onUpdate = vi.fn();
    const pending = bash.execute(
      'wrapped-output',
      { command: 'generate-output' },
      undefined,
      onUpdate,
      {} as ExtensionContext
    );
    stdout.emit('data', Buffer.from('wrapped-output\n'.repeat(12000)));
    child.emit('close', 0);
    const result = await pending;
    const outputPath = (result.details as { fullOutputPath: string }).fullOutputPath;
    try {
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ fullOutputPath: outputPath }),
        })
      );
      await expect(
        tools[0].execute('read-wrapped-output', { path: outputPath, limit: 1 })
      ).resolves.toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('wrapped-output') }],
      });
      expect(spawnProcess).toHaveBeenCalledTimes(1);
    } finally {
      await rm(outputPath, { force: true });
    }
  });

  it('runs sudo through the guest backend without asking for a host password', async () => {
    const requestSudoPassword = vi.fn();
    const runner = new CoworkAgentRunner(
      { sendToRenderer: vi.fn(), requestSudoPassword },
      {} as PathResolver
    ) as unknown as {
      wrapBashToolForSudo: (
        tools: ToolDefinition[],
        sessionId: string,
        cwd: string,
        useLimaSandbox: boolean
      ) => ToolDefinition[];
    };
    const child = new EventEmitter();
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const spawnProcess = vi.fn<NonNullable<LimaSandboxOperationsOptions['spawnProcess']>>(
      () => Object.assign(child, { stdout, stderr, kill: vi.fn() }) as unknown as ChildProcess
    );
    const options: LimaSandboxOperationsOptions = { spawnProcess };
    const tools = createLimaSandboxCodingTools('/home/lima/workspace', options);
    const wrapped = runner.wrapBashToolForSudo(
      tools as ToolDefinition[],
      'session-1',
      '/home/lima/workspace',
      true
    );
    const bash = wrapped.find((tool) => tool.name === 'bash')!;
    const pending = bash.execute(
      'sudo-call',
      { command: 'sudo -n true' },
      undefined,
      undefined,
      {} as ExtensionContext
    );
    stdout.emit('data', Buffer.from('guest command'));
    child.emit('close', 0);

    await expect(pending).resolves.toMatchObject({
      content: [{ type: 'text', text: 'guest command' }],
    });
    expect(wrapped).toBe(tools);
    expect(requestSudoPassword).not.toHaveBeenCalled();
    expect(spawnProcess.mock.calls[0][0]).toBe('limactl');
  });

  it('preserves the host password prompt outside Lima sessions', async () => {
    const requestSudoPassword = vi.fn().mockResolvedValue(null);
    const runner = new CoworkAgentRunner(
      { sendToRenderer: vi.fn(), requestSudoPassword },
      {} as PathResolver
    ) as unknown as {
      wrapBashToolForSudo: (
        tools: ToolDefinition[],
        sessionId: string,
        cwd: string,
        useLimaSandbox: boolean
      ) => ToolDefinition[];
    };
    const tools = [createBashTool('/tmp')];
    const wrapped = runner.wrapBashToolForSudo(
      tools as ToolDefinition[],
      'host-session',
      '/tmp',
      false
    );
    const bash = wrapped.find((tool) => tool.name === 'bash')!;
    await expect(
      bash.execute(
        'host-sudo',
        { command: 'sudo true' },
        undefined,
        undefined,
        {} as ExtensionContext
      )
    ).resolves.toMatchObject({
      content: [{ type: 'text', text: expect.stringContaining('user denied sudo password') }],
    });
    expect(requestSudoPassword).toHaveBeenCalledWith('host-session', 'host-sudo', 'sudo true');
  });
});
