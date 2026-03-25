import * as crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stores: new Map<string, Record<string, unknown>>(),
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
  },
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path: string;
    private readonly name: string;

    constructor(options: { name?: string; defaults?: Record<string, unknown> }) {
      this.name = options.name || 'config';
      this.path = `/tmp/${this.name}.json`;
      const existing = mocks.stores.get(this.name) || {};
      this.store = {
        ...(options.defaults || {}),
        ...existing,
      };
      mocks.stores.set(this.name, this.store);
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
      } else {
        this.store = {
          ...this.store,
          ...key,
        };
      }

      mocks.stores.set(this.name, this.store);
    }
  }

  return {
    default: MockStore,
  };
});

describe('credentialsStore legacy key migration', () => {
  beforeEach(() => {
    mocks.stores.clear();
    vi.resetModules();
  });

  it('initializes when safeStorage falls back to a scrypt-derived machine key', async () => {
    await expect(import('../src/main/credentials/credentials-store')).resolves.toBeDefined();
  });

  it('decrypts credentials written with the legacy credentials-key store and rewrites them as GCM', async () => {
    const legacyKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', legacyKey, iv);
    let encryptedPassword = cipher.update('super-secret', 'utf8', 'hex');
    encryptedPassword += cipher.final('hex');

    mocks.stores.set('credentials-key', {
      key: legacyKey.toString('hex'),
    });
    mocks.stores.set('credentials', {
      credentials: [
        {
          id: 'cred-1',
          name: 'Test Gmail',
          type: 'email',
          service: 'gmail',
          username: 'user@example.com',
          encryptedPassword,
          iv: iv.toString('hex'),
          createdAt: '2026-01-18T16:25:01.810Z',
          updatedAt: '2026-01-18T16:25:01.810Z',
        },
      ],
    });

    const mod = await import('../src/main/credentials/credentials-store');
    // Reset key cache so each test starts fresh.
    mod._resetMachineBoundKeyCache();

    const { credentialsStore } = mod;
    const credentials = credentialsStore.getAll();

    expect(credentials).toHaveLength(1);
    expect(credentials[0].password).toBe('super-secret');

    // After migration, the stored ciphertext should differ (re-encrypted with
    // the machine-bound key using GCM).
    const stored = mocks.stores.get('credentials');
    expect(stored).toBeTruthy();

    const storedCreds = stored?.credentials as Array<{
      encryptedPassword: string;
      iv: string;
      authTag?: string;
    }>;
    expect(storedCreds[0].encryptedPassword).not.toBe(encryptedPassword);
    // GCM migration must write an authTag
    expect(storedCreds[0].authTag).toBeTruthy();
    expect(typeof storedCreds[0].authTag).toBe('string');
  });

  it('reads GCM-encrypted credentials without re-migration', async () => {
    // Simulate data already encrypted with machine-bound key + GCM
    const mod = await import('../src/main/credentials/credentials-store');
    mod._resetMachineBoundKeyCache();

    const { credentialsStore } = mod;

    // Save a credential (uses GCM internally)
    const saved = credentialsStore.save({
      name: 'GCM Test',
      type: 'api',
      username: 'apiuser',
      password: 'gcm-secret-123',
    });

    expect(saved.password).toBe('gcm-secret-123');
    expect(saved.id).toMatch(/^cred-/);

    // Retrieve it back
    const all = credentialsStore.getAll();
    const found = all.find((c) => c.id === saved.id);
    expect(found).toBeDefined();
    expect(found?.password).toBe('gcm-secret-123');

    // Verify authTag is stored
    const stored = mocks.stores.get('credentials');
    const storedCreds = stored?.credentials as Array<{
      authTag?: string;
    }>;
    const storedCred = storedCreds.find(
      (c: Record<string, unknown>) => c.id === saved.id
    ) as { authTag?: string } | undefined;
    expect(storedCred?.authTag).toBeTruthy();
  });

  it('generates credential IDs using crypto.randomUUID format', async () => {
    const mod = await import('../src/main/credentials/credentials-store');
    mod._resetMachineBoundKeyCache();
    const { credentialsStore } = mod;

    const saved = credentialsStore.save({
      name: 'ID Test',
      type: 'other',
      username: 'user',
      password: 'pass',
    });

    // ID should start with cred- and NOT use Math.random (no base36 pattern)
    expect(saved.id).toMatch(/^cred-\d+-[0-9a-f-]{1,9}$/);
  });

  it('updates password when set to empty string', async () => {
    const mod = await import('../src/main/credentials/credentials-store');
    mod._resetMachineBoundKeyCache();
    const { credentialsStore } = mod;

    const saved = credentialsStore.save({
      name: 'Empty PW Test',
      type: 'other',
      username: 'user',
      password: 'initial-password',
    });

    // Update password to empty string — should NOT be skipped
    const updated = credentialsStore.update(saved.id, { password: '' });
    expect(updated).toBeDefined();
    expect(updated?.password).toBe('');
  });
});
