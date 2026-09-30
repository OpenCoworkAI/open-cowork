import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess, SpawnOptions } from 'child_process';
import { createWslSandboxBashOperations } from '../../main/agent/wsl-sandbox-bash-operations';

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
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
      killed: false,
      connected: false,
      exitCode: null,
      signalCode: null,
    }) as unknown as ChildProcess;
  });
}

describe('wsl sandbox bash operations', () => {
  it('routes execution through wsl.exe for the configured distro, cd-ing into the sandbox path', async () => {
    const child = new FakeChildProcess(1234);
    const spawnProcess = createSpawnMock([child]);
    const onData = vi.fn();
    const ops = createWslSandboxBashOperations('Ubuntu', { spawnProcess });

    const promise = ops.exec('echo hello', '/home/user/.claude/sandbox/session-1', {
      onData,
      env: { PATH: 'test-path' },
    });
    const output = Buffer.from('hello');
    child.stdout.emit('data', output);
    child.emit('close', 0);

    await expect(promise).resolves.toEqual({ exitCode: 0 });
    expect(onData).toHaveBeenCalledWith(output);
    expect(spawnProcess).toHaveBeenCalledWith(
      'wsl',
      [
        '-d',
        'Ubuntu',
        '-e',
        'bash',
        '-c',
        "mkdir -p '/home/user/.claude/sandbox/session-1' 2>/dev/null; cd '/home/user/.claude/sandbox/session-1' || { echo \"Working directory does not exist in WSL sandbox: /home/user/.claude/sandbox/session-1\" >&2; exit 1; }; echo hello",
      ],
      expect.objectContaining({
        detached: false,
        env: { PATH: 'test-path' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    );
    // Critically: no Windows-side `cwd` option pointing at a path that only
    // exists inside WSL â€” the cwd is applied via `cd` inside the script instead.
    expect(spawnProcess.mock.calls[0][2]).not.toHaveProperty('cwd');
  });

  it('safely escapes single quotes in the sandbox path', async () => {
    const child = new FakeChildProcess(1234);
    const spawnProcess = createSpawnMock([child]);
    const ops = createWslSandboxBashOperations('Ubuntu', { spawnProcess });

    const promise = ops.exec('ls', "/home/o'brien/.claude/sandbox/session-1", {
      onData: vi.fn(),
    });
    child.emit('close', 0);
    await promise;

    const script = spawnProcess.mock.calls[0][1][5] as string;
    expect(script).toContain("mkdir -p '/home/o'\\''brien/.claude/sandbox/session-1'");
    expect(script).toContain("cd '/home/o'\\''brien/.claude/sandbox/session-1'");
  });

  it('kills the wsl.exe process tree and rejects when a command times out', async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChildProcess(4321);
      const taskkill = new FakeChildProcess(9876);
      const spawnProcess = createSpawnMock([child, taskkill]);
      const ops = createWslSandboxBashOperations('Ubuntu', {
        spawnProcess,
        taskkillWaitMs: 10,
        terminationGraceMs: 10,
      });

      const promise = ops.exec('sleep 100', '/home/user/.claude/sandbox/session-1', {
        onData: vi.fn(),
        timeout: 1,
      });
      const result = promise.then(
        () => undefined,
        (error: Error) => error
      );

      await vi.advanceTimersByTimeAsync(1000);

      expect(spawnProcess).toHaveBeenNthCalledWith(
        2,
        'taskkill',
        ['/F', '/T', '/PID', '4321'],
        expect.objectContaining({
          detached: false,
          stdio: 'ignore',
          windowsHide: true,
        })
      );

      taskkill.emit('close', 0);
      child.emit('close', null);

      await expect(result).resolves.toMatchObject({ message: 'timeout:1' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects synchronously without spawning when the distro name is invalid', () => {
    const spawnProcess = createSpawnMock([]);

    expect(() => createWslSandboxBashOperations('Ubuntu; rm -rf /', { spawnProcess })).toThrow(
      'Invalid WSL distro name'
    );
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('rejects immediately without spawning when the signal is already aborted', async () => {
    const spawnProcess = createSpawnMock([]);
    const ops = createWslSandboxBashOperations('Ubuntu', { spawnProcess });
    const controller = new AbortController();
    controller.abort();

    await expect(
      ops.exec('echo nope', '/home/user/.claude/sandbox/session-1', {
        onData: vi.fn(),
        signal: controller.signal,
      })
    ).rejects.toThrow('aborted');
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
