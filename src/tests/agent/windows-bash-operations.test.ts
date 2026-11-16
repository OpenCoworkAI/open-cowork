import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess, SpawnOptions } from 'child_process';
import {
  buildWindowsShellInvocation,
  createWindowsBashOperations,
} from '../../main/agent/windows-bash-operations';
import { getWindowsConsoleCodePage } from '../../main/utils/windows-output-encoding';

vi.mock('../../main/utils/windows-output-encoding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../main/utils/windows-output-encoding')>();
  return { ...actual, getWindowsConsoleCodePage: vi.fn() };
});

beforeEach(() => {
  vi.mocked(getWindowsConsoleCodePage).mockResolvedValue(936);
});

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
    // Wait for the asynchronous code-page lookup before emitting output.
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalled());
    // The code page is explicit; the test does not depend on the host locale.
    const output = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
    child.stdout.emit('data', output);
    child.emit('close', 0);

    await expect(promise).resolves.toEqual({ exitCode: 0 });
    expect(onData).toHaveBeenCalledWith(Buffer.from('你好', 'utf-8'));
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

      // Wait until the async exec body reaches its spawn point (and thus the
      // timeout timer is registered) before advancing the fake clock.
      await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalled());
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

  it('does not spawn when cancelled while the code page is being detected', async () => {
    let finishDetection!: (value: number) => void;
    vi.mocked(getWindowsConsoleCodePage).mockReturnValueOnce(
      new Promise((resolve) => {
        finishDetection = resolve;
      })
    );
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    // Let the old implementation settle too, so the regression fails on the
    // forbidden spawn rather than hanging until the test timeout.
    spawnProcess.mockImplementation(() => {
      setImmediate(() => child.emit('close', 0));
      return child as unknown as ChildProcess;
    });
    const controller = new AbortController();
    const pending = createWindowsBashOperations({
      spawnProcess,
      shellResolver: () => 'cmd.exe',
    }).exec('echo should-not-run', process.cwd(), {
      onData: vi.fn(),
      signal: controller.signal,
    });

    controller.abort();
    finishDetection(936);

    await expect(pending).rejects.toThrow('aborted');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('flushes both output streams on close without sending empty data events', async () => {
    vi.mocked(getWindowsConsoleCodePage).mockResolvedValue(1252);
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    const onData = vi.fn<(chunk: Buffer) => void>();
    const pending = createWindowsBashOperations({
      spawnProcess,
      shellResolver: () => 'cmd.exe',
    }).exec('print-output', process.cwd(), { onData });
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalled());

    child.stdout.emit('data', Buffer.from([0xe9]));
    child.stderr.emit('data', Buffer.from([0xc4]));
    expect(onData).not.toHaveBeenCalled();
    child.emit('close', 0);

    await expect(pending).resolves.toEqual({ exitCode: 0 });
    expect(onData.mock.calls.map(([chunk]: [Buffer]) => chunk.toString('utf-8'))).toEqual([
      'é',
      'Ä',
    ]);
  });

  it('does not start a command after detection consumes its timeout', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(getWindowsConsoleCodePage).mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 1000);
        return 936;
      });
      const spawnProcess = createSpawnMock([]);
      const pending = createWindowsBashOperations({
        spawnProcess,
        shellResolver: () => 'cmd.exe',
      }).exec('echo should-not-run', process.cwd(), { onData: vi.fn(), timeout: 1 });
      await expect(pending).rejects.toThrow('timeout:1');
      expect(spawnProcess).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
