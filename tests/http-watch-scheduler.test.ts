import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  ScheduledTaskManager,
  type ScheduledTask,
} from '../src/main/schedule/scheduled-task-manager';
import { checkLocalCondition } from '../src/main/schedule/local-condition-checker';
import { normalizeLocalWatchConfig } from '../src/shared/schedule/local-watch-task';

let server: Server | undefined;
let manager: ScheduledTaskManager | undefined;
afterEach(async () => {
  manager?.stop();
  if (server)
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve()))
    );
});

describe('HTTP polling through the production condition dispatcher', () => {
  it('baselines without AI, persists changes before AI, and does not retry a failed AI run', async () => {
    let body = 'before';
    server = createServer((_req, res) => res.end(body));
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test listener');
    let task: ScheduledTask = {
      id: 'http',
      title: 'HTTP',
      prompt: 'react',
      cwd: process.cwd(),
      runAt: Date.now() + 60000,
      nextRunAt: Date.now() + 60000,
      repeatEvery: 1,
      repeatUnit: 'minute',
      scheduleConfig: null,
      enabled: true,
      lastRunAt: null,
      lastRunSessionId: null,
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
      lastState: null,
      watchConfig: normalizeLocalWatchConfig({
        checkType: 'http',
        compareMode: 'bodyHash',
        checkConfig: { url: `http://127.0.0.1:${address.port}` },
      }),
    };
    const executeTask = vi.fn(async (observed: ScheduledTask) => {
      expect(task.lastState).toBe(observed.lastState);
      expect(task.lastState).not.toBe(baseline);
      throw new Error('AI unavailable');
    });
    manager = new ScheduledTaskManager({
      store: {
        list: () => [task],
        get: () => task,
        create: () => task,
        update: (_id, changes) => {
          task = {
            ...task,
            ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)),
          };
          return task;
        },
        delete: () => true,
      },
      executeTask,
      checkCondition: checkLocalCondition,
    });
    expect((await manager.runNow(task.id))?.outcome).toBe('baseline');
    const baseline = task.lastState;
    expect((await manager.runNow(task.id))?.outcome).toBe('unchanged');
    expect(executeTask).not.toHaveBeenCalled();
    body = 'after';
    await expect(manager.runNow(task.id)).rejects.toThrow('AI unavailable');
    expect(executeTask).toHaveBeenCalledTimes(1);
    expect((await manager.runNow(task.id))?.outcome).toBe('unchanged');
    expect(executeTask).toHaveBeenCalledTimes(1);
  });
});
