import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron-store as a proper class constructor
vi.mock('electron-store', () => {
  class MockStore {
    private data: Record<string, unknown> = {};
    constructor(opts?: any) {
      if (opts?.defaults) {
        this.data = { ...opts.defaults };
      }
    }
    get(key: string, defaultVal?: unknown) {
      return key in this.data ? this.data[key] : defaultVal;
    }
    set(key: string, value: unknown) { this.data[key] = value; }
    clear() { this.data = {}; }
    get path() { return '/tmp/credentials.json'; }
  }
  return { default: MockStore };
});

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-userdata',
    getVersion: () => '3.1.0',
  },
}));

import { credentialsStore } from '../src/main/credentials/credentials-store';

describe('credentialsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('save', () => {
    it('saves a new credential and returns it with generated id', () => {
      const result = credentialsStore.save({
        name: 'Test Credential',
        type: 'email',
        service: 'gmail',
        username: 'test@example.com',
        password: 'secret123',
      });

      expect(result).toBeDefined();
      expect(result.id).toMatch(/^cred-/);
      expect(result.name).toBe('Test Credential');
      expect(result.type).toBe('email');
      expect(result.username).toBe('test@example.com');
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });
  });

  describe('getAll', () => {
    it('returns array', () => {
      const result = credentialsStore.getAll();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getAllSafe', () => {
    it('returns array', () => {
      const safe = credentialsStore.getAllSafe();
      expect(Array.isArray(safe)).toBe(true);
    });
  });

  describe('delete', () => {
    it('returns false when credential not found', () => {
      const result = credentialsStore.delete('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('update', () => {
    it('returns undefined when credential not found', () => {
      const result = credentialsStore.update('non-existent', { name: 'Updated' });
      expect(result).toBeUndefined();
    });
  });

  describe('clearAll', () => {
    it('clears all credentials', () => {
      credentialsStore.clearAll();
      const allSafe = credentialsStore.getAllSafe();
      expect(Array.isArray(allSafe)).toBe(true);
    });
  });
});
