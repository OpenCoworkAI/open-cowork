import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import type { ScheduledTask } from './scheduled-task-manager';
import { normalizeLocalWatchConfig } from '../../shared/schedule/local-watch-task';
import { logError } from '../utils/logger';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;

function stopWindowsCommand(
  child: ChildProcess,
  error: Error,
  reject: (reason: Error) => void
): void {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(grace);
    reject(error);
  };
  // cmd.exe can exit when its pipes close and leave node.exe holding the task directory.
  const grace = setTimeout(finish, 1500);
  grace.unref?.();
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
    finish();
    return;
  }
  child.once('close', finish);
  execFile(
    'taskkill',
    ['/F', '/T', '/PID', String(child.pid)],
    { windowsHide: true },
    (killError) => {
      if (killError) logError('[LocalWatch] Failed to stop command:', killError);
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
  );
}

export async function checkLocalCondition(task: ScheduledTask): Promise<string> {
  const config = normalizeLocalWatchConfig(task.watchConfig);
  const hash = createHash('sha512');
  if (config.checkType === 'command') {
    const { stdout, stderr } = await new Promise<{ stdout: Buffer; stderr: Buffer }>(
      (resolve, reject) => {
        const child = spawn(config.checkConfig.command, {
          cwd: task.cwd,
          shell: true,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let outputBytes = 0;
        let stopped = false;
        const stop = (error: Error) => {
          if (stopped) return;
          stopped = true;
          clearTimeout(timer);
          if (process.platform === 'win32') {
            stopWindowsCommand(child, error, reject);
            return;
          }
          child.stdout.destroy();
          child.stderr.destroy();
          reject(error);
          if (!child.pid) return;
          // Snapshot descendants before killing the shell, including separate process groups.
          execFile('ps', ['-A', '-o', 'pid=,ppid='], { timeout: 1000 }, (psError, output) => {
            const descendants = new Set<number>([child.pid!]);
            if (psError) logError('[LocalWatch] Failed to enumerate command descendants:', psError);
            else {
              const processes = output
                .trim()
                .split('\n')
                .map((line) => line.trim().split(/\s+/).map(Number));
              let changed = true;
              while (changed) {
                changed = false;
                for (const [pid, ppid] of processes) {
                  if (descendants.has(ppid) && !descendants.has(pid)) {
                    descendants.add(pid);
                    changed = true;
                  }
                }
              }
            }
            for (const pid of [-child.pid!, ...Array.from(descendants).reverse()]) {
              try {
                process.kill(pid, 'SIGKILL');
              } catch (killError) {
                if ((killError as NodeJS.ErrnoException).code !== 'ESRCH')
                  logError('[LocalWatch] Failed to stop command process:', killError);
              }
            }
          });
        };
        const timer = setTimeout(
          () =>
            stop(new Error(`Watch command timed out after ${config.checkConfig.timeoutMs} ms.`)),
          config.checkConfig.timeoutMs
        );
        const collect = (chunk: Buffer, chunks: Buffer[]) => {
          outputBytes += chunk.length;
          if (outputBytes > MAX_OUTPUT_BYTES)
            stop(new Error('Watch command output exceeds 1 MiB.'));
          else chunks.push(chunk);
        };
        child.stdout.on('data', (chunk: Buffer) => collect(chunk, stdoutChunks));
        child.stderr.on('data', (chunk: Buffer) => collect(chunk, stderrChunks));
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('close', (code) => {
          clearTimeout(timer);
          if (stopped) return;
          if (code !== 0)
            reject(
              new Error(
                `Watch command exited with code ${code}: ${Buffer.concat(stderrChunks).toString('utf8').trim()}`
              )
            );
          else
            resolve({ stdout: Buffer.concat(stdoutChunks), stderr: Buffer.concat(stderrChunks) });
        });
      }
    );
    // Prefix stdout's byte length to distinguish binary stdout/stderr boundaries.
    hash.update(`${stdout.length}:`).update(stdout).update(stderr);
    return `output:${hash.digest('hex')}`;
  }
  const filePath = resolve(task.cwd, config.checkConfig.path);
  try {
    const file = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (!info.isFile()) throw new Error('Watch path must refer to a regular file.');
      if (info.size > MAX_FILE_BYTES) throw new Error('Watch file exceeds 10 MiB.');
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const { bytesRead } = await file.read(buffer, bytes, buffer.length - bytes, null);
        if (bytesRead === 0) break;
        bytes += bytesRead;
      }
      if (bytes > MAX_FILE_BYTES) throw new Error('Watch file exceeds 10 MiB.');
      return `file:${hash.update(buffer.subarray(0, bytes)).digest('hex')}`;
    } finally {
      await file.close();
    }
  } catch (error) {
    // Absence is observable state, so creation and deletion both trigger a change.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'file:missing';
    throw error;
  }
}
