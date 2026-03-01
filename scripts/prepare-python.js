#!/usr/bin/env node

/**
 * Prepare a bundled Python runtime for Open Cowork (macOS).
 *
 * Goal:
 * - Bundle a standalone python3 into `resources/python/darwin-{arch}/`
 * - Preinstall required packages into `resources/python/darwin-{arch}/site-packages/`
 *   - Pillow (PIL)
 *   - pyobjc-framework-Quartz (import Quartz)
 *
 * Runtime code (gui-operate-server) will prefer the bundled Python and add
 * `${pythonRoot}/site-packages` to PYTHONPATH.
 *
 * Why python-build-standalone instead of python.org?
 * - python-build-standalone provides ready-to-use install_only.tar.gz files
 *   (no need to extract from .pkg installers, no user interaction)
 * - Smaller size (~50MB vs ~100MB+ for full python.org installer)
 * - Standalone (no system dependencies, works in sandboxed Electron apps)
 * - Supports both arm64 and x64 architectures
 * - python.org only provides .pkg installers that require:
 *   - Running installer (needs automation or user interaction)
 *   - Extracting from .pkg (more complex, requires pkgutil/xar)
 *   - Larger download size
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'resources', 'python');
const DOWNLOAD_DIR = path.join(OUTPUT_ROOT, '.downloads');

// Pin to a Python minor version that has reliable wheels for Pillow and pyobjc
const PYTHON_MINOR = process.env.OPEN_COWORK_PYTHON_MINOR || '3.12';
const ABI = `cp${PYTHON_MINOR.replace('.', '')}`; // e.g. 3.12 -> cp312

const GITHUB_REPO = process.env.OPEN_COWORK_PYTHON_STANDALONE_REPO || 'astral-sh/python-build-standalone';
// Use the correct GitHub API endpoint (v3, no trailing slash)
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`;

// Default URLs for stable Python builds (20260203 release, Python 3.10.19)
// These are used as fallback if no existing archive is found and no env override is set
const DEFAULT_PYTHON_URLS = {
  'aarch64-apple-darwin': 'https://github.com/astral-sh/python-build-standalone/releases/download/20260203/cpython-3.10.19+20260203-aarch64-apple-darwin-install_only.tar.gz',
  'x86_64-apple-darwin': 'https://github.com/astral-sh/python-build-standalone/releases/download/20260203/cpython-3.10.19+20260203-x86_64-apple-darwin-install_only.tar.gz',
};

const TARGETS = {
  darwin: {
    arm64: {
      triple: 'aarch64-apple-darwin',
      platformTag: 'macosx_11_0_arm64',
      envUrlKey: 'OPEN_COWORK_PYTHON_STANDALONE_URL_DARWIN_ARM64',
    },
    x64: {
      triple: 'x86_64-apple-darwin',
      platformTag: 'macosx_11_0_x86_64',
      envUrlKey: 'OPEN_COWORK_PYTHON_STANDALONE_URL_DARWIN_X64',
    },
  },
};

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
    const file = fs.createWriteStream(dest);

    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': 'open-cowork-build-script',
          Accept: '*/*',
        },
      },
      (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirect = response.headers.location;
          file.close();
          fs.unlinkSync(dest);
          return download(redirect, dest).then(resolve).catch(reject);
        }
        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          reject(new Error(`Download failed: ${response.statusCode} ${response.statusMessage}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }
    );

    request.on('error', (err) => {
      try {
        file.close();
        fs.unlinkSync(dest);
      } catch {}
      reject(err);
    });
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    let data = '';
    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': 'open-cowork-build-script',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        // Handle redirects (301/302)
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirect = res.headers.location;
          if (!redirect) {
            reject(new Error(`HTTP ${res.statusCode} redirect but no Location header for ${url}`));
            return;
          }
          // Recursively follow redirect
          return fetchJson(redirect).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    request.on('error', reject);
  });
}

/**
 * Check if a matching archive already exists in DOWNLOAD_DIR
 * Returns the full path if found, null otherwise
 */
function findExistingArchive(triple) {
  if (!exists(DOWNLOAD_DIR)) {
    return null;
  }

  const wantedPrefix = `cpython-${PYTHON_MINOR}`;
  const files = fs.readdirSync(DOWNLOAD_DIR);
  
  for (const file of files) {
    const filePath = path.join(DOWNLOAD_DIR, file);
    // Skip if not a file or not an archive
    if (!fs.statSync(filePath).isFile()) continue;
    if (!file.endsWith('.tar.gz') && !file.endsWith('.tar.zst')) continue;
    
    // Check if filename matches our criteria
    if (
      file.includes(wantedPrefix) &&
      file.includes(triple) &&
      file.includes('install_only')
    ) {
      console.log(`[prepare:python] Found existing archive: ${file}`);
      return filePath;
    }
  }
  
  return null;
}

async function findStandaloneAssetUrl(triple, envUrlKey) {
  // 1. Explicit override (highest priority)
  const envUrl = process.env[envUrlKey];
  if (envUrl) {
    console.log(`[prepare:python] Using explicit URL override: ${envUrl}`);
    return envUrl;
  }

  // 2. Check if archive already exists (skip download and API call)
  const existingArchive = findExistingArchive(triple);
  if (existingArchive) {
    console.log(`[prepare:python] Using existing archive, skipping download`);
    // Return a placeholder URL (we'll use the existing file path directly)
    return `file://${existingArchive}`;
  }

  // 3. Use default hardcoded URLs (fast, no API call needed)
  const defaultUrl = DEFAULT_PYTHON_URLS[triple];
  if (defaultUrl) {
    console.log(`[prepare:python] Using default URL for ${triple}: ${defaultUrl.substring(0, 80)}...`);
    return defaultUrl;
  }

  // 4. Fallback: Try GitHub API (only if no default URL available)
  try {
    console.log(`[prepare:python] No default URL for ${triple}, fetching from GitHub API: ${RELEASES_API}`);
    const releases = await fetchJson(RELEASES_API);
    if (!Array.isArray(releases)) {
      throw new Error(`Unexpected GitHub API response: expected array, got ${typeof releases}`);
    }

    const wantedPrefix = `cpython-${PYTHON_MINOR}`;

    for (const rel of releases) {
      const assets = rel.assets || [];
      for (const asset of assets) {
        const name = asset.name || '';
        const url = asset.browser_download_url || '';
        const ok =
          name.includes(wantedPrefix) &&
          name.includes(triple) &&
          name.includes('install_only') &&
          (name.endsWith('.tar.gz') || name.endsWith('.tar.zst')) &&
          url;
        if (ok) {
          console.log(`[prepare:python] Found asset: ${name} (${url.substring(0, 80)}...)`);
          return url;
        }
      }
    }

    throw new Error(
      `Could not find a python-build-standalone asset for Python ${PYTHON_MINOR} (${triple}) in ${releases.length} releases.\n` +
        `You can override by setting ${envUrlKey} to a direct .tar.gz URL.`
    );
  } catch (apiError) {
    console.error(`[prepare:python] GitHub API failed: ${apiError.message}`);
    throw new Error(
      `Failed to fetch Python from python-build-standalone: ${apiError.message}\n` +
        `You can:\n` +
        `  1. Set ${envUrlKey} to a direct download URL\n` +
        `  2. Or manually download and extract Python to ${path.join(OUTPUT_ROOT, `darwin-${triple.includes('arm64') ? 'arm64' : 'x64'}`)}\n` +
        `\nWhy python-build-standalone?\n` +
        `  - Provides standalone Python (no system dependencies)\n` +
        `  - Smaller size (~50MB vs ~100MB+ for full installer)\n` +
        `  - Ready-to-use install_only.tar.gz (no extraction from .pkg needed)\n` +
        `  - Supports both arm64 and x64 architectures\n` +
        `\nAlternative: python.org provides .pkg installers that require:\n` +
        `  - Running installer (needs user interaction or automation)\n` +
        `  - Extracting from .pkg (more complex)\n` +
        `  - Larger download size`
    );
  }
}

function getStripComponentsForArchive(archivePath) {
  const isZst = archivePath.endsWith('.tar.zst');
  const listCmd = isZst ? `tar --zstd -tf "${archivePath}"` : `tar -tzf "${archivePath}"`;
  const list = execSync(listCmd, { encoding: 'utf8' }).split('\n');
  const python3Entry = list.find((p) => p.endsWith('/bin/python3'));
  if (!python3Entry) {
    throw new Error(`Could not locate bin/python3 in archive: ${archivePath}`);
  }
  const prefix = python3Entry.replace(/\/bin\/python3$/, '').replace(/\/$/, '');
  const parts = prefix.split('/').filter(Boolean);
  return parts.length;
}

function extractArchive(archivePath, destDir) {
  ensureDir(destDir);
  // Clean destination to avoid mixing different versions
  for (const entry of fs.readdirSync(destDir)) {
    fs.rmSync(path.join(destDir, entry), { recursive: true, force: true });
  }

  const isZst = archivePath.endsWith('.tar.zst');
  const strip = getStripComponentsForArchive(archivePath);
  const extractCmd = isZst
    ? `tar --zstd -xf "${archivePath}" -C "${destDir}" --strip-components=${strip}`
    : `tar -xzf "${archivePath}" -C "${destDir}" --strip-components=${strip}`;

  execSync(extractCmd, { stdio: 'inherit' });
}

function installPackages(siteDir, platformTag) {
  ensureDir(siteDir);

  const pipPython = process.env.OPEN_COWORK_PIP_PYTHON || 'python3';

  // Avoid re-install if already present
  const hasPillow = exists(path.join(siteDir, 'PIL'));
  const hasQuartz = exists(path.join(siteDir, 'Quartz'));
  if (hasPillow && hasQuartz) {
    console.log(`✓ Python packages already present in ${siteDir}`);
    return;
  }

  console.log(`📦 Installing Python packages into ${siteDir} (platform=${platformTag})...`);

  // Install wheels into a target directory (no need to run the bundled python)
  // NOTE: requires network access and a working pip on the build machine.
  const cmd =
    `${pipPython} -m pip install --upgrade --no-input --only-binary=:all: ` +
    `--target "${siteDir}" ` +
    `--platform "${platformTag}" --python-version "${PYTHON_MINOR}" --implementation "cp" --abi "${ABI}" ` +
    `pillow pyobjc-framework-Quartz`;

  execSync(cmd, { stdio: 'inherit' });
}

async function prepareDarwinArch(arch) {
  const target = TARGETS.darwin[arch];
  if (!target) return;

  const destDir = path.join(OUTPUT_ROOT, `darwin-${arch}`);
  const pythonBin = path.join(destDir, 'bin', 'python3');
  const siteDir = path.join(destDir, 'site-packages');

  // Download + extract standalone python if missing
  if (!exists(pythonBin)) {
    console.log(`🐍 Preparing standalone Python ${PYTHON_MINOR} for darwin-${arch}...`);
    const url = await findStandaloneAssetUrl(target.triple, target.envUrlKey);
    
    // Handle file:// URLs (existing archive) vs http(s):// URLs (need download)
    let archivePath;
    if (url.startsWith('file://')) {
      // Existing archive found, use it directly
      archivePath = url.replace('file://', '');
      console.log(`✓ Using existing archive: ${archivePath}`);
    } else {
      // Need to download
      const archiveName = path.basename(url);
      archivePath = path.join(DOWNLOAD_DIR, archiveName);

      if (!exists(archivePath)) {
        console.log(`⬇️  Downloading: ${archiveName}`);
        await download(url, archivePath);
      } else {
        console.log(`✓ Archive already downloaded: ${archivePath}`);
      }
    }

    console.log(`📦 Extracting to: ${destDir}`);
    extractArchive(archivePath, destDir);

    if (!exists(pythonBin)) {
      throw new Error(`Python extraction failed: ${pythonBin} not found`);
    }
  } else {
    console.log(`✓ Standalone Python already present: ${pythonBin}`);
  }

  // Install packages (Pillow + Quartz)
  installPackages(siteDir, target.platformTag);
}

async function main() {
  if (process.platform !== 'darwin') {
    console.log('[prepare:python] Non-macOS platform, skipping.');
    return;
  }

  ensureDir(OUTPUT_ROOT);
  ensureDir(DOWNLOAD_DIR);

  const args = process.argv.slice(2);
  const wantsAll = args.includes('--all');
  const archIndex = args.indexOf('--arch');
  const requestedArch = archIndex >= 0 ? args[archIndex + 1] : null;
  const currentArch = process.arch === 'arm64' ? 'arm64' : 'x64';

  const arches = wantsAll
    ? ['arm64', 'x64']
    : requestedArch
      ? [requestedArch]
      : [currentArch];

  for (const arch of arches) {
    await prepareDarwinArch(arch);
  }

  console.log('✅ Bundled Python prepared.');
}

main().catch((err) => {
  console.error('\n[prepare:python] ERROR:', err && err.message ? err.message : err);
  process.exitCode = 1;
});

