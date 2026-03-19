import Store from 'electron-store';
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
    const storeOptions: any = {
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

  private decryptWithFallback(
    encrypted: string,
    iv: string
  ): { decrypted: string; needsRewrite: boolean } {
    try {
      return {
        decrypted: this.decryptWithKey(encrypted, iv, CredentialsStore.getPrimaryKey()),
        needsRewrite: false,
      };
    } catch {
      const storedLegacyKey = this.getLegacyStoredKey();
      if (storedLegacyKey) {
        try {
          return {
            decrypted: this.decryptWithKey(encrypted, iv, storedLegacyKey),
            needsRewrite: true,
          };
        } catch {
          // Fall through to derived legacy keys.
        }
      }

      for (const key of CredentialsStore.getFallbackKeys()) {
        try {
          return {
            decrypted: this.decryptWithKey(encrypted, iv, key),
            needsRewrite: true,
          };
        } catch {
          // Try next legacy key candidate.
        }
      }
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
   * Get all credentials (with decrypted passwords)
   */
  getAll(): UserCredential[] {
    const stored = this.store.get('credentials', []);
    return stored.map((cred) => ({
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
    }));
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
