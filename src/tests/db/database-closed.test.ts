import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sqliteCalls = {
  prepare: 0,
  exec: 0,
  pragma: 0,
  run: 0,
  get: 0,
  all: 0,
  close: 0,
};

function resetSqliteCalls(): void {
  sqliteCalls.prepare = 0;
  sqliteCalls.exec = 0;
  sqliteCalls.pragma = 0;
  sqliteCalls.run = 0;
  sqliteCalls.get = 0;
  sqliteCalls.all = 0;
  sqliteCalls.close = 0;
}

function mockElectron(userDataPath: string): void {
  vi.doMock('electron', () => ({
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-test',
    },
  }));
}

function mockLogger(): void {
  vi.doMock('../../main/utils/logger', () => ({
    log: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
  }));
}

function mockBetterSqlite(): void {
  vi.doMock('better-sqlite3', () => {
    class MockDatabase {
      constructor(filePath: string) {
        const parentDir = path.dirname(filePath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, '', 'utf8');
        }
      }

      pragma(): undefined {
        sqliteCalls.pragma += 1;
        return undefined;
      }

      exec(): void {
        sqliteCalls.exec += 1;
      }

      prepare(): { run: () => void; get: () => undefined; all: () => [] } {
        sqliteCalls.prepare += 1;
        return {
          run: () => {
            sqliteCalls.run += 1;
          },
          get: () => {
            sqliteCalls.get += 1;
            return undefined;
          },
          all: () => {
            sqliteCalls.all += 1;
            return [];
          },
        };
      }

      close(): void {
        sqliteCalls.close += 1;
      }
    }

    return { default: MockDatabase };
  });
}

async function loadDatabaseModule(userDataPath: string) {
  vi.resetModules();
  mockElectron(userDataPath);
  mockLogger();
  mockBetterSqlite();
  return import('../../main/db/database');
}

describe('database close guard', () => {
  let testRoot = '';

  beforeEach(() => {
    resetSqliteCalls();
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-db-closed-'));
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock('electron');
    vi.doUnmock('better-sqlite3');
    vi.doUnmock('../../main/utils/logger');
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('does not touch SQLite after the database is closed', async () => {
    const userDataPath = path.join(testRoot, 'userData');
    fs.mkdirSync(userDataPath, { recursive: true });

    const databaseModule = await loadDatabaseModule(userDataPath);
    const database = databaseModule.initDatabase();

    database.sessions.get('still-open');
    expect(sqliteCalls.get).toBeGreaterThan(0);

    databaseModule.closeDatabase();
    const afterClose = { ...sqliteCalls };
    expect(afterClose.close).toBe(1);

    expect(() => database.sessions.get('after-close')).toThrow(databaseModule.DatabaseClosedError);
    expect(() => database.sessions.update('after-close', { title: 'nope' })).toThrow(
      databaseModule.DatabaseClosedError
    );
    expect(() => database.messages.getBySessionId('after-close')).toThrow(
      databaseModule.DatabaseClosedError
    );
    expect(() => database.traceSteps.getBySessionId('after-close')).toThrow(
      databaseModule.DatabaseClosedError
    );
    expect(() => database.scheduledTasks.getAll()).toThrow(databaseModule.DatabaseClosedError);
    expect(() => database.prepare('SELECT 1')).toThrow(databaseModule.DatabaseClosedError);
    expect(() => database.exec('SELECT 1')).toThrow(databaseModule.DatabaseClosedError);
    expect(() => database.pragma('journal_mode')).toThrow(databaseModule.DatabaseClosedError);
    expect(() => database.raw).toThrow(databaseModule.DatabaseClosedError);
    expect(() => databaseModule.getDatabase()).toThrow(/not initialized/i);

    databaseModule.closeDatabase();

    expect(sqliteCalls).toEqual(afterClose);
  });
});
