import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { HttpConditionChecker } from '../src/main/schedule/http-condition-checker';
import {
  ScheduledTaskManager,
  type ScheduledTask,
  type ScheduledTaskStore,
} from '../src/main/schedule/scheduled-task-manager';
import { normalizeWatchConfig } from '../src/shared/schedule/watch-task';

type LoopbackServer = {
  readonly url: string;
  setBody(body: string): void;
  getRequestCount(): number;
};

function createWatchTask(url: string, now: number): ScheduledTask {
  return {
    id: 'integration-watch-task',
    title: 'Watch loopback state',
    prompt: 'React to a changed loopback response.',
    cwd: '/tmp/reactive-polling',
    runAt: now + 60_000,
    nextRunAt: now + 60_000,
    scheduleConfig: null,
    repeatEvery: 1,
    repeatUnit: 'minute',
    enabled: true,
    lastRunAt: null,
    lastRunSessionId: null,
    lastError: null,
    watchConfig: normalizeWatchConfig({
      checkType: 'http',
      compareMode: 'bodyHash',
      checkConfig: { url, method: 'GET', timeoutMs: 1_000 },
    }),
    watchConfigError: null,
    lastState: null,
    lastCheckedAt: null,
    consecutiveUnchanged: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function createStore(task: ScheduledTask): ScheduledTaskStore {
  let currentTask = task;

  return {
    list: () => [currentTask],
    get: (id) => (id === currentTask.id ? currentTask : null),
    create: () => {
      throw new Error('The integration Store does not create tasks.');
    },
    update: (id, updates) => {
      if (id !== currentTask.id) {
        return null;
      }
      currentTask = { ...currentTask, ...updates, updatedAt: Date.now() };
      return currentTask;
    },
    delete: () => false,
  };
}

function hash(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

async function withLoopbackServer<T>(
  runWithServer: (server: LoopbackServer) => Promise<T>
): Promise<T> {
  let responseBody = 'A';
  let requestCount = 0;
  const server = createServer((_request, response) => {
    requestCount += 1;
    response.end(responseBody);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected an ephemeral loopback TCP port.');
  }

  try {
    return await runWithServer({
      url: `http://127.0.0.1:${address.port}/state`,
      setBody: (body) => {
        responseBody = body;
      },
      getRequestCount: () => requestCount,
    });
  } finally {
    await closeServer(server);
  }
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe('reactive polling integration', () => {
  it('runs A, unchanged A, changed B, failed C, and unchanged C through the real loopback checker', async () => {
    await withLoopbackServer(async (loopback) => {
      // Given
      const now = Date.now();
      const task = createWatchTask(loopback.url, now);
      const store = createStore(task);
      const checker = new HttpConditionChecker();
      let agentCalls = 0;
      const manager = new ScheduledTaskManager({
        store,
        checkCondition: (config) => checker.check(config),
        executeTask: async () => {
          agentCalls += 1;
          if (agentCalls === 2) {
            throw new Error('Agent failed C');
          }
          return { sessionId: 'agent-B' };
        },
        now: () => now,
      });

      // When
      await manager.runNow(task.id);

      // Then
      expect(store.get(task.id)).toMatchObject({
        lastState: hash('A'),
        consecutiveUnchanged: 0,
        lastError: null,
      });
      expect(agentCalls).toBe(0);

      await manager.runNow(task.id);
      expect(store.get(task.id)).toMatchObject({
        lastState: hash('A'),
        consecutiveUnchanged: 1,
        lastError: null,
      });
      expect(agentCalls).toBe(0);

      loopback.setBody('B');
      await manager.runNow(task.id);
      expect(store.get(task.id)).toMatchObject({
        lastState: hash('B'),
        consecutiveUnchanged: 0,
        lastRunSessionId: 'agent-B',
        lastError: null,
      });
      expect(agentCalls).toBe(1);

      loopback.setBody('C');
      await expect(manager.runNow(task.id)).rejects.toThrow('Agent failed C');
      expect(store.get(task.id)).toMatchObject({
        lastState: hash('C'),
        consecutiveUnchanged: 0,
        lastRunSessionId: null,
        lastError: 'Agent failed C',
      });
      expect(agentCalls).toBe(2);

      await manager.runNow(task.id);
      expect(store.get(task.id)).toMatchObject({
        lastState: hash('C'),
        consecutiveUnchanged: 1,
        lastError: null,
        nextRunAt: now + 60_000,
      });
      expect(agentCalls).toBe(2);
      expect(loopback.getRequestCount()).toBe(5);
    });
  });
});
