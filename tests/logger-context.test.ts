import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Per-test isolated userData directory.  Providing a unique directory via the
 * electron mock accomplishes two things:
 *
 *   1. Prevents cross-worker file-deletion races: when the full suite runs,
 *      multiple worker threads share the same default .cowork-user-data/logs
 *      directory.  cleanupOldLogs() in one worker can delete a log file that
 *      another worker is still trying to read, causing ENOENT failures.
 *
 *   2. Keeps test artefacts self-contained so they can be cleaned up in
 *      afterEach regardless of whether the test passed or failed.
 */
let testUserDataDir: string = '';

/**
 * Holds a reference to the most recent WriteStream opened by the logger's
 * initLogFile() so getLogContent can wait for the 'finish' event instead of
 * relying on a fixed-length timeout.
 *
 * Populated by a vi.spyOn wrapper installed in each beforeEach and reset in
 * afterEach, giving every test a fresh, isolated reference.
 */
let capturedWriteStream: fs.WriteStream | null = null;

/**
 * Helper: write a log, then read back the file content.
 *
 * The log file is lazily initialized on first write, so we retrieve the path
 * AFTER writing.  Instead of a fixed setTimeout we wait for the WriteStream
 * 'finish' event (captured via the createWriteStream spy) to guarantee all
 * buffered bytes have been flushed before the file is read back.  This makes
 * the assertion reliable even under heavy CPU load during a full test-suite run.
 */
async function getLogContent(logger: typeof import('../src/main/utils/logger')): Promise<string> {
  const logFilePath = logger.getLogFilePath();
  expect(logFilePath).toBeTruthy();

  // Capture the stream reference before closeLogFile() clears the internal pointer.
  const stream = capturedWriteStream;

  logger.closeLogFile();

  if (stream) {
    // Wait until the stream has fully flushed and closed.
    await new Promise<void>((resolve) => {
      if (stream.writableFinished || stream.destroyed) {
        resolve();
        return;
      }
      stream.once('finish', resolve);
      stream.once('close', resolve);
    });
  } else {
    // No stream was captured (e.g. test that never triggered a write).
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  let lastContent = '';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const content = fs.readFileSync(logFilePath!, 'utf8');
      if (content.length > 0 && content === lastContent) {
        return content;
      }
      lastContent = content;
    } catch {
      // Retry until the file is readable and content stabilizes.
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return lastContent;
}

describe('logger context (AsyncLocalStorage)', () => {
  beforeEach(() => {
    // Create a unique temporary directory for this test's log files.
    // This prevents cleanupOldLogs() from one parallel worker deleting files
    // that another worker is still reading (the root cause of cross-worker
    // ENOENT flakiness in a full `npm run test` run).
    testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-test-logger-'));

    vi.resetModules();
    vi.restoreAllMocks();

    // Provide a real app.getPath so the logger writes to our isolated temp dir.
    vi.doMock('electron', () => ({
      app: {
        getPath: (_name: string) => testUserDataDir,
        getVersion: () => 'test',
      },
    }));

    // Spy on fs.createWriteStream to capture the stream instance created by
    // initLogFile().  We use the real implementation and only intercept to
    // record the returned stream, so the logger behaves normally.
    //
    // The spy is set up AFTER vi.resetModules() so the freshly loaded logger
    // module uses the same fs object reference we are wrapping here.
    capturedWriteStream = null;
    const realCreateWriteStream = fs.createWriteStream.bind(fs);
    vi.spyOn(fs, 'createWriteStream').mockImplementation(
      (...args: Parameters<typeof fs.createWriteStream>) => {
        const stream = realCreateWriteStream(...args);
        capturedWriteStream = stream;
        return stream;
      }
    );
  });

  afterEach(async () => {
    // Restore all mocks before closing the log file so the spy is removed.
    vi.restoreAllMocks();
    capturedWriteStream = null;

    try {
      const logger = await import('../src/main/utils/logger');
      logger.closeLogFile();
    } catch {
      // Module may not be importable if test failed early
    }

    // Remove the isolated temp directory created for this test.
    try {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures — they do not affect correctness.
    }
  });

  it('runWithLogContext propagates sessionId and traceId to logCtx output', async () => {
    const logger = await import('../src/main/utils/logger');

    logger.runWithLogContext({ sessionId: 'test-session-1234', traceId: 'abc12345' }, () => {
      logger.logCtx('[Test] context aware log');
    });

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

    logger.runWithLogContext({ sessionId: 'outer-session-id00', traceId: 'outer000' }, () => {
      logger.logCtx('[Test] outer log');
      logger.runWithLogContext({ sessionId: 'inner-session-id00', traceId: 'inner000' }, () => {
        logger.logCtx('[Test] inner log');
      });
      logger.logCtx('[Test] outer again');
    });

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

    logger.runWithLogContext({ sessionId: 'warn-error-sess', traceId: 'we123456' }, () => {
      logger.logCtxWarn('[Test] warning message');
      logger.logCtxError('[Test] error message');
    });

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

    logger.runWithLogContext({ sessionId: 'timing-session0', traceId: 'tim12345' }, () => {
      logger.logTiming('test-operation', startTime);
    });

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

    logger.runWithLogContext({ sessionId: 'compat-session0', traceId: 'compat00' }, () => {
      logger.log('[Test] original log inside context');
    });
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
