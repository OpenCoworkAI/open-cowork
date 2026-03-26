#!/usr/bin/env node

/**
 * electron-builder afterPack hook.
 *
 * Runs after the app is packed but before the installer (DMG/NSIS) is created.
 * Removes platform-specific binaries that don't match the build target,
 * strips build artifacts, and cleans up unnecessary locale files.
 *
 * Typical savings: ~160MB (koffi 79MB + better-sqlite3 19MB + ngrok 29MB + locales 32MB)
 */

const fs = require('fs');
const path = require('path');
const { stageMcpResources } = require('./stage-mcp-resources');

const RETRYABLE_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EMFILE']);

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function copyDirWithRetry(sourceDir, targetDir, maxAttempts = 6, retryDelayMs = 200) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(targetDir), { recursive: true });
      fs.cpSync(sourceDir, targetDir, { recursive: true });
      return attempt + 1;
    } catch (error) {
      const retryable = error && RETRYABLE_ERROR_CODES.has(error.code);
      if (!retryable || attempt === maxAttempts - 1) {
        throw error;
      }

      const delay = retryDelayMs * Math.pow(2, attempt);
      console.warn(
        `  [after-pack] MCP copy failed (${error.code}) attempt ${attempt + 1}/${maxAttempts}. Retrying in ${delay}ms...`
      );
      await sleep(delay);
    }
  }

  return maxAttempts;
}

function listRelativeFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const results = [];
  const stack = [''];

  while (stack.length > 0) {
    const relativePath = stack.pop();
    const absolutePath = path.join(rootDir, relativePath);
    const entries = fs.readdirSync(absolutePath, { withFileTypes: true });

    for (const entry of entries) {
      const childRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      if (entry.isDirectory()) {
        stack.push(childRelativePath);
      } else {
        results.push(childRelativePath);
      }
    }
  }

  results.sort();
  return results;
}

/**
 * Map electron-builder arch names to koffi directory names.
 * koffi uses: darwin_arm64, darwin_x64, linux_arm64, linux_x64,
 *             win32_ia32, win32_x64, win32_arm64, etc.
 */
function getKoffiPlatformDir(platform, arch) {
  const koffiPlatform = platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win32' : 'linux';
  const koffiArch = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x64' : arch;
  return `${koffiPlatform}_${koffiArch}`;
}

/**
 * Remove entries from a directory, keeping only those in the whitelist.
 * Returns the count of removed items.
 */
function removeExcept(dir, whitelist) {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  const whiteSet = new Set(whitelist.map(w => w.toLowerCase()));
  for (const entry of fs.readdirSync(dir)) {
    if (whiteSet.has(entry.toLowerCase())) continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

/**
 * Recursively find directories matching a name pattern within a base path.
 */
function findDirs(basePath, dirName) {
  const results = [];
  if (!fs.existsSync(basePath)) return results;

  function walk(currentPath, depth) {
    if (depth > 8) return; // Prevent infinite recursion
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(currentPath, entry.name);
        if (entry.name === dirName) {
          results.push(fullPath);
        } else if (!entry.name.startsWith('.')) {
          walk(fullPath, depth + 1);
        }
      }
    } catch {
      // Permission errors, etc.
    }
  }

  walk(basePath, 0);
  return results;
}

/**
 * @param {import('electron-builder').AfterPackContext} context
 */
module.exports = async function afterPack(context) {
  const { appOutDir, electronPlatformName, arch } = context;
  // electron-builder arch: 0=ia32, 1=x64, 3=arm64
  const archName = arch === 3 ? 'arm64' : arch === 1 ? 'x64' : 'ia32';
  const platform = electronPlatformName; // 'darwin', 'win32', 'linux'

  console.log(`\n🧹 after-pack: cleaning ${platform}-${archName} build...`);

  // Determine the app resources path
  let resourcesDir;
  if (platform === 'darwin') {
    // macOS: Open Cowork.app/Contents/Resources/app.asar.unpacked/...
    const appName = `${context.packager.appInfo.productFilename}.app`;
    resourcesDir = path.join(appOutDir, appName, 'Contents', 'Resources');
  } else {
    resourcesDir = path.join(appOutDir, 'resources');
  }

  const appAsarUnpacked = path.join(resourcesDir, 'app.asar.unpacked');
  // For files inside asar, electron-builder may also have app/ or node_modules/
  // We primarily work on the unpacked directory
  const nmUnpacked = path.join(appAsarUnpacked, 'node_modules');

  // Copy bundled MCP servers after packaging so we control retries and avoid
  // electron-builder's Windows extraResources copy occasionally hitting EBUSY.
  const projectRoot = context.packager.projectDir;
  const existingStageDir = path.join(projectRoot, 'dist-mcp-stage');
  const existingStagedMcpFiles = listRelativeFiles(existingStageDir);
  const { stageDir, files: stagedMcpFiles } = existingStagedMcpFiles.length > 0
    ? { stageDir: existingStageDir, files: existingStagedMcpFiles }
    : await stageMcpResources({ projectRoot });
  const bundledMcpDir = path.join(resourcesDir, 'mcp');
  const mcpCopyAttempts = await copyDirWithRetry(stageDir, bundledMcpDir);
  console.log(
    `  MCP: copied ${stagedMcpFiles.length} staged bundle(s) into resources/mcp in ${mcpCopyAttempts} attempt(s)`
  );

  // --- 1. koffi: remove non-target platform binaries ---
  const koffiKeep = getKoffiPlatformDir(platform, archName);
  const koffiBuildDirs = findDirs(resourcesDir, 'koffi');
  for (const koffiDir of koffiBuildDirs) {
    // koffi/build/koffi/ contains per-platform directories
    const buildKoffiDir = path.join(koffiDir, 'build', 'koffi');
    if (fs.existsSync(buildKoffiDir)) {
      const removed = removeExcept(buildKoffiDir, [koffiKeep]);
      if (removed > 0) console.log(`  ✓ koffi: kept ${koffiKeep}, removed ${removed} other platform dirs`);
    }
    // Also check if koffi dir itself has a build/ child
    if (path.basename(koffiDir) === 'koffi' && fs.existsSync(path.join(koffiDir, 'build'))) {
      // Remove source and build-time files
      for (const sub of ['src', 'vendor', 'doc']) {
        const subPath = path.join(koffiDir, sub);
        if (fs.existsSync(subPath)) {
          fs.rmSync(subPath, { recursive: true, force: true });
          console.log(`  ✓ koffi: removed ${sub}/`);
        }
      }
    }
  }

  // Also check the node_modules path directly
  const koffiPkg = path.join(nmUnpacked, 'koffi');
  if (fs.existsSync(koffiPkg)) {
    const buildKoffiDir = path.join(koffiPkg, 'build', 'koffi');
    if (fs.existsSync(buildKoffiDir)) {
      const removed = removeExcept(buildKoffiDir, [koffiKeep]);
      if (removed > 0) console.log(`  ✓ koffi (nm): kept ${koffiKeep}, removed ${removed} other platform dirs`);
    }
    for (const sub of ['src', 'vendor', 'doc']) {
      const subPath = path.join(koffiPkg, sub);
      if (fs.existsSync(subPath)) {
        fs.rmSync(subPath, { recursive: true, force: true });
        console.log(`  ✓ koffi (nm): removed ${sub}/`);
      }
    }
  }

  // --- 2. better-sqlite3: remove SQLite source and build intermediates ---
  const sqlitePkg = path.join(nmUnpacked, 'better-sqlite3');
  if (fs.existsSync(sqlitePkg)) {
    // deps/sqlite3/ contains the SQLite amalgamation source (~9.7MB)
    const depsDir = path.join(sqlitePkg, 'deps');
    if (fs.existsSync(depsDir)) {
      fs.rmSync(depsDir, { recursive: true, force: true });
      console.log(`  ✓ better-sqlite3: removed deps/ (~9.7MB)`);
    }
    // build/Release/obj/ contains intermediate .o files (~9.6MB)
    const objDir = path.join(sqlitePkg, 'build', 'Release', 'obj');
    if (fs.existsSync(objDir)) {
      fs.rmSync(objDir, { recursive: true, force: true });
      console.log(`  ✓ better-sqlite3: removed build/Release/obj/ (~9.6MB)`);
    }
    // src/ contains C++ source files
    const srcDir = path.join(sqlitePkg, 'src');
    if (fs.existsSync(srcDir)) {
      fs.rmSync(srcDir, { recursive: true, force: true });
      console.log(`  ✓ better-sqlite3: removed src/`);
    }
  }

  // --- 3. bufferutil / utf-8-validate: remove non-target platform prebuilds ---
  for (const pkg of ['bufferutil', 'utf-8-validate']) {
    const pkgPath = path.join(nmUnpacked, pkg);
    if (!fs.existsSync(pkgPath)) continue;
    const prebuildsDir = path.join(pkgPath, 'prebuilds');
    if (!fs.existsSync(prebuildsDir)) continue;
    // Keep only the current platform dir (e.g. darwin-arm64)
    const keepDir = `${platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win32' : 'linux'}-${archName.replace('arm64', 'arm64').replace('x64', 'x64')}`;
    const removed = removeExcept(prebuildsDir, [keepDir]);
    if (removed > 0) console.log(`  ✓ ${pkg}: kept ${keepDir}, removed ${removed} other prebuild dirs`);
  }

  // --- 4. ngrok: remove binary (~28MB, it downloads on-demand anyway) ---
  const ngrokPkg = path.join(nmUnpacked, 'ngrok');
  if (fs.existsSync(ngrokPkg)) {
    const ngrokBin = path.join(ngrokPkg, 'bin');
    if (fs.existsSync(ngrokBin)) {
      fs.rmSync(ngrokBin, { recursive: true, force: true });
      console.log(`  ✓ ngrok: removed bin/ (~28MB)`);
    }
  }

  // --- 5. Electron locales: keep only en, zh_CN, zh_TW ---
  if (platform === 'darwin') {
    const appName = `${context.packager.appInfo.productFilename}.app`;
    const frameworkDir = path.join(
      appOutDir, appName, 'Contents', 'Frameworks',
      'Electron Framework.framework', 'Versions', 'A', 'Resources'
    );
    if (fs.existsSync(frameworkDir)) {
      const KEEP_LOCALES = new Set(['en.lproj', 'zh_CN.lproj', 'zh_TW.lproj', 'Base.lproj']);
      let removedLocales = 0;
      for (const entry of fs.readdirSync(frameworkDir)) {
        if (!entry.endsWith('.lproj')) continue;
        if (KEEP_LOCALES.has(entry)) continue;
        fs.rmSync(path.join(frameworkDir, entry), { recursive: true, force: true });
        removedLocales++;
      }
      if (removedLocales > 0) console.log(`  ✓ Electron locales: removed ${removedLocales} .lproj dirs (kept en, zh_CN, zh_TW)`);
    }
  }

  console.log(`✅ after-pack cleanup complete for ${platform}-${archName}\n`);
};
