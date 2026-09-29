import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess, SpawnOptions } from 'child_process';
import {
  createLocalBashOperations,
  createReadTool,
  createWriteTool,
} from '@mariozechner/pi-coding-agent';
import {
  buildLimaGuestShellScript,
  createLimaSandboxBashOperations,
  createLimaSandboxCodingTools,
  createLimaSandboxFileOperations,
  mapVirtualWorkspacePath,
  rewriteVirtualWorkspaceCommand,
  shellEscapePath,
} from '../../main/agent/lima-sandbox-operations';

const SANDBOX = '/home/lima/.claude/sandbox/session-1';

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = {
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  };
  kill = vi.fn();

  constructor(readonly pid?: number) {
    super();
  }
}

function createSpawnMock(children: FakeChildProcess[]) {
  return vi.fn((command: string, args: string[], _options: SpawnOptions) => {
    const child = children.shift();
    if (!child) throw new Error(`Unexpected spawn: ${command} ${args.join(' ')}`);
    return Object.assign(child, {
      spawnargs: [command, ...args],
      spawnfile: command,
    }) as unknown as ChildProcess;
  });
}

function scriptFrom(spawnProcess: ReturnType<typeof createSpawnMock>, call = 0): string {
  const args = spawnProcess.mock.calls[call][1];
  return String(args[args.length - 1]);
}

describe('lima sandbox paths', () => {
  it('maps the virtual workspace onto the guest directory', () => {
    expect(mapVirtualWorkspacePath('/workspace', SANDBOX)).toBe(SANDBOX);
    expect(mapVirtualWorkspacePath('/workspace/notes.txt', SANDBOX)).toBe(`${SANDBOX}/notes.txt`);
    expect(mapVirtualWorkspacePath(`${SANDBOX}/notes.txt`, SANDBOX)).toBe(`${SANDBOX}/notes.txt`);
  });

  it('rejects a virtual path that climbs out of the sandbox', () => {
    expect(() => mapVirtualWorkspacePath('/workspace/../../etc/passwd', SANDBOX)).toThrow(
      'Path escapes sandbox workspace'
    );
  });

  it('rewrites workspace tokens without touching lookalike paths', () => {
    const command = `ls /workspace && cat '/workspace/a.txt' /workspace-other /mnt/workspace`;
    expect(rewriteVirtualWorkspaceCommand(command, SANDBOX)).toBe(
      `ls ${SANDBOX} && cat '${SANDBOX}/a.txt' /workspace-other /mnt/workspace`
    );
  });

  it('escapes single quotes in the guest working directory', () => {
    const script = buildLimaGuestShellScript(`/tmp/a'b`, 'pwd', `/tmp/a'b`);
    expect(script).toContain(`mkdir -p -- '${shellEscapePath(`/tmp/a'b`)}'`);
    expect(script).toContain(`cd -- '${shellEscapePath(`/tmp/a'b`)}'`);
    expect(script.endsWith('pwd')).toBe(true);
  });
});

describe('lima sandbox bash', () => {
  it('rejects the missing guest path when bash runs on the host', async () => {
    expect(existsSync(SANDBOX)).toBe(false);
    const local = createLocalBashOperations();
    await expect(local.exec('ls', SANDBOX, { onData: vi.fn() })).rejects.toThrow(
      `Working directory does not exist: ${SANDBOX}`
    );
  });

  it('creates the guest directory and runs the command inside Lima', async () => {
    const child = new FakeChildProcess(42);
    const spawnProcess = createSpawnMock([child]);
    const ops = createLimaSandboxBashOperations(SANDBOX, { spawnProcess });
    const onData = vi.fn();

    const pending = ops.exec('ls /workspace', SANDBOX, { onData, env: { PATH: '/usr/bin' } });
    const output = Buffer.from('notes.txt\n');
    child.stdout.emit('data', output);
    child.emit('close', 0);

    await expect(pending).resolves.toEqual({ exitCode: 0 });
    expect(onData).toHaveBeenCalledWith(output);
    expect(spawnProcess).toHaveBeenCalledWith(
      'limactl',
      ['shell', 'claude-sandbox', '--', 'bash', '-c', expect.any(String)],
      expect.objectContaining({
        env: { PATH: '/usr/bin' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );
    expect(spawnProcess.mock.calls[0][2]).not.toHaveProperty('cwd');
    const script = scriptFrom(spawnProcess);
    expect(script).toContain(`mkdir -p -- '${SANDBOX}'`);
    expect(script).toContain(`cd -- '${SANDBOX}'`);
    expect(script).toContain(`ls ${SANDBOX}`);
    expect(script).not.toContain('ls /workspace');
  });

  it('kills the Lima shell when the command times out', async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChildProcess(77);
      const spawnProcess = createSpawnMock([child]);
      const ops = createLimaSandboxBashOperations(SANDBOX, { spawnProcess });
      const pending = ops.exec('sleep 30', SANDBOX, { onData: vi.fn(), timeout: 1 });
      const result = pending.then(
        () => undefined,
        (error: Error) => error
      );

      await vi.advanceTimersByTimeAsync(1000);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      child.emit('close', null);

      await expect(result).resolves.toMatchObject({ message: 'timeout:1' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops before spawning when the caller has already aborted', async () => {
    const spawnProcess = createSpawnMock([]);
    const ops = createLimaSandboxBashOperations(SANDBOX, { spawnProcess });
    const signal = AbortSignal.abort();

    await expect(ops.exec('pwd', SANDBOX, { onData: vi.fn(), signal })).rejects.toThrow('aborted');
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});

describe('lima sandbox coding tools', () => {
  it('exposes read, bash, edit, and write for the guest sandbox', () => {
    const tools = createLimaSandboxCodingTools(SANDBOX, {
      spawnProcess: createSpawnMock([]),
    });
    expect(tools.map((tool) => tool.name)).toEqual(['read', 'bash', 'edit', 'write']);
  });
});

describe('lima sandbox file tools', () => {
  it('reads a virtual workspace file from the guest sandbox', async () => {
    const access = new FakeChildProcess();
    const read = new FakeChildProcess();
    const spawnProcess = createSpawnMock([access, read]);
    const files = createLimaSandboxFileOperations(SANDBOX, { spawnProcess });
    const readTool = createReadTool(SANDBOX, { operations: files.read });

    const pending = readTool.execute('call-1', { path: '/workspace/notes.txt' });
    access.emit('close', 0);
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
    read.stdout.emit('data', Buffer.from('hello from sandbox'));
    read.emit('close', 0);

    const result = await pending;
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('hello from sandbox'),
      }),
    ]);
    expect(scriptFrom(spawnProcess, 0)).toBe(`test -e '${SANDBOX}/notes.txt'`);
    expect(scriptFrom(spawnProcess, 1)).toBe(`cat -- '${SANDBOX}/notes.txt'`);
  });

  it('writes a virtual workspace file through the guest shell', async () => {
    const mkdir = new FakeChildProcess();
    const write = new FakeChildProcess();
    const spawnProcess = createSpawnMock([mkdir, write]);
    const files = createLimaSandboxFileOperations(SANDBOX, { spawnProcess });
    const writeTool = createWriteTool(SANDBOX, { operations: files.write });

    const pending = writeTool.execute('call-2', {
      path: '/workspace/out.txt',
      content: 'abc',
    });
    mkdir.emit('close', 0);
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
    write.emit('close', 0);

    await expect(pending).resolves.toMatchObject({
      content: [expect.objectContaining({ type: 'text' })],
    });
    expect(scriptFrom(spawnProcess, 0)).toBe(`mkdir -p -- '${SANDBOX}'`);
    expect(scriptFrom(spawnProcess, 1)).toBe(`cat > '${SANDBOX}/out.txt'`);
    expect(write.stdin.write).toHaveBeenCalledWith(Buffer.from('abc'));
  });

  it('checks read and write permission before editing', async () => {
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    const files = createLimaSandboxFileOperations(SANDBOX, { spawnProcess });

    const pending = files.edit.access(`${SANDBOX}/notes.txt`);
    child.stderr.emit('data', Buffer.from('denied'));
    child.emit('close', 1);

    await expect(pending).rejects.toThrow('denied');
    expect(scriptFrom(spawnProcess)).toBe(
      `test -r '${SANDBOX}/notes.txt' && test -w '${SANDBOX}/notes.txt'`
    );
  });
});
