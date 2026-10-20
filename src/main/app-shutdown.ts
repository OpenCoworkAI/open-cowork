/**
 * Quit/shutdown coordination for the Electron main process.
 *
 * `before-quit` and `cleanupSandboxResources()` must not share one "in progress"
 * flag. If the handler sets `isCleaningUp` before calling cleanup, cleanup's own
 * guard returns immediately — sandbox sync-back is skipped and Cmd+Q needs a
 * second press (OpenCoworkAI/open-cowork#297).
 *
 * On macOS, the quit issued after that cleanup can still fail to terminate:
 * `before-quit` runs again with the latch set (no `preventDefault`), windows
 * close, and neither `will-quit` nor `quit` follows. The main process is left
 * alive with the database already closed. After `app.quit()`, a short grace
 * timer falls back to `app.exit(0)` and is cleared if the process does exit.
 */

export const SHUTDOWN_CLEANUP_TIMEOUT_MS = 60_000;

/** How long to wait for `app.quit()` to actually end the process. */
export const SHUTDOWN_QUIT_GRACE_MS = 1_000;

export type BeforeQuitAction = 'allow' | 'dev-fast-exit' | 'wait' | 'start-cleanup';

export function decideBeforeQuitAction(options: {
  quitReady: boolean;
  isCleaningUp: boolean;
  isDev: boolean;
}): BeforeQuitAction {
  if (options.quitReady) {
    return 'allow';
  }
  // Dev intentionally wins over an in-flight cleanup: local dev never needs to
  // block exit on sandbox sync-back.
  if (options.isDev) {
    return 'dev-fast-exit';
  }
  if (options.isCleaningUp) {
    return 'wait';
  }
  return 'start-cleanup';
}

/**
 * macOS production keeps the app running when the user closes the last window.
 * Windows, Linux, and macOS dev shut down instead.
 */
export function shouldShutdownWhenAllWindowsClosed(options: {
  platform: string;
  isDev: boolean;
  headless: boolean;
}): boolean {
  if (options.headless) {
    return false;
  }
  return options.platform !== 'darwin' || options.isDev;
}

/** Dock click must not recreate a window once quit cleanup has started. */
export function shouldReopenWindowOnActivate(options: {
  quitReady: boolean;
  isCleaningUp: boolean;
}): boolean {
  return !options.quitReady && !options.isCleaningUp;
}

/**
 * Windows are destroyed before SQLite is closed so renderer unload/IPC cannot
 * touch a connection that is already shut down.
 */
export function closeWindowsThenDatabase(steps: {
  destroyWindows: () => void;
  closeDatabase: () => void;
  closeLogs: () => void;
}): void {
  steps.destroyWindows();
  steps.closeDatabase();
  steps.closeLogs();
}

export function createSingleFlight(start: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  return () => {
    if (!inFlight) {
      inFlight = start();
    }
    return inFlight;
  };
}

export function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timer = undefined;
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  });
}

export async function runShutdownAndQuit(options: {
  cleanup: () => Promise<void>;
  quit: () => void;
  exit: (code: number) => void;
  onError: (error: unknown) => void;
  markQuitReady: () => void;
  /**
   * Install the callback Electron should invoke from `will-quit` / `quit`.
   * Must be registered before `quit()` so a synchronous accept clears the
   * grace timer instead of falling through to `exit`.
   */
  registerExitHook: (notifyExited: () => void) => void;
  timeoutMs?: number;
  graceMs?: number;
}): Promise<void> {
  try {
    await withTimeout(
      options.cleanup(),
      options.timeoutMs ?? SHUTDOWN_CLEANUP_TIMEOUT_MS,
      'Shutdown cleanup'
    );
  } catch (error) {
    options.onError(error);
  }

  let settled = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;

  const clearGraceTimer = (): void => {
    if (graceTimer !== undefined) {
      clearTimeout(graceTimer);
      graceTimer = undefined;
    }
  };

  const notifyExited = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    clearGraceTimer();
  };

  options.registerExitHook(notifyExited);
  options.markQuitReady();

  try {
    options.quit();
  } catch (error) {
    options.onError(error);
  }

  if (settled) {
    return;
  }

  const graceMs = options.graceMs ?? SHUTDOWN_QUIT_GRACE_MS;
  graceTimer = setTimeout(() => {
    const pending = graceTimer;
    graceTimer = undefined;
    if (pending !== undefined) {
      clearTimeout(pending);
    }
    if (settled) {
      return;
    }
    settled = true;
    options.exit(0);
  }, graceMs);
}
