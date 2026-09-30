import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import type { ScheduledTask } from './scheduled-task-manager';
import { normalizeLocalWatchConfig } from '../../shared/schedule/local-watch-task';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;

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
        let failure: Error | undefined;
        const stop = (error: Error) => {
          if (failure) return;
          failure = error;
          if (process.platform === 'win32') {
            execFile(
              'taskkill',
              ['/F', '/T', '/PID', String(child.pid)],
              { windowsHide: true },
              (killError) => {
                if (killError) reject(killError);
              }
            );
          } else {
            try {
              process.kill(-child.pid!, 'SIGKILL');
            } catch (killError) {
              if ((killError as NodeJS.ErrnoException).code !== 'ESRCH') reject(killError);
            }
          }
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
          if (failure) reject(failure);
          else if (code !== 0)
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
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('Watch path must refer to a regular file.');
    if (info.size > MAX_FILE_BYTES) throw new Error('Watch file exceeds 10 MiB.');
    const content = await readFile(filePath);
    if (content.length > MAX_FILE_BYTES) throw new Error('Watch file exceeds 10 MiB.');
    return `file:${hash.update(content).digest('hex')}`;
  } catch (error) {
    // Absence is observable state, so creation and deletion both trigger a change.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'file:missing';
    throw error;
  }
}
