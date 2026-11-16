#!/usr/bin/env node

/**
 * electron-builder afterAllArtifactBuild hook.
 *
 * Creates ULMO (LZMA) compressed DMG files from the `dir` target output.
 * We bypass electron-builder's built-in dmgbuild because it has two issues:
 * 1. Temporary DMG size estimation is too small for large apps
 * 2. Spotlight indexing causes "resource busy" on unmount
 *
 * Using `hdiutil create -srcfolder -format ULMO` directly is more reliable.
 * LZMA achieves ~85-87% compression ratio vs ~79% for zlib.
 *
 * The DMG includes an Applications symlink for drag-to-install UX.
 *
 * Requirements:
 * - macOS only (uses hdiutil)
 * - macOS 10.15 Catalina+ for ULMO support (already met by this project)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * @param {import('electron-builder').BuildResult} buildResult
 * @returns {string[]} Additional artifact paths
 */
module.exports = async function afterAllArtifactBuild(buildResult) {
  // Only run on macOS — hdiutil is macOS-only
  if (process.platform !== 'darwin') {
    return [];
  }

  const { outDir, configuration } = buildResult;
  const productName = configuration.productName || 'Open Cowork';
  const version = buildResult.configuration.buildVersion ||
    require(path.join(process.cwd(), 'package.json')).version;

  // Find the .app directory in the dir target output
  const macOutDirs = fs.readdirSync(outDir)
    // electron-builder uses `mac` for Intel and `mac-arm64` for Apple Silicon.
    .filter(d => d === 'mac' || d.startsWith('mac-'))
    .map(d => path.join(outDir, d));

  const createdDmgs = [];

  for (const macDir of macOutDirs) {
    const directoryName = path.basename(macDir);
    const arch = directoryName === 'mac' ? 'x64' : directoryName.replace('mac-', '');
    const appName = `${productName}.app`;
    const appPath = path.join(macDir, appName);

    if (!fs.existsSync(appPath)) {
      console.log(`[create-dmg] No .app found in ${macDir}, skipping.`);
      continue;
    }

    const dmgName = `${productName}-${version}-mac-${arch}.dmg`;
    const dmgPath = path.join(outDir, dmgName);
    const applicationsLink = path.join(macDir, 'Applications');

    console.log(`\n[create-dmg] Creating ULMO DMG: ${dmgName}`);

    try {
      // Add Applications symlink for drag-to-install (temporary, removed after DMG creation)
      if (!fs.existsSync(applicationsLink)) {
        fs.symlinkSync('/Applications', applicationsLink);
        console.log(`  Added Applications symlink for drag-to-install UX`);
      }

      // Create ULMO DMG directly (no intermediate UDZO → convert step)
      // Safe: all paths are build-time artifact paths from electron-builder
      console.log(`  Creating ULMO DMG (this may take a few minutes)...`);
      execSync(
        `hdiutil create -volname "${productName}" -srcfolder "${macDir}" ` +
        `-ov -format ULMO -imagekey lzma-level=5 "${dmgPath}"`,
        { stdio: 'inherit' }
      );

      const dmgSize = fs.statSync(dmgPath).size;
      console.log(`  ✓ DMG created: ${(dmgSize / 1024 / 1024).toFixed(1)}MB (ULMO/LZMA compressed)`);

      createdDmgs.push(dmgPath);
    } catch (err) {
      console.error(`[create-dmg] Failed: ${err.message}`);
      if (fs.existsSync(dmgPath)) fs.unlinkSync(dmgPath);
    } finally {
      // Remove temporary Applications symlink from the dir output
      if (fs.existsSync(applicationsLink) && fs.lstatSync(applicationsLink).isSymbolicLink()) {
        fs.unlinkSync(applicationsLink);
      }
    }
  }

  // Also handle any pre-existing DMGs (if `dmg` target is used on other platforms/configs)
  const existingDmgs = (buildResult.artifactPaths || []).filter(f => f.endsWith('.dmg'));
  for (const dmgPath of existingDmgs) {
    if (!fs.existsSync(dmgPath) || createdDmgs.includes(dmgPath)) continue;

    const tmpPath = dmgPath.replace('.dmg', '.ulmo.dmg');
    const originalSize = fs.statSync(dmgPath).size;

    console.log(`\n[compress-dmg] Converting existing DMG to ULMO: ${path.basename(dmgPath)}`);
    try {
      execSync(
        `hdiutil convert "${dmgPath}" -format ULMO -imagekey lzma-level=5 -o "${tmpPath}"`,
        { stdio: 'inherit' }
      );
      fs.unlinkSync(dmgPath);
      fs.renameSync(tmpPath, dmgPath);
      const newSize = fs.statSync(dmgPath).size;
      console.log(`  ✓ ${(originalSize / 1024 / 1024).toFixed(1)}MB → ${(newSize / 1024 / 1024).toFixed(1)}MB`);
    } catch (err) {
      console.error(`[compress-dmg] Failed: ${err.message}`);
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  return createdDmgs;
};
