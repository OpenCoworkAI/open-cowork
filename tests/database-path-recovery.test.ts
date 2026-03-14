import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testRoot = '';

function mockElectron(userDataPath: string): void {
  vi.doMock('electron', () => ({
    app: {
      getPath: (name: string) => {
        if (name === 'userData') return userDataPath;
        if (name === 'home') return userDataPath;
        return userDataPath;
      },
      getVersion: () => '0.0.0-test',
    },
  }));
}

function mockLogger(): void {
  vi.doMock('../src/main/utils/logger', () => ({
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
        if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
          throw new Error(`unable to open database file: ${filePath}`);
        }
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, '', 'utf8');
        }
      }

      pragma(): undefined {
        return undefined;
      }

      exec(): void {}

      prepare(): { run: () => void; get: () => undefined; all: () => [] } {
        return {
          run: () => {},
          get: () => undefined,
          all: () => [],
        };
      }

      close(): void {}
    }

    return { default: MockDatabase };
  });
}

async function loadDatabaseModule(userDataPath: string) {
  vi.resetModules();
  mockElectron(userDataPath);
  mockLogger();
  mockBetterSqlite();
  return import('../src/main/db/database');
}

describe('database path recovery', () => {
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-db-path-test-'));
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock('electron');

    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('recovers a legacy sqlite file that occupies the data path', async () => {
    const userDataPath = path.join(testRoot, 'userData');
    fs.mkdirSync(userDataPath, { recursive: true });

    const legacyDbPath = path.join(userDataPath, 'data');
    const legacyBytes = Buffer.concat([
      Buffer.from('SQLite format 3\0', 'utf8'),
      Buffer.from('preserved-legacy-db', 'utf8'),
    ]);
    fs.writeFileSync(legacyDbPath, legacyBytes);

    const databaseModule = await loadDatabaseModule(userDataPath);
    databaseModule.initDatabase();

    const recoveredDbPath = path.join(userDataPath, 'data', 'cowork.db');
    expect(fs.existsSync(recoveredDbPath)).toBe(true);
    expect(fs.readFileSync(recoveredDbPath)).toEqual(legacyBytes);

    databaseModule.closeDatabase();
  });

  it('moves WAL sidecar files together with a recovered legacy database', async () => {
    const userDataPath = path.join(testRoot, 'userData');
    fs.mkdirSync(userDataPath, { recursive: true });

    const legacyDbPath = path.join(userDataPath, 'data');
    fs.writeFileSync(legacyDbPath, Buffer.from('SQLite format 3\0legacy-main', 'utf8'));
    fs.writeFileSync(path.join(userDataPath, 'data-wal'), 'legacy-wal', 'utf8');
    fs.writeFileSync(path.join(userDataPath, 'data-shm'), 'legacy-shm', 'utf8');

    const databaseModule = await loadDatabaseModule(userDataPath);
    databaseModule.initDatabase();

    expect(fs.readFileSync(path.join(userDataPath, 'data', 'cowork.db-wal'), 'utf8')).toBe('legacy-wal');
    expect(fs.readFileSync(path.join(userDataPath, 'data', 'cowork.db-shm'), 'utf8')).toBe('legacy-shm');
    expect(fs.existsSync(path.join(userDataPath, 'data-wal'))).toBe(false);
    expect(fs.existsSync(path.join(userDataPath, 'data-shm'))).toBe(false);

    databaseModule.closeDatabase();
  });

  it('backs up a conflicting plain file and creates a fresh database directory', async () => {
    const userDataPath = path.join(testRoot, 'userData');
    fs.mkdirSync(userDataPath, { recursive: true });

    const conflictingPath = path.join(userDataPath, 'data');
    fs.writeFileSync(conflictingPath, 'not-a-database', 'utf8');

    const databaseModule = await loadDatabaseModule(userDataPath);
    databaseModule.initDatabase();

    const dbPath = path.join(userDataPath, 'data', 'cowork.db');
    expect(fs.existsSync(dbPath)).toBe(true);

    const backupEntries = fs.readdirSync(userDataPath).filter((entry) => entry.startsWith('data.conflict-'));
    expect(backupEntries.length).toBe(1);
    expect(fs.readFileSync(path.join(userDataPath, backupEntries[0]), 'utf8')).toBe('not-a-database');
    expect(fs.statSync(path.join(userDataPath, 'data')).isDirectory()).toBe(true);

    databaseModule.closeDatabase();
  });
});
