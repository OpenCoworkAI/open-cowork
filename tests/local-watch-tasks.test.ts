import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ScheduledTaskManager,
  type ScheduledTask,
  type ScheduledTaskStore,
} from '../src/main/schedule/scheduled-task-manager';
import { checkLocalCondition } from '../src/main/schedule/local-condition-checker';
import {
  normalizeLocalWatchConfig,
  type LocalWatchConfig,
} from '../src/shared/schedule/local-watch-task';

const fileWatch: LocalWatchConfig = {
  checkType: 'file',
  compareMode: 'content',
  checkConfig: { path: 'watched.txt' },
};
let cwd: string;
let task: ScheduledTask;
let store: ScheduledTaskStore;
let executeTask: ReturnType<typeof vi.fn>;
let manager: ScheduledTaskManager;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'cowork-local-conditions-'));
  task = {
    id: 'watch',
    title: 'watch',
    prompt: 'react to change',
    cwd,
    runAt: Date.now() + 1000,
    nextRunAt: Date.now() + 1000,
    repeatEvery: 1,
    repeatUnit: 'minute',
    scheduleConfig: null,
    enabled: true,
    lastRunAt: null,
    lastRunSessionId: null,
    lastError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    watchConfig: fileWatch,
    lastState: null,
  };
  store = {
    list: () => [task],
    get: (id) => (id === task.id ? task : null),
    create: (input) => {
      task = { ...task, ...input };
      return task;
    },
    update: (id, updates) => {
      if (id !== task.id) return null;
      task = {
        ...task,
        ...Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined)),
      };
      return task;
    },
    delete: () => true,
  };
  executeTask = vi.fn().mockResolvedValue({ sessionId: 'changed-session' });
  manager = new ScheduledTaskManager({ store, executeTask, checkCondition: checkLocalCondition });
});

afterEach(async () => {
  manager.stop();
  vi.useRealTimers();
  await rm(cwd, { recursive: true, maxRetries: 5, retryDelay: 100 });
});

let watchScriptSerial = 0;

async function shellNodeScript(source: string): Promise<string> {
  const scriptPath = join(cwd, `watch-command-${++watchScriptSerial}.cjs`);
  await writeFile(scriptPath, source);
  return `"${process.execPath}" "${scriptPath}"`;
}

describe('local conditional scheduled tasks', () => {
  it('establishes a baseline, skips unchanged content, and starts exactly once per change', async () => {
    await writeFile(join(cwd, 'watched.txt'), 'before');
    expect((await manager.runNow(task.id))?.outcome).toBe('baseline');
    expect(task.lastCheckedAt).toBeTypeOf('number');
    expect(task.lastRunAt).toBeNull();
    expect((await manager.runNow(task.id))?.outcome).toBe('unchanged');
    expect(task.consecutiveUnchanged).toBe(1);
    expect(executeTask).not.toHaveBeenCalled();
    await writeFile(join(cwd, 'watched.txt'), 'after');
    expect((await manager.runNow(task.id))?.outcome).toBe('triggered');
    expect(executeTask).toHaveBeenCalledTimes(1);
    expect(task.lastRunSessionId).toBe('changed-session');
    await manager.runNow(task.id);
    expect(executeTask).toHaveBeenCalledTimes(1);
  });

  it('observes file creation and deletion including empty files', async () => {
    await manager.runNow(task.id);
    expect(task.lastState).toBe('file:missing');
    await writeFile(join(cwd, 'watched.txt'), '');
    await manager.runNow(task.id);
    await rm(join(cwd, 'watched.txt'));
    await manager.runNow(task.id);
    expect(executeTask).toHaveBeenCalledTimes(2);
  });

  it('starts with the persisted observation snapshot without re-reading it', async () => {
    await writeFile(join(cwd, 'watched.txt'), 'before');
    await manager.runNow(task.id);
    const lastState = task.lastState;
    await writeFile(join(cwd, 'watched.txt'), 'after');
    const get = vi.spyOn(store, 'get');
    const update = vi.spyOn(store, 'update');
    executeTask.mockImplementation(async (executionTask: ScheduledTask) => {
      expect(executionTask).toBe(update.mock.results[1].value);
      expect(executionTask.lastState).not.toBe(lastState);
      expect(executionTask.lastCheckedAt).toBeTypeOf('number');
      expect(executionTask.lastError).toBeNull();
      expect(get).toHaveBeenCalledTimes(2);
      return { sessionId: 'changed-session' };
    });
    expect((await manager.runNow(task.id))?.outcome).toBe('triggered');
    expect(executeTask).toHaveBeenCalledOnce();
  });

  it('skips execution when the observation update has no task', async () => {
    await writeFile(join(cwd, 'watched.txt'), 'before');
    await manager.runNow(task.id);
    await writeFile(join(cwd, 'watched.txt'), 'after');
    const update = store.update;
    store.update = (id, updates) => (updates.lastState !== undefined ? null : update(id, updates));
    expect((await manager.runNow(task.id))?.outcome).toBe('skipped');
    expect(executeTask).not.toHaveBeenCalled();
  });

  it('compares command output in the task workspace without a model on unchanged checks', async () => {
    task.watchConfig = {
      checkType: 'command',
      compareMode: 'output',
      checkConfig: {
        command: `"${process.execPath}" -e "process.stdout.write(require('fs').readFileSync('watched.txt'))"`,
      },
    };
    await writeFile(join(cwd, 'watched.txt'), 'one');
    await manager.runNow(task.id);
    await manager.runNow(task.id);
    expect(executeTask).not.toHaveBeenCalled();
    await writeFile(join(cwd, 'watched.txt'), 'two');
    await manager.runNow(task.id);
    expect(executeTask).toHaveBeenCalledTimes(1);
  });

  it('records command failure and preserves the previous baseline', async () => {
    task.watchConfig = {
      checkType: 'command',
      compareMode: 'output',
      checkConfig: { command: `"${process.execPath}" -e "process.exit(2)"` },
    };
    task.lastState = 'previous';
    task.lastCheckedAt = 1;
    await expect(manager.runNow(task.id)).rejects.toThrow();
    expect(task.lastState).toBe('previous');
    expect(task.lastCheckedAt).toBeGreaterThan(1);
    expect(task.lastError).toBeTruthy();
    expect(executeTask).not.toHaveBeenCalled();
  });

  it('distinguishes binary stdout and stderr boundaries', async () => {
    task.watchConfig = {
      checkType: 'command',
      compareMode: 'output',
      checkConfig: {
        command: `"${process.execPath}" -e "process.stdout.write(Buffer.from([97,0,98]));process.stderr.write('c')"`,
      },
    };
    const first = await checkLocalCondition(task);
    task.watchConfig.checkConfig.command = `"${process.execPath}" -e "process.stdout.write('a');process.stderr.write(Buffer.from([98,0,99]))"`;
    expect(await checkLocalCondition(task)).not.toBe(first);
  });

  it('reports a directory path error instead of starting an agent', async () => {
    task.watchConfig = { ...fileWatch, checkConfig: { path: '.' } };
    await expect(manager.runNow(task.id)).rejects.toThrow('regular file');
    expect(executeTask).not.toHaveBeenCalled();
  });

  it('bounds command execution and output', async () => {
    task.watchConfig = {
      checkType: 'command',
      compareMode: 'output',
      checkConfig: {
        command: `"${process.execPath}" -e "setTimeout(() => {}, 10000)"`,
        timeoutMs: 1000,
      },
    };
    await expect(manager.runNow(task.id)).rejects.toThrow();
    task.watchConfig = {
      ...task.watchConfig,
      checkConfig: {
        command: `"${process.execPath}" -e "process.stdout.write('x'.repeat(2 * 1024 * 1024))"`,
        timeoutMs: 1000,
      },
    };
    await expect(manager.runNow(task.id)).rejects.toThrow();
    expect(executeTask).not.toHaveBeenCalled();
  });

  it('stops command descendants on timeout', async () => {
    const marker = join(cwd, 'late-write.txt');
    const command = await shellNodeScript(`
      const { spawn } = require('child_process');
      spawn(process.execPath, ['-e', ${JSON.stringify(`setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 1500)`)}], { stdio: 'inherit' });
      setTimeout(() => {}, 10000);
    `);
    task.watchConfig = {
      checkType: 'command',
      compareMode: 'output',
      checkConfig: {
        command,
        timeoutMs: 1000,
      },
    };
    await expect(manager.runNow(task.id)).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects promptly and stops detached descendants holding output pipes open', async () => {
    const marker = join(cwd, 'detached-write.txt');
    const command = await shellNodeScript(`
      const { spawn } = require('child_process');
      spawn(process.execPath, ['-e', ${JSON.stringify(`setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 2500)`)}], { detached: true, stdio: 'inherit' });
      setTimeout(() => {}, 10000);
    `);
    task.watchConfig = {
      checkType: 'command',
      compareMode: 'output',
      checkConfig: {
        command,
        timeoutMs: 1000,
      },
    };
    const started = Date.now();
    await expect(manager.runNow(task.id)).rejects.toThrow('timed out');
    expect(Date.now() - started).toBeLessThan(2000);
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects oversized files and reads only regular files', async () => {
    await writeFile(join(cwd, 'watched.txt'), Buffer.alloc(10 * 1024 * 1024 + 1));
    await expect(checkLocalCondition(task)).rejects.toThrow('10 MiB');
  });

  it('keeps observations private when receiving public task updates', () => {
    task.lastState = 'saved';
    task.lastCheckedAt = 123;
    manager.update(task.id, {
      title: 'edited',
      lastState: 'forged',
      lastCheckedAt: 999,
      consecutiveUnchanged: 50,
      lastError: 'forged',
      lastRunSessionId: 'forged',
    } as Parameters<typeof manager.update>[1]);
    expect(task.title).toContain('edited');
    expect(task.lastState).toBe('saved');
    expect(task.lastCheckedAt).toBe(123);
    expect(task.lastError).toBeNull();
    expect(task.lastRunSessionId).toBeNull();
  });

  it.each(['edit', 'disable', 'delete'] as const)(
    'discards a stale failed check after %s',
    async (change) => {
      let fail!: (error: Error) => void;
      const onTaskError = vi.fn();
      manager = new ScheduledTaskManager({
        store,
        executeTask,
        onTaskError,
        checkCondition: () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      });
      const checking = manager.runNow(task.id);
      if (change === 'edit') manager.update(task.id, { cwd: '/different' });
      if (change === 'disable') manager.toggle(task.id, false);
      if (change === 'delete') store.get = () => null;
      fail(new Error('old check failed'));
      const result = await checking;
      expect(result?.outcome ?? 'skipped').toBe('skipped');
      expect(task.lastError).toBeNull();
      expect(task.lastCheckedAt == null).toBe(true);
      expect(onTaskError).not.toHaveBeenCalled();
    }
  );

  it('persists a changed observation before an agent failure', async () => {
    await writeFile(join(cwd, 'watched.txt'), 'one');
    await manager.runNow(task.id);
    const oldState = task.lastState;
    executeTask.mockImplementation(async () => {
      expect(task.lastState).not.toBe(oldState);
      throw new Error('model unavailable');
    });
    await writeFile(join(cwd, 'watched.txt'), 'two');
    await expect(manager.runNow(task.id)).rejects.toThrow('model unavailable');
    await manager.runNow(task.id);
    expect(executeTask).toHaveBeenCalledTimes(1);
  });

  it('reports an agent failure even if the condition changes during the run', async () => {
    await writeFile(join(cwd, 'watched.txt'), 'one');
    await manager.runNow(task.id);
    await writeFile(join(cwd, 'watched.txt'), 'two');
    executeTask.mockImplementation(async () => {
      manager.update(task.id, { cwd: '/different' });
      throw new Error('agent failed');
    });
    await expect(manager.runNow(task.id)).rejects.toThrow('agent failed');
  });

  it('retains the baseline across manager restarts', async () => {
    await writeFile(join(cwd, 'watched.txt'), 'one');
    await manager.runNow(task.id);
    manager = new ScheduledTaskManager({ store, executeTask, checkCondition: checkLocalCondition });
    await manager.runNow(task.id);
    expect(executeTask).not.toHaveBeenCalled();
  });

  it('resets observations when the check target or workspace changes', async () => {
    task.lastState = 'previous';
    manager.update(task.id, { watchConfig: { ...fileWatch, checkConfig: { path: 'other.txt' } } });
    expect(task.lastState).toBeNull();
    task.lastState = 'previous';
    manager.update(task.id, { cwd: '/different' });
    expect(task.lastState).toBeNull();
  });

  it('keeps ordinary tasks unconditional and refuses corrupt watch configurations', async () => {
    task.watchConfig = null;
    await manager.runNow(task.id);
    expect(executeTask).toHaveBeenCalledTimes(1);
    task.watchConfigError = 'Invalid persisted watch configuration';
    await expect(manager.runNow(task.id)).rejects.toThrow('Invalid persisted');
    expect(executeTask).toHaveBeenCalledTimes(1);
  });

  it('keeps future timer slots while a condition check is still running', async () => {
    vi.useFakeTimers();
    let finish!: (state: string) => void;
    const checkCondition = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue('baseline');
    manager = new ScheduledTaskManager({ store, executeTask, checkCondition });
    manager.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(60000);
    expect(task.nextRunAt).toBeGreaterThan(Date.now());
    finish('baseline');
    await vi.advanceTimersByTimeAsync(60000);
    expect(checkCondition).toHaveBeenCalledTimes(2);
    expect(executeTask).not.toHaveBeenCalled();
  });

  it('requires repeating conditions and validates check inputs', () => {
    expect(() =>
      manager.create({ prompt: 'watch', cwd, runAt: Date.now(), watchConfig: fileWatch })
    ).toThrow('repeating');
    expect(() => normalizeLocalWatchConfig({ ...fileWatch, checkConfig: { path: ' ' } })).toThrow(
      'path'
    );
    expect(() =>
      normalizeLocalWatchConfig({
        checkType: 'command',
        compareMode: 'output',
        checkConfig: { command: 'echo OK', timeoutMs: 0 },
      })
    ).toThrow();
  });
});
