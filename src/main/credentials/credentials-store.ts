import Store, { type Options as StoreOptions } from 'electron-store';
import * as crypto from 'crypto';
import { log, logWarn } from '../utils/logger';
import { getLegacyDerivedKeyBuffers, getStableDerivedKeyBuffer } from '../utils/store-encryption';

/**
 * User Credential - stored information for automated login
 */
export interface UserCredential {
  id: string;
  name: string;           // Friendly name, e.g., "Work Gmail"
  type: 'email' | 'website' | 'api' | 'other';
  service?: string;       // gmail, outlook, github, etc.
  username: string;
  password: string;       // Encrypted in storage
  url?: string;           // Optional: login URL
  notes?: string;         // Optional: additional notes
  createdAt: string;
  updatedAt: string;
}

/**
 * Stored format with encrypted password
 */
interface StoredCredential extends Omit<UserCredential, 'password'> {
  encryptedPassword: string;
  iv: string;
}

/**
 * Credentials Store - Securely stores user credentials with encryption
 */
class CredentialsStore {
  private store: Store<{ credentials: StoredCredential[] }>;
  private legacyKeyStore: Store<{ key?: string }>;

  constructor() {
    const storeOptions: StoreOptions<{ credentials: StoredCredential[] }> & { projectName?: string } = {
      name: 'credentials',
      projectName: 'open-cowork',
      defaults: {
        credentials: [],
      },
    };
    this.store = new Store<{ credentials: StoredCredential[] }>(storeOptions);
    this.legacyKeyStore = new Store<{ key?: string }>({ name: 'credentials-key' });
    this.migrateLegacyPasswords();
  }

  private static getPrimaryKey(): Buffer {
    return getStableDerivedKeyBuffer({
      moduleDirname: __dirname,
      stableSeed: 'open-cowork-credentials-stable-v1',
      legacySeed: 'open-cowork-credentials',
      salt: 'open-cowork-salt',
    });
  }

  private static getFallbackKeys(): Buffer[] {
    return getLegacyDerivedKeyBuffers({
      moduleDirname: __dirname,
      stableSeed: 'open-cowork-credentials-stable-v1',
      legacySeed: 'open-cowork-credentials',
      salt: 'open-cowork-salt',
    });
  }

  private getLegacyStoredKey(): Buffer | null {
    const key = this.legacyKeyStore.get('key');
    if (!key || typeof key !== 'string') {
      return null;
    }

    try {
      const buffer = Buffer.from(key, 'hex');
      return buffer.length === 32 ? buffer : null;
    } catch {
      return null;
    }
  }

  private encryptWithKey(text: string, key: Buffer): { encrypted: string; iv: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return {
      encrypted,
      iv: iv.toString('hex'),
    };
  }

  private decryptWithKey(encrypted: string, iv: string, key: Buffer): string {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(iv, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private static looksSuspiciousDecryptedText(value: string): boolean {
    for (const char of value) {
      const code = char.charCodeAt(0);
      if (code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)) {
        return true;
      }
      if (code === 0x7f || code === 0xfffd) {
        return true;
      }
    }

    return false;
  }

  private decryptWithFallback(
    encrypted: string,
    iv: string
  ): { decrypted: string; needsRewrite: boolean } {
    let suspiciousCandidate: { decrypted: string; needsRewrite: boolean } | null = null;
    const tryKey = (key: Buffer, needsRewrite: boolean): { decrypted: string; needsRewrite: boolean } | null => {
      try {
        const decrypted = this.decryptWithKey(encrypted, iv, key);
        if (CredentialsStore.looksSuspiciousDecryptedText(decrypted)) {
          if (!suspiciousCandidate) {
            suspiciousCandidate = { decrypted, needsRewrite };
          }
          return null;
        }

        return {
          decrypted,
          needsRewrite,
        };
      } catch {
        return null;
      }
    };

    const primary = tryKey(CredentialsStore.getPrimaryKey(), false);
    if (primary) {
      return primary;
    }

    const storedLegacyKey = this.getLegacyStoredKey();
    if (storedLegacyKey) {
      const legacy = tryKey(storedLegacyKey, true);
      if (legacy) {
        return legacy;
      }
    }

    for (const key of CredentialsStore.getFallbackKeys()) {
      const fallback = tryKey(key, true);
      if (fallback) {
        return fallback;
      }
    }

    if (suspiciousCandidate) {
      return suspiciousCandidate;
    }

    throw new Error('Failed to decrypt stored credential with both stable and legacy keys');
  }

  private migrateLegacyPasswords(): void {
    const credentials = this.store.get('credentials', []);
    let changed = false;
    const primaryKey = CredentialsStore.getPrimaryKey();

    const migrated = credentials.map((cred) => {
      try {
        const { decrypted, needsRewrite } = this.decryptWithFallback(cred.encryptedPassword, cred.iv);
        if (!needsRewrite) {
          return cred;
        }

        changed = true;
        const next = this.encryptWithKey(decrypted, primaryKey);
        return {
          ...cred,
          encryptedPassword: next.encrypted,
          iv: next.iv,
        };
      } catch (error) {
        logWarn('[CredentialsStore] Failed to migrate credential encryption', {
          id: cred.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return cred;
      }
    });

    if (changed) {
      this.store.set('credentials', migrated);
      log('[CredentialsStore] Migrated legacy credential encryption to stable key');
    }
  }

  /**
   * Encrypt a password
   */
  private encrypt(text: string): { encrypted: string; iv: string } {
    return this.encryptWithKey(text, CredentialsStore.getPrimaryKey());
  }

  /**
   * Decrypt a password
   */
  private decrypt(encrypted: string, iv: string): string {
    return this.decryptWithFallback(encrypted, iv).decrypted;
  }

  /**
   * Get all credentials (with decrypted passwords).
   * Credentials that fail decryption are skipped and logged rather than
   * crashing the entire lookup — guards against a single corrupt entry
   * making all credentials inaccessible.
   */
  getAll(): UserCredential[] {
    const stored = this.store.get('credentials', []);
    const results: UserCredential[] = [];

    for (const cred of stored) {
      try {
        results.push({
          id: cred.id,
          name: cred.name,
          type: cred.type,
          service: cred.service,
          username: cred.username,
          password: this.decrypt(cred.encryptedPassword, cred.iv),
          url: cred.url,
          notes: cred.notes,
          createdAt: cred.createdAt,
          updatedAt: cred.updatedAt,
        });
      } catch (error) {
        logWarn('[CredentialsStore] Skipping corrupt credential — decryption failed', {
          id: cred.id,
          name: cred.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Get all credentials without passwords (for UI display)
   */
  getAllSafe(): Omit<UserCredential, 'password'>[] {
    const stored = this.store.get('credentials', []);
    return stored.map((cred) => ({
      id: cred.id,
      name: cred.name,
      type: cred.type,
      service: cred.service,
      username: cred.username,
      url: cred.url,
      notes: cred.notes,
      createdAt: cred.createdAt,
      updatedAt: cred.updatedAt,
    }));
  }

  /**
   * Get a single credential by ID
   */
  getById(id: string): UserCredential | undefined {
    const all = this.getAll();
    return all.find((c) => c.id === id);
  }

  /**
   * Get credentials by type
   */
  getByType(type: UserCredential['type']): UserCredential[] {
    return this.getAll().filter((c) => c.type === type);
  }

  /**
   * Get credentials by service name
   */
  getByService(service: string): UserCredential[] {
    return this.getAll().filter(
      (c) => c.service?.toLowerCase() === service.toLowerCase()
    );
  }

  /**
   * Save a new credential
   */
  save(credential: Omit<UserCredential, 'id' | 'createdAt' | 'updatedAt'>): UserCredential {
    const now = new Date().toISOString();
    const id = `cred-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const { encrypted, iv } = this.encrypt(credential.password);
    
    const stored: StoredCredential = {
      id,
      name: credential.name,
      type: credential.type,
      service: credential.service,
      username: credential.username,
      encryptedPassword: encrypted,
      iv,
      url: credential.url,
      notes: credential.notes,
      createdAt: now,
      updatedAt: now,
    };

    const credentials = this.store.get('credentials', []);
    credentials.push(stored);
    this.store.set('credentials', credentials);

    log(`[CredentialsStore] Saved credential: ${credential.name}`);

    return {
      id,
      ...credential,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Update an existing credential
   */
  update(id: string, updates: Partial<Omit<UserCredential, 'id' | 'createdAt' | 'updatedAt'>>): UserCredential | undefined {
    const credentials = this.store.get('credentials', []);
    const index = credentials.findIndex((c) => c.id === id);
    
    if (index === -1) {
      return undefined;
    }

    const existing = credentials[index];
    const now = new Date().toISOString();

    // Handle password update
    let encryptedPassword = existing.encryptedPassword;
    let iv = existing.iv;
    if (updates.password) {
      const encrypted = this.encrypt(updates.password);
      encryptedPassword = encrypted.encrypted;
      iv = encrypted.iv;
    }

    const updated: StoredCredential = {
      ...existing,
      name: updates.name ?? existing.name,
      type: updates.type ?? existing.type,
      service: updates.service ?? existing.service,
      username: updates.username ?? existing.username,
      encryptedPassword,
      iv,
      url: updates.url ?? existing.url,
      notes: updates.notes ?? existing.notes,
      updatedAt: now,
    };

    credentials[index] = updated;
    this.store.set('credentials', credentials);

    log(`[CredentialsStore] Updated credential: ${updated.name}`);

    return {
      id: updated.id,
      name: updated.name,
      type: updated.type,
      service: updated.service,
      username: updated.username,
      password: this.decrypt(updated.encryptedPassword, updated.iv),
      url: updated.url,
      notes: updated.notes,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Delete a credential
   */
  delete(id: string): boolean {
    const credentials = this.store.get('credentials', []);
    const index = credentials.findIndex((c) => c.id === id);
    
    if (index === -1) {
      return false;
    }

    const deleted = credentials.splice(index, 1)[0];
    this.store.set('credentials', credentials);

    log(`[CredentialsStore] Deleted credential: ${deleted.name}`);
    return true;
  }

  /**
   * Clear all credentials
   */
  clearAll(): void {
    this.store.set('credentials', []);
    log('[CredentialsStore] Cleared all credentials');
  }
}

// Export singleton instance
export const credentialsStore = new CredentialsStore();
