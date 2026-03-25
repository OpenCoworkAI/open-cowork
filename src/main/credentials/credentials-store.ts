import Store, { type Options as StoreOptions } from 'electron-store';
import * as crypto from 'crypto';
import * as os from 'os';
import { safeStorage } from 'electron';
import { log, logWarn } from '../utils/logger';
import {
  SECURE_SCRYPT_OPTIONS,
  getLegacyDerivedKeyBuffers,
  getStableDerivedKeyBuffer,
} from '../utils/store-encryption';

/**
 * User Credential - stored information for automated login
 */
export interface UserCredential {
  id: string;
  name: string; // Friendly name, e.g., "Work Gmail"
  type: 'email' | 'website' | 'api' | 'other';
  service?: string; // gmail, outlook, github, etc.
  username: string;
  password: string; // Encrypted in storage
  url?: string; // Optional: login URL
  notes?: string; // Optional: additional notes
  createdAt: string;
  updatedAt: string;
}

/**
 * Stored format with encrypted password
 */
interface StoredCredential extends Omit<UserCredential, 'password'> {
  encryptedPassword: string;
  iv: string;
  authTag?: string;
}

// ---------------------------------------------------------------------------
// Machine-bound key derivation
// ---------------------------------------------------------------------------

let _machineBoundKeyCache: Buffer | null = null;

/**
 * Derive a machine-bound encryption key.
 *
 * Primary strategy: generate a random 256-bit key once and protect it with
 * Electron's safeStorage (macOS Keychain / Windows DPAPI / Linux libsecret).
 *
 * Fallback (safeStorage unavailable): derive key from hostname + username so
 * the key is at least unique per OS installation.
 */
function getMachineBoundKey(): Buffer {
  if (_machineBoundKeyCache) return _machineBoundKeyCache;

  try {
    if (safeStorage.isEncryptionAvailable()) {
      const keyStore = new Store<{ encryptedMasterKey?: string }>({
        name: 'credentials-master-key',
        projectName: 'open-cowork',
        defaults: {},
      } as StoreOptions<{ encryptedMasterKey?: string }> & { projectName?: string });

      const stored = keyStore.get('encryptedMasterKey');
      if (stored) {
        const decrypted = safeStorage.decryptString(Buffer.from(stored, 'base64'));
        _machineBoundKeyCache = Buffer.from(decrypted, 'hex');
        return _machineBoundKeyCache;
      }

      // First run: generate and protect a new master key
      const masterKey = crypto.randomBytes(32);
      const encrypted = safeStorage.encryptString(masterKey.toString('hex'));
      keyStore.set('encryptedMasterKey', encrypted.toString('base64'));
      _machineBoundKeyCache = masterKey;
      log('[CredentialsStore] Generated machine-bound master key via safeStorage');
      return _machineBoundKeyCache;
    }
  } catch {
    // safeStorage unavailable (e.g., no keychain/keyring, CI, or app not ready)
  }

  // Fallback: derive from machine identity with a per-installation random salt
  const saltStore = new Store<{ fallbackSalt?: string }>({
    name: 'credentials-fallback-salt',
    projectName: 'open-cowork',
    defaults: {},
  } as StoreOptions<{ fallbackSalt?: string }> & { projectName?: string });

  let salt = saltStore.get('fallbackSalt');
  if (!salt) {
    salt = crypto.randomBytes(32).toString('hex');
    saltStore.set('fallbackSalt', salt);
  }

  const seed = `${os.hostname()}:${os.userInfo().username}:open-cowork-credentials-stable-v1`;
  _machineBoundKeyCache = crypto.scryptSync(seed, salt, 32, SECURE_SCRYPT_OPTIONS);
  log(
    '[CredentialsStore] Derived machine-bound key from hostname and username (safeStorage unavailable)'
  );
  return _machineBoundKeyCache;
}

/** Visible for testing — resets the cached machine-bound key. */
export function _resetMachineBoundKeyCache(): void {
  _machineBoundKeyCache = null;
}

// ---------------------------------------------------------------------------
// CredentialsStore
// ---------------------------------------------------------------------------

/**
 * Credentials Store - Securely stores user credentials with encryption
 */
class CredentialsStore {
  private store: Store<{ credentials: StoredCredential[] }>;
  private legacyKeyStore: Store<{ key?: string }>;

  constructor() {
    const storeOptions: StoreOptions<{ credentials: StoredCredential[] }> & {
      projectName?: string;
    } = {
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
    return getMachineBoundKey();
  }

  private static getFallbackKeys(): Buffer[] {
    const keys: Buffer[] = [];

    // Old hardcoded stable key (backward compat with data encrypted before
    // machine-bound key was introduced).
    keys.push(
      getStableDerivedKeyBuffer({
        moduleDirname: __dirname,
        stableSeed: 'open-cowork-credentials-stable-v1',
        legacySeed: 'open-cowork-credentials',
        salt: 'open-cowork-salt',
      })
    );

    // Legacy hostname-derived keys.
    keys.push(
      ...getLegacyDerivedKeyBuffers({
        moduleDirname: __dirname,
        stableSeed: 'open-cowork-credentials-stable-v1',
        legacySeed: 'open-cowork-credentials',
        salt: 'open-cowork-salt',
      })
    );

    return keys;
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

  // ---------------------------------------------------------------------------
  // AES-256-GCM encryption (with CBC fallback for legacy data)
  // ---------------------------------------------------------------------------

  private encryptWithKey(
    text: string,
    key: Buffer
  ): { encrypted: string; iv: string; authTag: string } {
    const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag,
    };
  }

  private decryptWithKey(encrypted: string, iv: string, key: Buffer, authTag?: string): string {
    if (authTag) {
      // GCM decryption
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }

    // CBC fallback for legacy data (no authTag stored)
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(iv, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private decryptWithFallback(
    encrypted: string,
    iv: string,
    authTag?: string
  ): { decrypted: string; needsRewrite: boolean } {
    try {
      return {
        decrypted: this.decryptWithKey(encrypted, iv, CredentialsStore.getPrimaryKey(), authTag),
        // Re-encrypt if the data was stored with CBC (no authTag) so it is
        // upgraded to GCM on next save.
        needsRewrite: !authTag,
      };
    } catch {
      const storedLegacyKey = this.getLegacyStoredKey();
      if (storedLegacyKey) {
        try {
          return {
            decrypted: this.decryptWithKey(encrypted, iv, storedLegacyKey, authTag),
            needsRewrite: true,
          };
        } catch {
          // Fall through to derived legacy keys.
        }
      }

      for (const key of CredentialsStore.getFallbackKeys()) {
        try {
          return {
            decrypted: this.decryptWithKey(encrypted, iv, key, authTag),
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
        const { decrypted, needsRewrite } = this.decryptWithFallback(
          cred.encryptedPassword,
          cred.iv,
          cred.authTag
        );
        if (!needsRewrite) {
          return cred;
        }

        changed = true;
        const next = this.encryptWithKey(decrypted, primaryKey);
        return {
          ...cred,
          encryptedPassword: next.encrypted,
          iv: next.iv,
          authTag: next.authTag,
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
  private encrypt(text: string): { encrypted: string; iv: string; authTag: string } {
    return this.encryptWithKey(text, CredentialsStore.getPrimaryKey());
  }

  /**
   * Decrypt a password
   */
  private decrypt(encrypted: string, iv: string, authTag?: string): string {
    return this.decryptWithFallback(encrypted, iv, authTag).decrypted;
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
          password: this.decrypt(cred.encryptedPassword, cred.iv, cred.authTag),
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
    return this.getAll().filter((c) => c.service?.toLowerCase() === service.toLowerCase());
  }

  /**
   * Save a new credential
   */
  save(credential: Omit<UserCredential, 'id' | 'createdAt' | 'updatedAt'>): UserCredential {
    const now = new Date().toISOString();
    const id = `cred-${Date.now()}-${crypto.randomUUID().slice(0, 9)}`;

    const { encrypted, iv, authTag } = this.encrypt(credential.password);

    const stored: StoredCredential = {
      id,
      name: credential.name,
      type: credential.type,
      service: credential.service,
      username: credential.username,
      encryptedPassword: encrypted,
      iv,
      authTag,
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
  update(
    id: string,
    updates: Partial<Omit<UserCredential, 'id' | 'createdAt' | 'updatedAt'>>
  ): UserCredential | undefined {
    const credentials = this.store.get('credentials', []);
    const index = credentials.findIndex((c) => c.id === id);

    if (index === -1) {
      return undefined;
    }

    const existing = credentials[index];
    const now = new Date().toISOString();

    // Handle password update — use !== undefined so empty string is accepted.
    let encryptedPassword = existing.encryptedPassword;
    let iv = existing.iv;
    let authTag = existing.authTag;
    if (updates.password !== undefined) {
      const encrypted = this.encrypt(updates.password);
      encryptedPassword = encrypted.encrypted;
      iv = encrypted.iv;
      authTag = encrypted.authTag;
    }

    const updated: StoredCredential = {
      ...existing,
      name: updates.name ?? existing.name,
      type: updates.type ?? existing.type,
      service: updates.service ?? existing.service,
      username: updates.username ?? existing.username,
      encryptedPassword,
      iv,
      authTag,
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
      password: this.decrypt(updated.encryptedPassword, updated.iv, updated.authTag),
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
