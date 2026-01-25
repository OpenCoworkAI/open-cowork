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
    fs.unlinkSync(archivePath);
    console.log(`✓ Extracted: ${platform}-${arch}`);
  } catch (error) {
    console.error(`✗ Failed to download ${platform}-${arch}:`, error.message);
    // Clean up on error
    if (fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  }
}

async function main() {
  console.log('Downloading Node.js binaries...\n');

  // Download for all platforms
  const downloads = [];
  for (const [platform, arches] of Object.entries(PLATFORMS)) {
    for (const arch of Object.keys(arches)) {
      downloads.push(downloadAndExtract(platform, arch));
    }
  }

  await Promise.all(downloads);
  console.log('\n✓ All Node.js binaries downloaded!');
}

main().catch(console.error);
