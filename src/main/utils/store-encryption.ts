import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import Store, { type Options as StoreOptions } from 'electron-store';

type Logger = (...args: unknown[]) => void;

interface EncryptedStoreRotationOptions<T extends Record<string, any>> {
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
  const candidates = [
    moduleDirname,
    path.resolve(process.cwd(), 'dist-electron', 'main'),
  ];

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'app.asar', 'dist-electron', 'main'));
  }

  return uniqueValues(candidates);
}

function deriveKeyBuffer(seed: string, salt: string): Buffer {
  return crypto.scryptSync(seed, salt, 32);
}

function deriveKeyHex(seed: string, salt: string): string {
  return deriveKeyBuffer(seed, salt).toString('hex');
}

function isLikelyKeyMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Unexpected token|valid JSON|bad decrypt|decrypt|JSON/i.test(message);
}

function buildBackupPath(storePath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${storePath}.pre-key-rotation-${timestamp}.bak`;
}

function resolveStorePath<T extends Record<string, any>>(
  storeOptions: StoreOptions<T> & { projectName?: string }
): string | null {
  const explicitCwd = (storeOptions as { cwd?: string }).cwd;
  if (typeof explicitCwd === 'string' && explicitCwd.trim()) {
    const name = typeof storeOptions.name === 'string' && storeOptions.name.trim()
      ? storeOptions.name.trim()
      : 'config';
    return path.join(path.resolve(explicitCwd), `${name}.json`);
  }

  try {
    if (app && typeof app.getPath === 'function') {
      const userDataPath = app.getPath('userData');
      if (userDataPath?.trim()) {
        const name = typeof storeOptions.name === 'string' && storeOptions.name.trim()
          ? storeOptions.name.trim()
          : 'config';
        return path.join(userDataPath, `${name}.json`);
      }
    }
  } catch {
    // Fall back to letting electron-store resolve the path itself.
  }

  return null;
}

function moveUnreadableStoreToBackup(storePath: string): string {
  const backupPath = buildBackupPath(storePath);

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
    deriveKeyHex(`${os.hostname()}:${dir}:${options.legacySeed}`, options.salt)
  );
}

export function getStableDerivedKeyBuffer(options: KeyMaterialOptions): Buffer {
  return deriveKeyBuffer(options.stableSeed, options.salt);
}

export function getLegacyDerivedKeyBuffers(options: KeyMaterialOptions): Buffer[] {
  return buildLegacyDirCandidates(options.moduleDirname).map((dir) =>
    deriveKeyBuffer(`${os.hostname()}:${dir}:${options.legacySeed}`, options.salt)
  );
}

export function createEncryptedStoreWithKeyRotation<T extends Record<string, any>>(
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

    for (const legacyKey of legacyKeys) {
      try {
        const legacyStore = new Store<T>({
          ...(options.storeOptions as StoreOptions<T>),
          encryptionKey: legacyKey,
        });
        const snapshot = legacyStore.store as T;
        const storePath = legacyStore.path;

        if (fs.existsSync(storePath)) {
          const backupPath = buildBackupPath(storePath);
          fs.copyFileSync(storePath, backupPath);
          fs.unlinkSync(storePath);
          options.log?.(
            `${options.logPrefix} Migrating encrypted store to a stable key`,
            { storePath, backupPath }
          );
        }

        const stableStore = new Store<T>({
          ...(options.storeOptions as StoreOptions<T>),
          encryptionKey: stableKey,
        });
        stableStore.store = snapshot;
        return stableStore;
      } catch (legacyError) {
        if (!isLikelyKeyMismatch(legacyError)) {
          throw legacyError;
        }
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

    options.warn?.(
      `${options.logPrefix} Failed to read encrypted store with both stable and legacy keys`
    );
    throw error;
  }
}
