import * as crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stores: new Map<string, Record<string, unknown>>(),
  decipherBehavior: 'normal' as 'normal' | 'suspicious-first',
  decipherCalls: 0,
}));

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');

  return {
    ...actual,
    createDecipheriv: (
      algorithm: Parameters<typeof actual.createDecipheriv>[0],
      key: Parameters<typeof actual.createDecipheriv>[1],
      iv: Parameters<typeof actual.createDecipheriv>[2]
    ) => {
      mocks.decipherCalls += 1;
      if (mocks.decipherBehavior === 'suspicious-first' && mocks.decipherCalls === 1) {
        return {
          update: () => 'bad\u0019value\ufffd',
          final: () => '',
        } as unknown as ReturnType<typeof actual.createDecipheriv>;
      }

      return actual.createDecipheriv(algorithm, key, iv);
    },
  };
});

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
    mocks.decipherBehavior = 'normal';
    mocks.decipherCalls = 0;
    vi.resetModules();
  });

  it('decrypts credentials written with the legacy credentials-key store and rewrites them', async () => {
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

    const { credentialsStore } = await import('../src/main/credentials/credentials-store');
    const credentials = credentialsStore.getAll();

    expect(credentials).toHaveLength(1);
    expect(credentials[0].password).toBe('super-secret');

    const stored = mocks.stores.get('credentials');
    expect(stored).toBeTruthy();
    expect((stored?.credentials as Array<{ encryptedPassword: string }>)[0].encryptedPassword).not.toBe(
      encryptedPassword
    );
  });

  it('falls back to the stored legacy key when stable-key decrypt returns suspicious text', async () => {
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

    mocks.decipherBehavior = 'suspicious-first';

    const { credentialsStore } = await import('../src/main/credentials/credentials-store');
    const credentials = credentialsStore.getAll();

    expect(credentials).toHaveLength(1);
    expect(credentials[0].password).toBe('super-secret');
  });
});
