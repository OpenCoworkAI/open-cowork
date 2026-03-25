#!/usr/bin/env node

/**
 * electron-builder afterAllArtifactBuild hook.
 *
 * Windows:
 * - copies legacy cleanup helpers into the final release directory so direct
 *   `electron-builder --win nsis` runs keep the installer remediation assets
 *
 * macOS:
 * - creates ULMO (LZMA) compressed DMG files from the `dir` target output
 * - bypasses electron-builder's built-in dmgbuild because temporary size
 *   estimation is too small for large apps and Spotlight indexing can cause
 *   "resource busy" on unmount
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { writeLegacyCleanupArtifacts } = require('./build-windows-artifacts');

function resolveOutputDir(buildResult) {
  const configuredOutDir = buildResult.outDir || buildResult.configuration?.directories?.output || 'release';
  return path.isAbsolute(configuredOutDir)
    ? configuredOutDir
    : path.resolve(process.cwd(), configuredOutDir);
}

function addWindowsReleaseArtifacts(buildResult) {
  const outputDir = resolveOutputDir(buildResult);
  const copiedPaths = writeLegacyCleanupArtifacts({
    projectRoot: process.cwd(),
    outputDir,
  });

  copiedPaths.forEach((copiedPath) => {
    console.log('[after-all-artifacts] Added legacy cleanup helper:', copiedPath);
  });

  return copiedPaths;
}

async function compressMacArtifacts(buildResult) {
  const outDir = resolveOutputDir(buildResult);
  const { configuration } = buildResult;
  const productName = configuration.productName || 'Open Cowork';
  const version = buildResult.configuration.buildVersion ||
    require(path.join(process.cwd(), 'package.json')).version;

  const macOutDirs = fs.readdirSync(outDir)
    .filter((dirName) => dirName.startsWith('mac-'))
    .map((dirName) => path.join(outDir, dirName));

  const createdDmgs = [];

  for (const macDir of macOutDirs) {
    const arch = path.basename(macDir).replace('mac-', '');
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
      if (!fs.existsSync(applicationsLink)) {
        fs.symlinkSync('/Applications', applicationsLink);
        console.log('  Added Applications symlink for drag-to-install UX');
      }

      console.log('  Creating ULMO DMG (this may take a few minutes)...');
      execSync(
        `hdiutil create -volname "${productName}" -srcfolder "${macDir}" ` +
        `-ov -format ULMO -imagekey lzma-level=5 "${dmgPath}"`,
        { stdio: 'inherit' }
      );

      const dmgSize = fs.statSync(dmgPath).size;
      console.log(`  DMG created: ${(dmgSize / 1024 / 1024).toFixed(1)}MB (ULMO/LZMA compressed)`);

      createdDmgs.push(dmgPath);
    } catch (error) {
      console.error(`[create-dmg] Failed: ${error.message}`);
      if (fs.existsSync(dmgPath)) {
        fs.unlinkSync(dmgPath);
      }
    } finally {
      if (fs.existsSync(applicationsLink) && fs.lstatSync(applicationsLink).isSymbolicLink()) {
        fs.unlinkSync(applicationsLink);
      }
    }
  }

  const existingDmgs = (buildResult.artifactPaths || []).filter((artifactPath) => artifactPath.endsWith('.dmg'));
  for (const dmgPath of existingDmgs) {
    if (!fs.existsSync(dmgPath) || createdDmgs.includes(dmgPath)) {
      continue;
    }

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
      console.log(`  ${(originalSize / 1024 / 1024).toFixed(1)}MB -> ${(newSize / 1024 / 1024).toFixed(1)}MB`);
    } catch (error) {
      console.error(`[compress-dmg] Failed: ${error.message}`);
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    }
  }

  return createdDmgs;
}

module.exports = async function afterAllArtifactBuild(buildResult) {
  if (process.platform === 'win32') {
    return addWindowsReleaseArtifacts(buildResult);
  }

  if (process.platform !== 'darwin') {
    return [];
  }

  return compressMacArtifacts(buildResult);
};

module.exports.addWindowsReleaseArtifacts = addWindowsReleaseArtifacts;
module.exports.compressMacArtifacts = compressMacArtifacts;
