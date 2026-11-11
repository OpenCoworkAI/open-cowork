/**
 * afterSign hook for electron-builder.
 *
 * Notarizes the macOS .app bundle so it passes Gatekeeper on end-user machines.
 *
 * Required env vars (set in CI or locally):
 *   APPLE_ID              – Apple ID email
 *   APPLE_ID_PASSWORD     – App-specific password (NOT your Apple ID password)
 *   APPLE_TEAM_ID         – 10-char team identifier from developer.apple.com
 *
 * By default the hook skips notarization when those vars are missing, so local
 * dev builds work without credentials.
 *
 * Set MACOS_REQUIRE_NOTARIZATION=1 to make that a HARD failure instead of a
 * silent skip. This is what the signed CI job uses: without it, a release
 * whose Apple credentials are missing (but whose signing certificate is
 * present) would ship a signed-but-NOT-notarized bundle — green CI, broken
 * Gatekeeper for the end user, with no signal anywhere in the logs.
 */
const { notarize: defaultNotarize } = require('@electron/notarize');

/**
 * Core notarization logic.
 *
 * `notarizeImpl` is injectable so the fail-open / fail-closed contract can be
 * unit tested without shelling out to `codesign` / `notarytool`.
 */
async function notarizeApp(context, notarizeImpl) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appId = 'com.opencowork.app';
  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  const { APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID } = process.env;

  const missing = [
    ['APPLE_ID', APPLE_ID],
    ['APPLE_ID_PASSWORD', APPLE_ID_PASSWORD],
    ['APPLE_TEAM_ID', APPLE_TEAM_ID],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    const message =
      `[notarize] Missing Apple credentials: ${missing.join(', ')}. ` +
      `Notarization requires all three (APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID).`;

    // Fail closed when the caller explicitly asked for notarization.
    if (process.env.MACOS_REQUIRE_NOTARIZATION === '1') {
      throw new Error(
        `${message} MACOS_REQUIRE_NOTARIZATION=1 is set, so refusing to build an ` +
          `artifact that would be signed but not notarized.`
      );
    }

    console.log(`${message} Skipping (set MACOS_REQUIRE_NOTARIZATION=1 to make this fatal).`);
    return;
  }

  console.log(`[notarize] Notarizing ${appId} at ${appPath} ...`);

  await notarizeImpl({
    appBundleId: appId,
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_ID_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });

  console.log('[notarize] Done.');
}

exports.notarizeApp = notarizeApp;

exports.default = async function afterSign(context) {
  return notarizeApp(context, defaultNotarize);
};
