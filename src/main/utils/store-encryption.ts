import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import Store, { type Options as StoreOptions } from 'electron-store';

type Logger = (...args: unknown[]) => void;

interface EncryptedStoreRotationOptions<T extends Record<string, unknown>> {
  stableKey: string;
  legacyKeys: string[];
  storeOptions: StoreOptions<T> & { projectName?: string };
  logPrefix: string;
  log?: Logger;
  warn?: Logger;
}

interface KeyMaterialOptions {
  moduleDirname: string;
  stableSeed: string;
  legacySeed: string;
  salt: string;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildLegacyDirCandidates(moduleDirname: string): string[] {
  const candidates = [moduleDirname, path.resolve(process.cwd(), 'dist-electron', 'main')];

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'app.asar', 'dist-electron', 'main'));
  }

  return uniqueValues(candidates);
}

/** Secure scrypt parameters for new key derivation. */
const SCRYPT_MAXMEM_HEADROOM = 1024 * 1024;

function createScryptOptions(N: number, r: number, p: number): crypto.ScryptOptions {
  return {
    N,
    r,
    p,
    maxmem: 128 * N * r + SCRYPT_MAXMEM_HEADROOM,
  };
}

export const SECURE_SCRYPT_OPTIONS: crypto.ScryptOptions = createScryptOptions(65536, 8, 1);

/** Legacy scrypt parameters — Node.js defaults used by earlier releases. */
export const LEGACY_SCRYPT_OPTIONS: crypto.ScryptOptions = createScryptOptions(16384, 8, 1);

function deriveKeyBuffer(
  seed: string,
  salt: string,
  options: crypto.ScryptOptions = SECURE_SCRYPT_OPTIONS
): Buffer {
  return crypto.scryptSync(seed, salt, 32, options);
}

function deriveKeyHex(seed: string, salt: string, options?: crypto.ScryptOptions): string {
  return deriveKeyBuffer(seed, salt, options).toString('hex');
}

function isLikelyKeyMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bUnexpected token\b|\bvalid JSON\b|\bbad decrypt\b|\bdecrypt\b|\bJSON\b/i.test(message);
}

function buildBackupPath(storePath: string, reason: string = 'pre-key-rotation'): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${storePath}.${reason}-${timestamp}.bak`;
}

function resolveStoreName<T extends Record<string, unknown>>(
  storeOptions: StoreOptions<T>
): string {
  return typeof storeOptions.name === 'string' && storeOptions.name.trim()
    ? storeOptions.name.trim()
    : 'config';
}

function resolveStorePath<T extends Record<string, unknown>>(
  storeOptions: StoreOptions<T> & { projectName?: string }
): string | null {
  const name = resolveStoreName(storeOptions);

  const explicitCwd = (storeOptions as { cwd?: string }).cwd;
  if (typeof explicitCwd === 'string' && explicitCwd.trim()) {
    return path.join(path.resolve(explicitCwd), `${name}.json`);
  }

  try {
    if (app && typeof app.getPath === 'function') {
      const userDataPath = app.getPath('userData');
      if (userDataPath?.trim()) {
        return path.join(userDataPath, `${name}.json`);
      }
    }
  } catch {
    // Fall back to letting electron-store resolve the path itself.
  }

  return null;
}

function moveUnreadableStoreToBackup(storePath: string): string {
  const backupPath = buildBackupPath(storePath, 'unreadable-recovery');

  try {
    fs.renameSync(storePath, backupPath);
    return backupPath;
  } catch {
    fs.copyFileSync(storePath, backupPath);
    fs.unlinkSync(storePath);
    return backupPath;
  }
}

export function getLegacyDerivedKeyHexes(options: KeyMaterialOptions): string[] {
  return buildLegacyDirCandidates(options.moduleDirname).map((dir) =>
    deriveKeyHex(
      `${os.hostname()}:${dir}:${options.legacySeed}`,
      options.salt,
      LEGACY_SCRYPT_OPTIONS
    )
  );
}

export function getStableDerivedKeyBuffer(options: KeyMaterialOptions): Buffer {
  return deriveKeyBuffer(options.stableSeed, options.salt, SECURE_SCRYPT_OPTIONS);
}

export function getLegacyDerivedKeyBuffers(options: KeyMaterialOptions): Buffer[] {
  return buildLegacyDirCandidates(options.moduleDirname).map((dir) =>
    deriveKeyBuffer(
      `${os.hostname()}:${dir}:${options.legacySeed}`,
      options.salt,
      LEGACY_SCRYPT_OPTIONS
    )
  );
}

export function createEncryptedStoreWithKeyRotation<T extends Record<string, unknown>>(
  options: EncryptedStoreRotationOptions<T>
): Store<T> {
  const stableKey = options.stableKey;
  const legacyKeys = uniqueValues(options.legacyKeys);

  try {
    return new Store<T>({
      ...(options.storeOptions as StoreOptions<T>),
      encryptionKey: stableKey,
    });
  } catch (error) {
    if (!isLikelyKeyMismatch(error)) {
      throw error;
    }

    const failedAttempts: string[] = [
      `stable key: ${error instanceof Error ? error.message : String(error)}`,
    ];

    for (const legacyKey of legacyKeys) {
      try {
        const legacyStore = new Store<T>({
          ...(options.storeOptions as StoreOptions<T>),
          encryptionKey: legacyKey,
        });
        const snapshot = legacyStore.store as T;
        const storePath = legacyStore.path;

        // Write the new store with the stable key FIRST so data is safe on disk
        // before we touch the old file. If the process crashes after this point,
        // the new store already holds all data and will be used on next startup.
        const stableStore = new Store<T>({
          ...(options.storeOptions as StoreOptions<T>),
          encryptionKey: stableKey,
        });
        stableStore.store = snapshot;

        // Now that the new store is safely written, back up the old file.
        // electron-store may have already replaced it when we opened stableStore
        // above, so we only move it if it still exists.
        if (fs.existsSync(storePath)) {
          const backupPath = buildBackupPath(storePath);
          try {
            fs.renameSync(storePath, backupPath);
          } catch {
            // renameSync can fail across devices; fall back to copy + delete.
            fs.copyFileSync(storePath, backupPath);
            fs.unlinkSync(storePath);
          }
          options.log?.(`${options.logPrefix} Migrating encrypted store to a stable key`, {
            storePath,
            backupPath,
          });
        }

        return stableStore;
      } catch (legacyError) {
        if (!isLikelyKeyMismatch(legacyError)) {
          throw legacyError;
        }
        failedAttempts.push(
          `legacy key: ${legacyError instanceof Error ? legacyError.message : String(legacyError)}`
        );
      }
    }

    const storePath = resolveStorePath(options.storeOptions);
    if (storePath && fs.existsSync(storePath)) {
      const backupPath = moveUnreadableStoreToBackup(storePath);
      options.warn?.(
        `${options.logPrefix} Backed up unreadable encrypted store and recreated defaults`,
        { storePath, backupPath }
      );

      return new Store<T>({
        ...(options.storeOptions as StoreOptions<T>),
        encryptionKey: stableKey,
      });
    }

    const aggregated = failedAttempts.join('; ');
    options.warn?.(
      `${options.logPrefix} Failed to read encrypted store with all keys: ${aggregated}`
    );
    throw new Error(`${options.logPrefix} All decryption keys failed: ${aggregated}`);
  }
}
