import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FALLBACK_USER_DATA_DIR = path.join(process.cwd(), '.cowork-user-data');
const FALLBACK_LOGS_DIR = path.join(FALLBACK_USER_DATA_DIR, 'logs');

describe('logger fallback behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses fallback userData path when electron app path API is unavailable', async () => {
    vi.doMock('electron', () => ({
      app: {},
    }));

    const logger = await import('../src/main/utils/logger');

    expect(logger.getLogsDirectory()).toBe(FALLBACK_LOGS_DIR);

    const logFilePath = logger.getLogFilePath();
    expect(logFilePath).toBeTruthy();
    expect(logFilePath?.startsWith(FALLBACK_LOGS_DIR)).toBe(true);
    logger.closeLogFile();
  });

  it('recovers when active log file is removed unexpectedly', async () => {
    vi.doMock('electron', () => ({
      app: {},
    }));

    const logger = await import('../src/main/utils/logger');
    const initialLogPath = logger.getLogFilePath();
    expect(initialLogPath).toBeTruthy();

    if (initialLogPath && fs.existsSync(initialLogPath)) {
      fs.unlinkSync(initialLogPath);
    }

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(() => logger.log('trigger rotate check')).not.toThrow();
    randomSpy.mockRestore();

    const recoveredLogPath = logger.getLogFilePath();
    expect(recoveredLogPath).toBeTruthy();
    expect(recoveredLogPath?.startsWith(FALLBACK_LOGS_DIR)).toBe(true);
    logger.closeLogFile();
  });

  it('serializes Error objects with message details instead of empty object', async () => {
    vi.doMock('electron', () => ({
      app: {},
    }));

    const logger = await import('../src/main/utils/logger');
    const logFilePath = logger.getLogFilePath();
    expect(logFilePath).toBeTruthy();

    logger.logError('[test] expected-error', new Error('boom logger error'));
    logger.closeLogFile();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const content = fs.readFileSync(logFilePath!, 'utf8');
    expect(content).toContain('[test] expected-error');
    expect(content).toContain('boom logger error');
  });

  it('reopens a fresh log file after closeLogFile is called', async () => {
    vi.doMock('electron', () => ({
      app: {},
    }));

    const logger = await import('../src/main/utils/logger');
    const firstLogPath = logger.getLogFilePath();
    expect(firstLogPath).toBeTruthy();

    logger.closeLogFile();
    logger.log('after close should reopen');

    const secondLogPath = logger.getLogFilePath();
    expect(secondLogPath).toBeTruthy();
    expect(secondLogPath).not.toBe(firstLogPath);
  });

  it('swallows broken pipe errors from console output', async () => {
    vi.doMock('electron', () => ({
      app: {},
    }));

    const logger = await import('../src/main/utils/logger');
    const epipeError = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      throw epipeError;
    });

    expect(() => logger.log('stdout closed')).not.toThrow();

    consoleSpy.mockRestore();
    logger.closeLogFile();
  });
});
