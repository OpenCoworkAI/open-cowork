import { AuthStorage, FileAuthStorageBackend, ModelRegistry } from '@mariozechner/pi-coding-agent';
import { app, safeStorage } from 'electron';
import path from 'node:path';
import { EncryptedAuthBackend } from '../auth/encrypted-auth-backend';

// Singleton — safe because Electron main process is single-threaded.
// AuthStorage.create() is synchronous, so no async race possible.
let sharedAuthStorage: AuthStorage | null = null;
let codexAuthStorage: AuthStorage | null = null;

export function getSharedAuthStorage(provider?: string): AuthStorage {
  if (provider === 'openai-codex') {
    if (!codexAuthStorage) {
      const directory = path.join(app.getPath('userData'), 'auth');
      codexAuthStorage = AuthStorage.fromStorage(
        new EncryptedAuthBackend(
          // The SDK lock file contains no credentials; token reads/writes and
          // refresh exchanges share this app-private cross-process lock.
          new FileAuthStorageBackend(path.join(directory, 'codex-lock.json')),
          path.join(directory, 'codex-credentials.bin'),
          {
            isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
            encryptString: (value) => safeStorage.encryptString(value),
            decryptString: (value) => safeStorage.decryptString(value),
            getSelectedStorageBackend: () =>
              process.platform === 'linux'
                ? safeStorage.getSelectedStorageBackend()
                : 'os-keychain',
          }
        )
      );
    }
    // An instance can be constructed before app.ready, when OS encryption is
    // not yet available. Retry loading once a request reaches the ready app.
    codexAuthStorage.reload();
    return codexAuthStorage;
  }
  if (!sharedAuthStorage) {
    sharedAuthStorage = AuthStorage.create();
  }
  return sharedAuthStorage;
}

export { AuthStorage, ModelRegistry };
