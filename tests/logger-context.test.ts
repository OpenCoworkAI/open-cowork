import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Helper: write a log, then read back the file content.
 * The log file is lazily initialized on first write, so we
 * retrieve the path AFTER writing and close before reading.
 */
async function getLogContent(logger: typeof import('../src/main/utils/logger')): Promise<string> {
  const logFilePath = logger.getLogFilePath();
  expect(logFilePath).toBeTruthy();
  logger.closeLogFile();
  await new Promise((resolve) => setTimeout(resolve, 20));
  return fs.readFileSync(logFilePath!, 'utf8');
}

describe('logger context (AsyncLocalStorage)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doMock('electron', () => ({
      app: {},
    }));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      const logger = await import('../src/main/utils/logger');
      logger.closeLogFile();
    } catch {
      // Module may not be importable if test failed early
    }
  });

  it('runWithLogContext propagates sessionId and traceId to logCtx output', async () => {
    const logger = await import('../src/main/utils/logger');

    logger.runWithLogContext(
      { sessionId: 'test-session-1234', traceId: 'abc12345' },
      () => {
        logger.logCtx('[Test] context aware log');
      }
    );

    const content = await getLogContent(logger);
    expect(content).toContain('[sid:test-ses]');
    expect(content).toContain('[tid:abc12345]');
    expect(content).toContain('[Test] context aware log');
  });

  it('logCtx without context produces no sid/tid prefix', async () => {
    const logger = await import('../src/main/utils/logger');

    // Log outside of runWithLogContext
    logger.logCtx('[Test] no context log');

    const content = await getLogContent(logger);
    expect(content).toContain('[Test] no context log');
    expect(content).not.toContain('[sid:');
    expect(content).not.toContain('[tid:');
  });

  it('nested runWithLogContext overrides parent context', async () => {
    const logger = await import('../src/main/utils/logger');

    logger.runWithLogContext(
      { sessionId: 'outer-session-id00', traceId: 'outer000' },
      () => {
        logger.logCtx('[Test] outer log');
        logger.runWithLogContext(
          { sessionId: 'inner-session-id00', traceId: 'inner000' },
          () => {
            logger.logCtx('[Test] inner log');
          }
        );
        logger.logCtx('[Test] outer again');
      }
    );

    const content = await getLogContent(logger);
    const lines = content.split('\n');

    const outerLine = lines.find((l) => l.includes('[Test] outer log'));
    expect(outerLine).toContain('[sid:outer-se]');
    expect(outerLine).toContain('[tid:outer000]');

    const innerLine = lines.find((l) => l.includes('[Test] inner log'));
    expect(innerLine).toContain('[sid:inner-se]');
    expect(innerLine).toContain('[tid:inner000]');

    const outerAgainLine = lines.find((l) => l.includes('[Test] outer again'));
    expect(outerAgainLine).toContain('[sid:outer-se]');
    expect(outerAgainLine).toContain('[tid:outer000]');
  });

  it('logCtxWarn and logCtxError include context prefix in file', async () => {
    const logger = await import('../src/main/utils/logger');

    logger.runWithLogContext(
      { sessionId: 'warn-error-sess', traceId: 'we123456' },
      () => {
        logger.logCtxWarn('[Test] warning message');
        logger.logCtxError('[Test] error message');
      }
    );

    const content = await getLogContent(logger);
    expect(content).toContain('[WARN]');
    expect(content).toContain('[Test] warning message');
    expect(content).toContain('[ERROR]');
    expect(content).toContain('[Test] error message');

    const warnLine = content.split('\n').find((l) => l.includes('[Test] warning message'));
    expect(warnLine).toContain('[sid:warn-err]');
    const errorLine = content.split('\n').find((l) => l.includes('[Test] error message'));
    expect(errorLine).toContain('[sid:warn-err]');
  });

  it('logTiming includes elapsed time and context prefix', async () => {
    const logger = await import('../src/main/utils/logger');

    const startTime = Date.now() - 42;

    logger.runWithLogContext(
      { sessionId: 'timing-session0', traceId: 'tim12345' },
      () => {
        logger.logTiming('test-operation', startTime);
      }
    );

    const content = await getLogContent(logger);
    expect(content).toContain('[TIMING] test-operation:');
    expect(content).toContain('ms');
    const timingLine = content.split('\n').find((l) => l.includes('[TIMING]'));
    expect(timingLine).toContain('[sid:timing-s]');
    expect(timingLine).toContain('[tid:tim12345]');
  });

  it('generateTraceId returns 8-character hex string', async () => {
    const logger = await import('../src/main/utils/logger');
    const traceId = logger.generateTraceId();
    expect(traceId).toHaveLength(8);
    expect(traceId).toMatch(/^[0-9a-f]{8}$/);
    logger.closeLogFile();
  });

  it('original log/logError still work inside and outside context', async () => {
    const logger = await import('../src/main/utils/logger');

    logger.runWithLogContext(
      { sessionId: 'compat-session0', traceId: 'compat00' },
      () => {
        logger.log('[Test] original log inside context');
      }
    );
    logger.log('[Test] original log outside context');

    const content = await getLogContent(logger);
    expect(content).toContain('[Test] original log inside context');
    expect(content).toContain('[Test] original log outside context');
  });

  it('async context propagation works across await boundaries', async () => {
    const logger = await import('../src/main/utils/logger');

    await logger.runWithLogContext(
      { sessionId: 'async-session00', traceId: 'async000' },
      async () => {
        logger.logCtx('[Test] before await');
        await new Promise((resolve) => setTimeout(resolve, 10));
        logger.logCtx('[Test] after await');
      }
    );

    const content = await getLogContent(logger);
    const beforeLine = content.split('\n').find((l) => l.includes('[Test] before await'));
    const afterLine = content.split('\n').find((l) => l.includes('[Test] after await'));
    expect(beforeLine).toContain('[sid:async-se]');
    expect(afterLine).toContain('[sid:async-se]');
  });
});
