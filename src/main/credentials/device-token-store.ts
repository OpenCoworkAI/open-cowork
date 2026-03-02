/**
 * Device Token Store
 *
 * Manages Coeadapt device tokens for background/headless API access.
 * Tokens are generated via Clerk JWT, then stored locally (encrypted)
 * so MCP servers and background processes can call the API.
 */

import Store from 'electron-store';
import * as crypto from 'crypto';
import { log, logError, logWarn } from '../utils/logger';

interface StoredDeviceToken {
  token: string;     // encrypted
  iv: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

interface DeviceTokenData {
  credentials: StoredDeviceToken | null;
}

class DeviceTokenStore {
  private store: Store<DeviceTokenData>;
  private encryptionKey: Buffer;

  constructor() {
    this.store = new Store<DeviceTokenData>({
      name: 'coeadapt-device-token',
      projectName: 'coeadapt',
      defaults: { credentials: null },
    } as any);
    this.encryptionKey = this.getOrCreateKey();
  }

  private getOrCreateKey(): Buffer {
    const keyStore = new Store<{ key: string }>({ name: 'coeadapt-token-key', projectName: 'coeadapt' } as any);
    let key = keyStore.get('key');
    if (!key) {
      key = crypto.randomBytes(32).toString('hex');
      keyStore.set('key', key);
    }
    return Buffer.from(key, 'hex');
  }

  private encrypt(text: string): { encrypted: string; iv: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return { encrypted, iv: iv.toString('hex') };
  }

  private decrypt(encrypted: string, iv: string): string {
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      this.encryptionKey,
      Buffer.from(iv, 'hex'),
    );
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Store a device token (encrypted)
   */
  save(token: string, userId: string, expiresAt: string): void {
    const { encrypted, iv } = this.encrypt(token);
    this.store.set('credentials', {
      token: encrypted,
      iv,
      userId,
      expiresAt,
      createdAt: new Date().toISOString(),
    });
    log('[DeviceTokenStore] Token saved for user:', userId);
  }

  /**
   * Retrieve the decrypted device token, or null if none/expired
   */
  getToken(): string | null {
    const stored = this.store.get('credentials');
    if (!stored) return null;

    // Check expiration
    if (new Date(stored.expiresAt) <= new Date()) {
      logWarn('[DeviceTokenStore] Token expired, clearing');
      this.clear();
      return null;
    }

    try {
      return this.decrypt(stored.token, stored.iv);
    } catch (err) {
      logError('[DeviceTokenStore] Failed to decrypt token:', err);
      this.clear();
      return null;
    }
  }

  /**
   * Get stored metadata (without decrypting the token)
   */
  getMetadata(): { userId: string; expiresAt: string; createdAt: string } | null {
    const stored = this.store.get('credentials');
    if (!stored) return null;
    return {
      userId: stored.userId,
      expiresAt: stored.expiresAt,
      createdAt: stored.createdAt,
    };
  }

  /**
   * Check if a valid (non-expired) token exists
   */
  hasValidToken(): boolean {
    const stored = this.store.get('credentials');
    if (!stored) return false;
    return new Date(stored.expiresAt) > new Date();
  }

  /**
   * Clear stored token
   */
  clear(): void {
    this.store.set('credentials', null);
    log('[DeviceTokenStore] Token cleared');
  }

  /**
   * Generate a new device token from the Coeadapt API using a Clerk JWT,
   * then store it locally.
   */
  async generateAndStore(
    clerkJwt: string,
    apiBaseUrl: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${apiBaseUrl}/api/career-box/generate-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${clerkJwt}`,
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        return { success: false, error: `HTTP ${res.status}: ${text}` };
      }

      const data = await res.json() as { token: string; expiresAt: string; userId?: string };
      this.save(data.token, data.userId || 'unknown', data.expiresAt);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError('[DeviceTokenStore] generateAndStore failed:', msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Verify the stored token against the Coeadapt API
   */
  async verify(
    apiBaseUrl: string,
  ): Promise<{ valid: boolean; error?: string }> {
    const token = this.getToken();
    if (!token) {
      return { valid: false, error: 'No token stored' };
    }

    try {
      const res = await fetch(`${apiBaseUrl}/api/career-box/verify-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        this.clear();
        return { valid: false, error: `HTTP ${res.status}` };
      }

      const data = await res.json() as { valid: boolean };
      if (!data.valid) {
        this.clear();
      }
      return { valid: data.valid };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError('[DeviceTokenStore] verify failed:', msg);
      return { valid: false, error: msg };
    }
  }
}

export const deviceTokenStore = new DeviceTokenStore();
