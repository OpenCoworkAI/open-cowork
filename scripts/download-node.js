#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NODE_VERSION = 'v22.22.0'; // 使用稳定版本
const PLATFORMS = {
  darwin: {
    arm64: `node-${NODE_VERSION}-darwin-arm64`,
    x64: `node-${NODE_VERSION}-darwin-x64`,
  },
  win32: {
    x64: `node-${NODE_VERSION}-win-x64`,
  },
  linux: {
    x64: `node-${NODE_VERSION}-linux-x64`,
  },
};

const BASE_URL = 'https://nodejs.org/dist';
const OUTPUT_DIR = path.join(__dirname, '..', 'resources', 'node');
const DOWNLOAD_ALL_PLATFORMS = process.env.OPEN_COWORK_DOWNLOAD_ALL_NODE_BINARIES === '1';
const WINDOWS_UNLINK_RETRY_COUNT = 8;
const WINDOWS_UNLINK_RETRY_DELAY_MS = 500;

/**
 * Fix npx in bundled Node: the default bin/npx script has unresolvable
 * require() calls (@npmcli/config, etc.) when run from the extracted
 * directory layout. Replace it with a minimal wrapper that uses the
 * bundled node to run npm's real npx-cli.js directly.
 * Safe to call multiple times (idempotent).
 */
function applyNpxFix(extractDir) {
  const npxBinPath = path.join(extractDir, 'bin', 'npx');
  const realNpxCli = path.join(extractDir, 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js');

  if (!fs.existsSync(realNpxCli)) {
    return;
  }

  // Check if already fixed
  const current = fs.existsSync(npxBinPath) ? fs.readFileSync(npxBinPath, 'utf8') : '';
  if (current.includes('npx-wrapper-fix')) {
    return;
  }

  // bin/npx is typically a symlink to lib/node_modules/npm/bin/npx-cli.js.
  // We must remove the symlink first, otherwise writing to bin/npx would
  // overwrite the real npx-cli.js through the symlink.
  const isSymlink = fs.lstatSync(npxBinPath).isSymbolicLink();
  if (isSymlink) {
    fs.unlinkSync(npxBinPath);
  }

  // Use a shell wrapper that resolves the bundled node via dirname,
  // then executes npx-cli.js with it. This avoids shebang issues
  // where #!/usr/bin/env node picks up the system node.
  const isWindows = extractDir.includes('win32') || extractDir.includes('win-x');
  if (isWindows) {
    // Windows: create a .cmd wrapper
    const cmdPath = npxBinPath + '.cmd';
    const cmd = `@echo off\r\nrem npx-wrapper-fix\r\n"%~dp0node.exe" "%~dp0..\\lib\\node_modules\\npm\\bin\\npx-cli.js" %*\r\n`;
    fs.writeFileSync(cmdPath, cmd);
    console.log('  Fixed npx: created npx.cmd wrapper');
  } else {
    // Unix: shell script wrapper
    const wrapper = `#!/bin/sh
# npx-wrapper-fix
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/node" "$DIR/../lib/node_modules/npm/bin/npx-cli.js" "$@"
`;
    fs.writeFileSync(npxBinPath, wrapper);
    fs.chmodSync(npxBinPath, 0o755);
    console.log('  Fixed npx: replaced bin/npx with shell wrapper');
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading: ${url}`);
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        return download(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeFileWithRetries(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  let lastError = null;
  for (let attempt = 1; attempt <= WINDOWS_UNLINK_RETRY_COUNT; attempt += 1) {
    try {
      fs.unlinkSync(filePath);
      return;
    } catch (error) {
      lastError = error;
      const isRetryableWindowsError = process.platform === 'win32'
        && (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'ENOTEMPTY');
      if (!isRetryableWindowsError || attempt === WINDOWS_UNLINK_RETRY_COUNT) {
        throw error;
      }

      console.warn(
        `[download:node] Failed to remove ${path.basename(filePath)} (attempt ${attempt}/${WINDOWS_UNLINK_RETRY_COUNT}): ${error.code}. Retrying...`
      );
      sleepSync(WINDOWS_UNLINK_RETRY_DELAY_MS);
    }
  }

  if (lastError) {
    throw lastError;
  }
}

async function downloadAndExtract(platform, arch) {
  const nodeName = PLATFORMS[platform]?.[arch];
  if (!nodeName) {
    console.log(`Skipping ${platform}-${arch} (not configured)`);
    return;
  }

  const ext = platform === 'win32' ? 'zip' : 'tar.gz';
  const archiveName = `${nodeName}.${ext}`;
  const url = `${BASE_URL}/${NODE_VERSION}/${archiveName}`;
  const archivePath = path.join(OUTPUT_DIR, archiveName);
  const extractDir = path.join(OUTPUT_DIR, `${platform}-${arch}`);

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Skip if already downloaded
  if (fs.existsSync(extractDir)) {
    console.log(`Already exists: ${extractDir}`);
    // Still apply npx fix in case it was cached without it
    applyNpxFix(extractDir);
    return;
  }

  try {
    // Download
    await download(url, archivePath);
    console.log(`Downloaded: ${archivePath}`);

    // Extract
    console.log(`Extracting to: ${extractDir}`);
    fs.mkdirSync(extractDir, { recursive: true });

    if (platform === 'win32') {
      // Use PowerShell Expand-Archive for Windows zip files
      const isWindows = process.platform === 'win32';
      if (isWindows) {
        // PowerShell on Windows
        execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`, { stdio: 'inherit' });
      } else {
        // unzip on Unix
        execSync(`unzip -q "${archivePath}" -d "${extractDir}"`, { stdio: 'inherit' });
      }
      // Move contents up one level
      const innerDir = path.join(extractDir, nodeName);
      if (fs.existsSync(innerDir)) {
        const files = fs.readdirSync(innerDir);
        files.forEach(file => {
          fs.renameSync(path.join(innerDir, file), path.join(extractDir, file));
        });
        fs.rmdirSync(innerDir);
      }
    } else {
      // Use tar for Unix packages
      // Note: On Windows, extracting Unix tar.gz may fail due to symlinks - that's OK
      execSync(`tar -xzf "${archivePath}" -C "${extractDir}" --strip-components=1`, { stdio: 'inherit' });
    }

    // Clean up archive
    removeFileWithRetries(archivePath);

    // Remove files not needed at runtime to reduce bundle size (~65MB savings)
    const CLEANUP_DIRS = ['include', 'share'];
    const CLEANUP_FILES = ['CHANGELOG.md', 'README.md'];
    const CLEANUP_NPM_DIRS = ['docs', 'man'];

    for (const dir of CLEANUP_DIRS) {
      const dirPath = path.join(extractDir, dir);
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log(`  Removed ${dir}/`);
      }
    }
    for (const file of CLEANUP_FILES) {
      const filePath = path.join(extractDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`  Removed ${file}`);
      }
    }
    const npmDir = path.join(extractDir, 'lib', 'node_modules', 'npm');
    if (fs.existsSync(npmDir)) {
      for (const sub of CLEANUP_NPM_DIRS) {
        const subPath = path.join(npmDir, sub);
        if (fs.existsSync(subPath)) {
          fs.rmSync(subPath, { recursive: true, force: true });
          console.log(`  Removed npm/${sub}/`);
        }
      }
    }

    applyNpxFix(extractDir);

    console.log(`✓ Extracted: ${platform}-${arch}`);
  } catch (error) {
    console.error(`✗ Failed to download ${platform}-${arch}:`, error?.stack || error);
    // Clean up on error
    if (fs.existsSync(archivePath)) {
      removeFileWithRetries(archivePath);
    }
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  }
}

async function main() {
  console.log('Downloading Node.js binaries...\n');

  const downloads = [];
  const platformsToDownload = DOWNLOAD_ALL_PLATFORMS
    ? Object.entries(PLATFORMS)
    : [[process.platform, PLATFORMS[process.platform] || {}]];

  if (!DOWNLOAD_ALL_PLATFORMS) {
    console.log(`Current platform only: ${process.platform}-${process.arch}`);
  }

  for (const [platform, arches] of platformsToDownload) {
    const archList = DOWNLOAD_ALL_PLATFORMS
      ? Object.keys(arches)
      : [process.arch];

    for (const arch of archList) {
      downloads.push(downloadAndExtract(platform, arch));
    }
  }

  await Promise.all(downloads);
  console.log('\n✓ All Node.js binaries downloaded!');
}

main().catch(console.error);
