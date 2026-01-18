import Store from 'electron-store';
import * as crypto from 'crypto';

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
  private encryptionKey: Buffer;

  constructor() {
    this.store = new Store<{ credentials: StoredCredential[] }>({
      name: 'credentials',
      defaults: {
        credentials: [],
      },
    });

    // Generate or retrieve encryption key
    // In production, this should be derived from a master password or system keychain
    this.encryptionKey = this.getOrCreateEncryptionKey();
  }

  /**
   * Get or create encryption key
   * Stored separately from credentials for security
   */
  private getOrCreateEncryptionKey(): Buffer {
    const keyStore = new Store<{ key: string }>({ name: 'credentials-key' });
    let key = keyStore.get('key');
    
    if (!key) {
      // Generate a new 256-bit key
      key = crypto.randomBytes(32).toString('hex');
      keyStore.set('key', key);
    }
    
    return Buffer.from(key, 'hex');
  }

  /**
   * Encrypt a password
   */
  private encrypt(text: string): { encrypted: string; iv: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return {
      encrypted,
      iv: iv.toString('hex'),
    };
  }

  /**
   * Decrypt a password
   */
  private decrypt(encrypted: string, iv: string): string {
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      this.encryptionKey,
      Buffer.from(iv, 'hex')
    );
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
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

    console.log(`[CredentialsStore] Saved credential: ${credential.name}`);

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

    console.log(`[CredentialsStore] Updated credential: ${updated.name}`);

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

    console.log(`[CredentialsStore] Deleted credential: ${deleted.name}`);
    return true;
  }

  /**
   * Clear all credentials
   */
  clearAll(): void {
    this.store.set('credentials', []);
    console.log('[CredentialsStore] Cleared all credentials');
  }
}

// Export singleton instance
export const credentialsStore = new CredentialsStore();
