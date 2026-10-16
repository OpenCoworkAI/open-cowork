import { existsSync } from 'fs';
import path from 'path';
import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import {
  SettingsManager as PiSettingsManager,
  type BashOperations,
} from '@mariozechner/pi-coding-agent';
import { getDefaultShell } from '../utils/shell-resolver';
import {
  createWindowsOutputNormalizer,
  getWindowsConsoleCodePage,
  type OutputNormalizer,
} from '../utils/windows-output-encoding';

const DEFAULT_TERMINATION_GRACE_MS = 5000;
const DEFAULT_TASKKILL_WAIT_MS = 3000;

type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface WindowsShellInvocation {
  shell: string;
  args: string[];
}

export interface WindowsBashOperationsOptions {
  spawnProcess?: SpawnProcess;
  shellResolver?: (cwd: string) => string;
  terminationGraceMs?: number;
  taskkillWaitMs?: number;
}

function normalizeShellPath(shellPath: string): string {
  const trimmed = shellPath.trim();
  const quoted = trimmed.match(/^"(.+)"$/);
  return quoted ? quoted[1] : trimmed;
}

function defaultShellResolver(cwd: string): string {
  try {
    const configuredShell = PiSettingsManager.create(cwd).getShellPath();
    return configuredShell ? normalizeShellPath(configuredShell) : getDefaultShell();
  } catch {
    return getDefaultShell();
  }
}

export function buildWindowsShellInvocation(
  command: string,
  shellPath = getDefaultShell()
): WindowsShellInvocation {
  const shell = normalizeShellPath(shellPath);
  const shellName = path.win32.basename(shell).toLowerCase();

  if (shellName === 'cmd' || shellName === 'cmd.exe') {
    return { shell, args: ['/d', '/s', '/c', command] };
  }

  if (
    shellName === 'powershell' ||
    shellName === 'powershell.exe' ||
    shellName === 'pwsh' ||
    shellName === 'pwsh.exe'
  ) {
    return {
      shell,
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        command,
      ],
    };
  }

  return { shell, args: ['-c', command] };
}

function createSpawnProcess(): SpawnProcess {
  return (command, args, options) => spawn(command, args, options);
}

async function waitForProcessClose(child: ChildProcess, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      child.off('close', finish);
      child.off('error', finish);
      resolve();
    };

    child.once('close', finish);
    child.once('error', finish);
    const timeoutHandle = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore cleanup failures; the caller is already terminating a process tree.
      }
      finish();
    }, timeoutMs);
    timeoutHandle.unref?.();
  });
}

async function killWindowsProcessTree(
  pid: number,
  spawnProcess: SpawnProcess,
  taskkillWaitMs: number
): Promise<void> {
  try {
    const taskkill = spawnProcess('taskkill', ['/F', '/T', '/PID', String(pid)], {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitForProcessClose(taskkill, taskkillWaitMs);
  } catch {
    try {
      process.kill(pid);
    } catch {
      // Process may already be gone.
    }
  }
}

export function createWindowsBashOperations(
  options: WindowsBashOperationsOptions = {}
): BashOperations {
  const spawnProcess = options.spawnProcess ?? createSpawnProcess();
  const shellResolver = options.shellResolver ?? defaultShellResolver;
  const terminationGraceMs = options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  const taskkillWaitMs = options.taskkillWaitMs ?? DEFAULT_TASKKILL_WAIT_MS;

  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      if (!existsSync(cwd)) {
        throw new Error(
          `Working directory does not exist: ${cwd}\nCannot execute bash commands.`
        );
      }

      if (signal?.aborted) {
        throw new Error('aborted');
      }

      const { shell, args } = buildWindowsShellInvocation(command, shellResolver(cwd));
      const codePage = await getWindowsConsoleCodePage();
      const normalizeStdout: OutputNormalizer | null = createWindowsOutputNormalizer(codePage);
      const normalizeStderr: OutputNormalizer | null = createWindowsOutputNormalizer(codePage);

      return new Promise((resolve, reject) => {
        const child = spawnProcess(shell, args, {
          cwd,
          detached: false,
          env: env ?? process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });

        let settled = false;
        let timedOut = false;
        let timeoutHandle: NodeJS.Timeout | undefined;
        let forcedSettleHandle: NodeJS.Timeout | undefined;

        const cleanup = () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (forcedSettleHandle) clearTimeout(forcedSettleHandle);
          child.stdout?.off('data', onStdoutChunk);
          child.stderr?.off('data', onStderrChunk);
          child.off('close', onClose);
          child.off('error', onError);
          signal?.removeEventListener('abort', onAbort);
        };

        const settleResolve = (value: { exitCode: number | null }) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        };

        const settleReject = (error: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };

        const terminateChild = (reason: 'aborted' | 'timeout') => {
          if (child.pid) {
            void killWindowsProcessTree(child.pid, spawnProcess, taskkillWaitMs);
          } else {
            try {
              child.kill();
            } catch {
              // Ignore cleanup failures; the close/error path will settle or the grace timer will.
            }
          }

          forcedSettleHandle = setTimeout(() => {
            settleReject(
              reason === 'timeout' ? new Error(`timeout:${timeout}`) : new Error('aborted')
            );
          }, terminationGraceMs);
          forcedSettleHandle.unref?.();
        };

        function onClose(code: number | null) {
          if (signal?.aborted) {
            settleReject(new Error('aborted'));
            return;
          }
          if (timedOut) {
            settleReject(new Error(`timeout:${timeout}`));
            return;
          }
          settleResolve({ exitCode: code });
        }

        function onError(error: Error) {
          settleReject(error);
        }

        function onAbort() {
          terminateChild('aborted');
        }

        const onStdoutChunk = (chunk: Buffer) => {
          onData(normalizeStdout ? normalizeStdout(chunk) : chunk);
        };
        const onStderrChunk = (chunk: Buffer) => {
          onData(normalizeStderr ? normalizeStderr(chunk) : chunk);
        };
        child.stdout?.on('data', onStdoutChunk);
        child.stderr?.on('data', onStderrChunk);
        child.once('close', onClose);
        child.once('error', onError);

        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            terminateChild('timeout');
          }, timeout * 1000);
          timeoutHandle.unref?.();
        }

        signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
}
