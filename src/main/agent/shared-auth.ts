import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent';

// Singleton promise — safe because Electron main process is single-threaded.
// ModelRuntime.create() is async, so concurrent callers share the same initialization.
let sharedModelRuntimePromise: Promise<ModelRuntime> | null = null;

export function getSharedAuthStorage(): Promise<ModelRuntime> {
  if (!sharedModelRuntimePromise) {
    sharedModelRuntimePromise = ModelRuntime.create();
  }
  return sharedModelRuntimePromise;
}

export { ModelRegistry, ModelRuntime };
