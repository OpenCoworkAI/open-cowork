import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import type { AuthStorageBackend } from '@mariozechner/pi-coding-agent';

export interface CredentialProtector {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

/** SDK locking and refresh semantics, with only ciphertext persisted on disk. */
export class EncryptedAuthBackend implements AuthStorageBackend {
  constructor(
    private readonly lock: AuthStorageBackend,
    private readonly filename: string,
    private readonly protector: CredentialProtector
  ) {}

  private assertEncryption(): void {
    if (
      !this.protector.isEncryptionAvailable() ||
      this.protector.getSelectedStorageBackend?.() === 'basic_text'
    ) {
      throw new Error('Operating-system credential encryption is unavailable.');
    }
  }

  private read(): string | undefined {
    if (!fs.existsSync(this.filename)) return undefined;
    this.assertEncryption();
    return this.protector.decryptString(fs.readFileSync(this.filename));
  }

  private write(value: string): void {
    this.assertEncryption();
    const encrypted = this.protector.encryptString(value);
    const directory = path.dirname(this.filename);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `.credentials-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.filename);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  withLock<T>(fn: (current: string | undefined) => { result: T; next?: string }): T {
    return this.lock.withLock(() => {
      const { result, next } = fn(this.read());
      if (next !== undefined) this.write(next);
      return { result };
    });
  }

  withLockAsync<T>(
    fn: (current: string | undefined) => Promise<{ result: T; next?: string }>
  ): Promise<T> {
    return this.lock.withLockAsync(async () => {
      const { result, next } = await fn(this.read());
      if (next !== undefined) this.write(next);
      return { result };
    });
  }
}
