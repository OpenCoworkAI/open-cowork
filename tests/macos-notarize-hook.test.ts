import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Locks the fail-open / fail-closed behaviour of the macOS notarization hook.
 *
 * Background: `scripts/notarize.js` is the electron-builder `afterSign` hook.
 * Historically it silently skipped notarization when the Apple credentials
 * were missing. That is fine for a local dev build, but in the signed CI job
 * it meant a release could ship a bundle that was signed but NOT notarized:
 * green CI, Gatekeeper refusing to open the app on the end-user machine, and
 * no signal in the logs.
 *
 * The hook therefore honours `MACOS_REQUIRE_NOTARIZATION=1`, which the signed
 * CI job sets. These tests pin that contract so it cannot regress silently.
 *
 * The core logic is exercised through the injectable `notarizeApp` export:
 * the hook is CommonJS and calls `require('@electron/notarize')` statically,
 * which vitest's module mocking cannot intercept.
 */

type AfterSignContext = {
  electronPlatformName: string;
  appOutDir: string;
  packager: { appInfo: { productFilename: string } };
};

type NotarizeApp = (
  context: AfterSignContext,
  notarizeImpl: (options: {
    appBundleId: string;
    appPath: string;
    appleId: string;
    appleIdPassword: string;
    teamId: string;
  }) => Promise<void>,
) => Promise<void>;

const makeContext = (electronPlatformName = 'darwin'): AfterSignContext => ({
  electronPlatformName,
  appOutDir: '/tmp/electron-builder-out',
  packager: { appInfo: { productFilename: 'Open Cowork' } },
});

const APPLE_ENV_KEYS = [
  'APPLE_ID',
  'APPLE_ID_PASSWORD',
  'APPLE_TEAM_ID',
  'MACOS_REQUIRE_NOTARIZATION',
] as const;

const fullAppleCredentials = {
  APPLE_ID: 'release@example.com',
  APPLE_ID_PASSWORD: 'app-specific-password',
  APPLE_TEAM_ID: 'ABCDE12345',
};

const loadNotarizeApp = async (): Promise<NotarizeApp> => {
  const module = await import('../scripts/notarize.js');
  return (module as unknown as { notarizeApp: NotarizeApp }).notarizeApp;
};

describe('scripts/notarize.js', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of APPLE_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of APPLE_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('throws when notarization is required but every Apple credential is missing', async () => {
    process.env.MACOS_REQUIRE_NOTARIZATION = '1';
    const notarizeApp = await loadNotarizeApp();
    const notarize = vi.fn();

    await expect(notarizeApp(makeContext(), notarize)).rejects.toThrow(/Missing Apple credentials/);
    expect(notarize).not.toHaveBeenCalled();
  });

  it.each([
    ['APPLE_ID', { APPLE_ID_PASSWORD: 'pwd', APPLE_TEAM_ID: 'ABCDE12345' }],
    ['APPLE_ID_PASSWORD', { APPLE_ID: 'release@example.com', APPLE_TEAM_ID: 'ABCDE12345' }],
    ['APPLE_TEAM_ID', { APPLE_ID: 'release@example.com', APPLE_ID_PASSWORD: 'pwd' }],
  ])('throws when notarization is required and only %s is missing', async (missing, present) => {
    process.env.MACOS_REQUIRE_NOTARIZATION = '1';
    Object.assign(process.env, present);
    const notarizeApp = await loadNotarizeApp();
    const notarize = vi.fn();

    await expect(notarizeApp(makeContext(), notarize)).rejects.toThrow(new RegExp(missing));
    expect(notarize).not.toHaveBeenCalled();
  });

  it('skips silently (fail-open) when notarization is not required', async () => {
    const notarizeApp = await loadNotarizeApp();
    const notarize = vi.fn();

    await expect(notarizeApp(makeContext(), notarize)).resolves.toBeUndefined();
    expect(notarize).not.toHaveBeenCalled();
  });

  it('notarizes when all Apple credentials are present', async () => {
    process.env.MACOS_REQUIRE_NOTARIZATION = '1';
    Object.assign(process.env, fullAppleCredentials);
    const notarizeApp = await loadNotarizeApp();
    const notarize = vi.fn().mockResolvedValue(undefined);

    await notarizeApp(makeContext(), notarize);

    expect(notarize).toHaveBeenCalledTimes(1);
    expect(notarize).toHaveBeenCalledWith({
      appBundleId: 'com.opencowork.app',
      appPath: '/tmp/electron-builder-out/Open Cowork.app',
      appleId: fullAppleCredentials.APPLE_ID,
      appleIdPassword: fullAppleCredentials.APPLE_ID_PASSWORD,
      teamId: fullAppleCredentials.APPLE_TEAM_ID,
    });
  });

  it('does nothing on non-darwin platforms even when notarization is required', async () => {
    process.env.MACOS_REQUIRE_NOTARIZATION = '1';
    Object.assign(process.env, fullAppleCredentials);
    const notarizeApp = await loadNotarizeApp();
    const notarize = vi.fn();

    await expect(notarizeApp(makeContext('win32'), notarize)).resolves.toBeUndefined();
    expect(notarize).not.toHaveBeenCalled();
  });

  it('propagates a notarization failure so the build fails', async () => {
    process.env.MACOS_REQUIRE_NOTARIZATION = '1';
    Object.assign(process.env, fullAppleCredentials);
    const notarizeApp = await loadNotarizeApp();
    const notarize = vi.fn().mockRejectedValue(new Error('notarytool rejected the bundle'));

    await expect(notarizeApp(makeContext(), notarize)).rejects.toThrow(/notarytool rejected the bundle/);
  });
});
