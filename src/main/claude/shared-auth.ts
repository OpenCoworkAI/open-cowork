import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';

// Singleton — safe because Electron main process is single-threaded.
// AuthStorage.create() is synchronous, so no async race possible.
let sharedAuthStorage: AuthStorage | null = null;

export function getSharedAuthStorage(): AuthStorage {
  if (!sharedAuthStorage) {
    sharedAuthStorage = AuthStorage.create();
  }
  return sharedAuthStorage;
}

export { AuthStorage, ModelRegistry };
