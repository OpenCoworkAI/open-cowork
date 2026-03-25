import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function registerStoreMocks(userDataPath: string): void {
  vi.doMock('electron', () => ({
    app: {
      getPath: (name: string) => {
        if (name !== 'userData') {
          throw new Error(`Unexpected path request: ${name}`);
        }
        return userDataPath;
      },
    },
  }));

  vi.doMock('electron-store', () => {
    class MockStore<T extends Record<string, unknown>> {
      public path: string;
      private internalStore: Record<string, unknown>;
      private readonly encryptionKey?: string;
      private readonly defaults: Record<string, unknown>;

      constructor(options: { name?: string; defaults?: Record<string, unknown>; encryptionKey?: string }) {
        const name = options.name || 'config';
        this.path = path.join(userDataPath, `${name}.json`);
        this.defaults = { ...(options.defaults || {}) };
        this.encryptionKey = options.encryptionKey;

        if (fs.existsSync(this.path)) {
          const raw = fs.readFileSync(this.path, 'utf8');
          const parsed = JSON.parse(raw) as {
            key?: string;
            payload?: Record<string, unknown>;
          };

          if (parsed.key && parsed.key !== this.encryptionKey) {
            throw new SyntaxError('Unexpected token \'�\', "�..." is not valid JSON');
          }

          this.internalStore = {
            ...this.defaults,
            ...(parsed.payload || {}),
          };
          return;
        }

        this.internalStore = { ...this.defaults };
      }

      get store(): Record<string, unknown> {
        return this.internalStore;
      }

      set store(value: Record<string, unknown>) {
        this.internalStore = value;
        fs.writeFileSync(
          this.path,
          JSON.stringify({
            key: this.encryptionKey,
            payload: value,
          })
        );
      }
    }

    return {
      default: MockStore,
    };
  });
}

describe('createEncryptedStoreWithKeyRotation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencowork-store-'));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
    vi.unmock('electron');
    vi.unmock('electron-store');
  });

  it('backs up unreadable encrypted stores and recreates defaults', async () => {
    registerStoreMocks(tempDir);

    const storePath = path.join(tempDir, 'config.json');
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        key: 'some-old-key',
        payload: {
          provider: 'openrouter',
          apiKey: 'legacy-secret',
        },
      })
    );

    const { createEncryptedStoreWithKeyRotation } = await import('../src/main/utils/store-encryption');
    const store = createEncryptedStoreWithKeyRotation<Record<string, unknown>>({
      stableKey: 'stable-key',
      legacyKeys: ['legacy-key-1', 'legacy-key-2'],
      storeOptions: {
        name: 'config',
        defaults: {
          provider: 'anthropic',
          apiKey: '',
        },
      },
      logPrefix: '[TestStore]',
    });

    expect(store.store).toEqual({
      provider: 'anthropic',
      apiKey: '',
    });

    const backups = fs.readdirSync(tempDir).filter((file) => file.startsWith('config.json.unreadable-recovery-'));
    expect(backups).toHaveLength(1);
    expect(fs.existsSync(path.join(tempDir, backups[0]))).toBe(true);
    expect(fs.existsSync(storePath)).toBe(false);
  });

  it('sets maxmem high enough for secure scrypt derivation', async () => {
    registerStoreMocks(tempDir);

    const { SECURE_SCRYPT_OPTIONS } = await import('../src/main/utils/store-encryption');

    expect(() =>
      crypto.scryptSync('stable-seed', 'open-cowork-salt', 32, SECURE_SCRYPT_OPTIONS)
    ).not.toThrow();
    expect(SECURE_SCRYPT_OPTIONS.maxmem).toBeGreaterThan(128 * 65536 * 8);
  });
});
