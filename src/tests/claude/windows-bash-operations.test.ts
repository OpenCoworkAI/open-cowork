import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess, SpawnOptions } from 'child_process';
import {
  buildWindowsShellInvocation,
  createWindowsBashOperations,
} from '../../main/claude/windows-bash-operations';

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

describe('windows bash operations', () => {
  it('uses platform-correct shell arguments for common Windows shells', () => {
    expect(buildWindowsShellInvocation('dir', 'C:\\Windows\\System32\\cmd.exe')).toEqual({
      shell: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'dir'],
    });

    expect(buildWindowsShellInvocation('Write-Output hi', 'pwsh.exe')).toEqual({
      shell: 'pwsh.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Write-Output hi',
      ],
    });

    expect(buildWindowsShellInvocation('echo hi', 'C:\\Program Files\\Git\\bin\\bash.exe')).toEqual(
      {
        shell: 'C:\\Program Files\\Git\\bin\\bash.exe',
        args: ['-c', 'echo hi'],
      }
    );
  });

  it('spawns Windows shell commands without detaching the child process', async () => {
    const child = new FakeChildProcess(1234);
    const spawnProcess = createSpawnMock([child]);
    const onData = vi.fn();
    const ops = createWindowsBashOperations({
      spawnProcess,
      shellResolver: () => 'C:\\Windows\\System32\\cmd.exe',
    });

    const promise = ops.exec('echo hello', process.cwd(), {
      onData,
      env: { PATH: 'test-path' },
    });
    const output = Buffer.from('hello');
    child.stdout.emit('data', output);
    child.emit('close', 0);

    await expect(promise).resolves.toEqual({ exitCode: 0 });
    expect(onData).toHaveBeenCalledWith(output);
    expect(spawnProcess).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', 'echo hello'],
      expect.objectContaining({
        cwd: process.cwd(),
        detached: false,
        env: { PATH: 'test-path' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    );
  });

  it('kills the Windows process tree and rejects when a command times out', async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChildProcess(4321);
      const taskkill = new FakeChildProcess(9876);
      const spawnProcess = createSpawnMock([child, taskkill]);
      const ops = createWindowsBashOperations({
        spawnProcess,
        shellResolver: () => 'cmd.exe',
        taskkillWaitMs: 10,
        terminationGraceMs: 10,
      });

      const promise = ops.exec('node server.js', process.cwd(), {
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

  it('does not spawn a process when the working directory is missing', async () => {
    const missingCwd = path.join(os.tmpdir(), `open-cowork-missing-${Date.now()}`);
    const spawnProcess = createSpawnMock([]);
    const ops = createWindowsBashOperations({ spawnProcess });

    await expect(
      ops.exec('echo nope', missingCwd, {
        onData: vi.fn(),
      })
    ).rejects.toThrow('Working directory does not exist');
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
