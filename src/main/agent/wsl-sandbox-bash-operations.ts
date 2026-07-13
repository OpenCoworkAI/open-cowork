import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import type { BashOperations } from '@mariozechner/pi-coding-agent';
import { log } from '../utils/logger';

const DEFAULT_TERMINATION_GRACE_MS = 5000;
const DEFAULT_TASKKILL_WAIT_MS = 3000;

type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface WslSandboxBashOperationsOptions {
  spawnProcess?: SpawnProcess;
  terminationGraceMs?: number;
  taskkillWaitMs?: number;
}

function shellEscapePath(p: string): string {
  return p.replace(/'/g, "'\\''");
}

function createSpawnProcess(): SpawnProcess {
  return (command, args, options) => spawn(command, args, options);
}

/**
 * Validate a WSL distro name before it reaches a spawned command line.
 * Mirrors WSLBridge.validateDistroName (kept local to avoid a cross-module
 * private dependency - that method is private to the WSLBridge class).
 *
 * In the current call path `distro` always comes from WSLBridge's own
 * detected `wslStatus.distro` (see agent-runner.ts), not from any external
 * or user-supplied input, so this is defense-in-depth rather than a fix for
 * a reachable injection today - but it's cheap insurance against this
 * function being reused from a call site where that stops being true.
 */
function validateDistroName(distro: string): string {
  if (!/^[a-zA-Z0-9\-_.]+$/.test(distro)) {
    throw new Error(`Invalid WSL distro name: ${distro}`);
  }
  return distro;
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

export function createWslSandboxBashOperations(
  distro: string,
  options: WslSandboxBashOperationsOptions = {}
): BashOperations {
  const validatedDistro = validateDistroName(distro);
  const spawnProcess = options.spawnProcess ?? createSpawnProcess();
  const terminationGraceMs = options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  const taskkillWaitMs = options.taskkillWaitMs ?? DEFAULT_TASKKILL_WAIT_MS;

  return {
    exec: (command, cwd, { onData, signal, timeout, env }) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error('aborted'));
          return;
        }

        const escapedCwd = shellEscapePath(cwd);
        // `command` is intentionally NOT escaped here. It is executable bash source
        // provided by the coding agent's bash tool, not untrusted data being embedded
        // into a fixed template - the caller already has full command execution via
        // this exact argument, so there is no lesser-privileged boundary for escaping
        // to protect. Only `cwd` (plain data, not shell syntax) is escaped, via
        // shellEscapePath above, so it can be safely wrapped in single quotes. Applying
        // string-escaping to `command` itself would corrupt any legitimate command that
        // contains its own quoting (e.g. `git commit -m "..."`, `echo 'text'`), breaking
        // normal usage without adding any real protection.
        const script = `mkdir -p '${escapedCwd}' 2>/dev/null; cd '${escapedCwd}' || { echo "Working directory does not exist in WSL sandbox: ${cwd}" >&2; exit 1; }; ${command}`;

        log(`[WslSandboxBash] Executing in distro=${validatedDistro} cwd=${cwd}`);

        const child = spawnProcess('wsl', ['-d', validatedDistro, '-e', 'bash', '-c', script], {
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
          child.stdout?.off('data', onData);
          child.stderr?.off('data', onData);
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

        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
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
      }),
  };
}
