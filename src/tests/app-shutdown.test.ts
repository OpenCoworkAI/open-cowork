import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SHUTDOWN_CLEANUP_TIMEOUT_MS,
  SHUTDOWN_QUIT_GRACE_MS,
  type BeforeQuitAction,
  closeWindowsThenDatabase,
  createSingleFlight,
  decideBeforeQuitAction,
  runShutdownAndQuit,
  shouldReopenWindowOnActivate,
  shouldShutdownWhenAllWindowsClosed,
  withTimeout,
} from '../main/app-shutdown';

describe('decideBeforeQuitAction', () => {
  it('lets the final re-issued quit through once cleanup finished', () => {
    expect(decideBeforeQuitAction({ quitReady: true, isCleaningUp: true, isDev: false })).toBe(
      'allow'
    );
  });

  it('uses the fast path in dev instead of async sandbox cleanup', () => {
    expect(decideBeforeQuitAction({ quitReady: false, isCleaningUp: false, isDev: true })).toBe(
      'dev-fast-exit'
    );
  });

  it('prefers dev fast-exit even while cleanup is already running', () => {
    expect(decideBeforeQuitAction({ quitReady: false, isCleaningUp: true, isDev: true })).toBe(
      'dev-fast-exit'
    );
  });

  it('defers a second Cmd+Q received while cleanup is still running', () => {
    expect(decideBeforeQuitAction({ quitReady: false, isCleaningUp: true, isDev: false })).toBe(
      'wait'
    );
  });

  it('starts cleanup on the first production quit without requiring a pre-set flag', () => {
    expect(decideBeforeQuitAction({ quitReady: false, isCleaningUp: false, isDev: false })).toBe(
      'start-cleanup'
    );
  });
});

describe('macOS window-close behaviour', () => {
  it('keeps a production macOS app alive when the last window closes', () => {
    expect(
      shouldShutdownWhenAllWindowsClosed({ platform: 'darwin', isDev: false, headless: false })
    ).toBe(false);
  });

  it('still shuts down when the last window closes on Windows, Linux, and macOS dev', () => {
    expect(
      shouldShutdownWhenAllWindowsClosed({ platform: 'win32', isDev: false, headless: false })
    ).toBe(true);
    expect(
      shouldShutdownWhenAllWindowsClosed({ platform: 'linux', isDev: false, headless: false })
    ).toBe(true);
    expect(
      shouldShutdownWhenAllWindowsClosed({ platform: 'darwin', isDev: true, headless: false })
    ).toBe(true);
  });

  it('does not shut down from window-all-closed in headless mode', () => {
    expect(
      shouldShutdownWhenAllWindowsClosed({ platform: 'win32', isDev: false, headless: true })
    ).toBe(false);
  });

  it('does not reopen a window from activate once quit cleanup has started', () => {
    expect(shouldReopenWindowOnActivate({ quitReady: false, isCleaningUp: false })).toBe(true);
    expect(shouldReopenWindowOnActivate({ quitReady: false, isCleaningUp: true })).toBe(false);
    expect(shouldReopenWindowOnActivate({ quitReady: true, isCleaningUp: true })).toBe(false);
  });
});

describe('closeWindowsThenDatabase', () => {
  it('destroys windows before closing the database', () => {
    const order: string[] = [];

    closeWindowsThenDatabase({
      destroyWindows: () => {
        order.push('windows');
      },
      closeDatabase: () => {
        order.push('db');
      },
      closeLogs: () => {
        order.push('logs');
      },
    });

    expect(order).toEqual(['windows', 'db', 'logs']);
  });
});

describe('createSingleFlight', () => {
  it('runs one shutdown when quit is requested twice', async () => {
    let runs = 0;
    const start = createSingleFlight(async () => {
      runs += 1;
    });

    await Promise.all([start(), start()]);

    expect(runs).toBe(1);
  });
});

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the timer when the operation finishes', async () => {
    const pending = withTimeout(Promise.resolve('ok'), 60_000, 'Shutdown cleanup');

    await expect(pending).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timer when the operation times out', async () => {
    const pending = withTimeout(new Promise(() => undefined), 60_000, 'Shutdown cleanup');
    const assertion = expect(pending).rejects.toThrow('Shutdown cleanup timed out after 60000ms');

    await vi.advanceTimersByTimeAsync(60_000);

    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('runShutdownAndQuit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows the second before-quit through after the latch is set', async () => {
    let quitReady = false;
    let isCleaningUp = false;
    const decisions: Array<{ action: BeforeQuitAction; prevented: boolean }> = [];

    const onBeforeQuit = (): BeforeQuitAction => {
      const action = decideBeforeQuitAction({
        quitReady,
        isCleaningUp,
        isDev: false,
      });
      const prevented = action !== 'allow' && action !== 'dev-fast-exit';
      decisions.push({ action, prevented });
      return action;
    };

    expect(onBeforeQuit()).toBe('start-cleanup');
    isCleaningUp = true;

    let notifyExited: () => void = () => undefined;
    const exit = vi.fn();

    await runShutdownAndQuit({
      cleanup: async () => {
        expect(quitReady).toBe(false);
      },
      quit: () => {
        expect(quitReady).toBe(true);
        expect(onBeforeQuit()).toBe('allow');
        notifyExited();
      },
      exit,
      onError: () => {
        throw new Error('cleanup should succeed');
      },
      markQuitReady: () => {
        quitReady = true;
      },
      registerExitHook: (notify) => {
        notifyExited = notify;
      },
    });

    expect(decisions).toEqual([
      { action: 'start-cleanup', prevented: true },
      { action: 'allow', prevented: false },
    ]);
    expect(exit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs cleanup, then marks quit ready, then issues the real quit', async () => {
    const order: string[] = [];
    let notifyExited: () => void = () => undefined;

    await runShutdownAndQuit({
      cleanup: async () => {
        order.push('cleanup');
      },
      quit: () => {
        order.push('quit');
        notifyExited();
      },
      exit: () => {
        order.push('exit');
      },
      onError: () => {
        order.push('error');
      },
      markQuitReady: () => {
        order.push('ready');
      },
      registerExitHook: (notify) => {
        notifyExited = notify;
      },
    });

    expect(order).toEqual(['cleanup', 'ready', 'quit']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still marks ready and quits when cleanup fails, so Cmd+Q cannot strand the app', async () => {
    const order: string[] = [];
    const onError = vi.fn();
    let notifyExited: () => void = () => undefined;

    await runShutdownAndQuit({
      cleanup: async () => {
        throw new Error('sandbox hung');
      },
      quit: () => {
        order.push('quit');
        notifyExited();
      },
      exit: () => {
        order.push('exit');
      },
      onError: (error) => {
        onError(error);
        order.push('error');
      },
      markQuitReady: () => {
        order.push('ready');
      },
      registerExitHook: (notify) => {
        notifyExited = notify;
      },
    });

    expect(onError).toHaveBeenCalledOnce();
    expect(order).toEqual(['error', 'ready', 'quit']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('calls quit and falls back to exit when the process does not exit', async () => {
    const quit = vi.fn();
    const exit = vi.fn();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    await runShutdownAndQuit({
      cleanup: async () => undefined,
      quit,
      exit,
      onError: () => undefined,
      markQuitReady: () => undefined,
      registerExitHook: () => undefined,
      graceMs: SHUTDOWN_QUIT_GRACE_MS,
    });

    expect(quit).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(SHUTDOWN_QUIT_GRACE_MS);

    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the cleanup timeout and the grace timer once quit is accepted', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    let notifyExited: () => void = () => undefined;

    await runShutdownAndQuit({
      cleanup: async () => undefined,
      quit: () => undefined,
      exit: () => {
        throw new Error('exit should not run after will-quit');
      },
      onError: () => undefined,
      markQuitReady: () => undefined,
      registerExitHook: (notify) => {
        notifyExited = notify;
      },
      timeoutMs: SHUTDOWN_CLEANUP_TIMEOUT_MS,
      graceMs: SHUTDOWN_QUIT_GRACE_MS,
    });

    expect(vi.getTimerCount()).toBe(1);
    const clearsAfterCleanup = clearTimeoutSpy.mock.calls.length;
    expect(clearsAfterCleanup).toBeGreaterThan(0);

    notifyExited();

    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(clearsAfterCleanup);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(SHUTDOWN_QUIT_GRACE_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds cleanup with the shutdown timeout, then still quits and can force-exit', async () => {
    const quit = vi.fn();
    const exit = vi.fn();
    const onError = vi.fn();

    const pending = runShutdownAndQuit({
      cleanup: () => new Promise(() => undefined),
      quit,
      exit,
      onError,
      markQuitReady: () => undefined,
      registerExitHook: () => undefined,
      timeoutMs: SHUTDOWN_CLEANUP_TIMEOUT_MS,
      graceMs: SHUTDOWN_QUIT_GRACE_MS,
    });

    await vi.advanceTimersByTimeAsync(SHUTDOWN_CLEANUP_TIMEOUT_MS);
    await pending;

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe(
      `Shutdown cleanup timed out after ${SHUTDOWN_CLEANUP_TIMEOUT_MS}ms`
    );
    expect(quit).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(SHUTDOWN_QUIT_GRACE_MS);

    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
