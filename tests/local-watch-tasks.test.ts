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
  await rm(cwd, { recursive: true });
});

describe('local conditional scheduled tasks', () => {
  it('establishes a baseline, skips unchanged content, and starts exactly once per change', async () => {
    await writeFile(join(cwd, 'watched.txt'), 'before');
    await manager.runNow(task.id);
    expect(task.lastCheckedAt).toBeTypeOf('number');
    expect(task.lastRunAt).toBeNull();
    await manager.runNow(task.id);
    expect(task.consecutiveUnchanged).toBe(1);
    expect(executeTask).not.toHaveBeenCalled();
    await writeFile(join(cwd, 'watched.txt'), 'after');
    await manager.runNow(task.id);
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
    const child = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 1500)`;
    const parent = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'inherit' }); setTimeout(() => {}, 10000)`;
    task.watchConfig = {
      checkType: 'command',
      compareMode: 'output',
      checkConfig: {
        command: `"${process.execPath}" -e ${JSON.stringify(parent)}`,
        timeoutMs: 1000,
      },
    };
    await expect(manager.runNow(task.id)).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

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
