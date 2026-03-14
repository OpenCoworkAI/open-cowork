import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-logs',
    getVersion: () => '3.1.0',
  },
}));

// Mock fs - use factory functions that don't reference top-level variables
vi.mock('fs', () => ({
  existsSync: () => true,
  mkdirSync: vi.fn(),
  createWriteStream: () => ({
    write: vi.fn(),
    end: vi.fn(),
  }),
  readdirSync: () => [],
  statSync: () => ({ size: 100, mtime: new Date() }),
  unlinkSync: vi.fn(),
}));

import {
  log,
  logWarn,
  logError,
  getLogsDirectory,
  getAllLogFiles,
  setDevLogsEnabled,
  isDevLogsEnabled,
  closeLogFile,
} from '../src/main/utils/logger';

describe('logger', () => {
  beforeEach(() => {
    closeLogFile();
    setDevLogsEnabled(true);
  });

  afterEach(() => {
    closeLogFile();
  });

  describe('log', () => {
    it('logs to console', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      log('test message');
      expect(spy).toHaveBeenCalled();
      // log() passes [timestamp] as first arg and message args after
      const allArgs = spy.mock.calls.flat().map(String).join(' ');
      expect(allArgs).toContain('test message');
      spy.mockRestore();
    });
  });

  describe('logWarn', () => {
    it('logs to console.warn', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      logWarn('warning message');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('logError', () => {
    it('logs to console.error', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logError('error message');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('getLogsDirectory', () => {
    it('returns logs directory path', () => {
      const dir = getLogsDirectory();
      expect(dir).toContain('logs');
    });
  });

  describe('getAllLogFiles', () => {
    it('returns empty array when no log files', () => {
      const files = getAllLogFiles();
      expect(files).toEqual([]);
    });
  });

  describe('setDevLogsEnabled / isDevLogsEnabled', () => {
    it('toggles dev logs', () => {
      setDevLogsEnabled(false);
      expect(isDevLogsEnabled()).toBe(false);

      setDevLogsEnabled(true);
      expect(isDevLogsEnabled()).toBe(true);
    });
  });

  describe('closeLogFile', () => {
    it('closes without error when no log file open', () => {
      expect(() => closeLogFile()).not.toThrow();
    });
  });
});
