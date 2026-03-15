import { describe, expect, it } from 'vitest';
import { closeLogFile, getLogFilePath, shouldPersistLogLevel } from '../src/main/utils/logger';

describe('shouldPersistLogLevel', () => {
  it('keeps info logs behind the detailed log toggle', () => {
    expect(shouldPersistLogLevel('INFO', true)).toBe(true);
    expect(shouldPersistLogLevel('INFO', false)).toBe(false);
  });

  it('always preserves warning and error logs', () => {
    expect(shouldPersistLogLevel('WARN', true)).toBe(true);
    expect(shouldPersistLogLevel('WARN', false)).toBe(true);
    expect(shouldPersistLogLevel('ERROR', true)).toBe(true);
    expect(shouldPersistLogLevel('ERROR', false)).toBe(true);
  });

  it('does not initialize a log file when only reading the current path', () => {
    closeLogFile();
    expect(getLogFilePath()).toBeNull();
  });
});
