import { ModelRuntime } from '@earendil-works/pi-coding-agent';

// Singleton — safe because Electron main process is single-threaded.
// We store the promise itself, so concurrent callers share one creation.
let sharedModelRuntime: Promise<ModelRuntime> | null = null;

export function getSharedModelRuntime(): Promise<ModelRuntime> {
  if (!sharedModelRuntime) {
    sharedModelRuntime = ModelRuntime.create().catch((err) => {
      sharedModelRuntime = null;
      throw err;
    });
  }
  return sharedModelRuntime;
}
