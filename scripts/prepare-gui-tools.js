#!/usr/bin/env node

/**
 * Prepare/bundle GUI helper tools for packaging.
 *
 * Currently:
 * - macOS: bundles `cliclick` into `resources/tools/darwin-{arch}/bin/cliclick`
 *
 * This makes packaged apps work without requiring end users to install Homebrew tools.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

function tryExecFile(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function detectBinaryArch(filePath) {
  const out = tryExecFile('/usr/bin/file', ['-b', filePath]);
  if (!out) return null;

  const hasArm64 = out.includes('arm64');
  const hasX64 = out.includes('x86_64');
  const isUniversal = out.includes('universal') || (hasArm64 && hasX64);

  if (isUniversal) return 'universal';
  if (hasArm64) return 'arm64';
  if (hasX64) return 'x64';
  return null;
}

function copyExecutable(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  // Ensure executable bit (electron-builder will preserve it)
  fs.chmodSync(dest, 0o755);
  console.log(`✓ Bundled: ${src} -> ${dest}`);
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('[prepare:gui-tools] Non-macOS platform, skipping.');
    return;
  }

  const projectRoot = path.join(__dirname, '..');
  const toolsRoot = path.join(projectRoot, 'resources', 'tools');
  const outDirs = {
    arm64: path.join(toolsRoot, 'darwin-arm64', 'bin'),
    x64: path.join(toolsRoot, 'darwin-x64', 'bin'),
  };

  ensureDir(outDirs.arm64);
  ensureDir(outDirs.x64);

  const outputArm = path.join(outDirs.arm64, 'cliclick');
  const outputX64 = path.join(outDirs.x64, 'cliclick');

  // If already present, keep it.
  const haveArm = exists(outputArm);
  const haveX64 = exists(outputX64);

  if (haveArm && haveX64) {
    console.log('[prepare:gui-tools] cliclick already present for both arm64 and x64.');
    return;
  }

  // Candidate locations (Homebrew default prefixes)
  const candidates = new Set([
    '/opt/homebrew/bin/cliclick',
    '/usr/local/bin/cliclick',
  ]);

  // Also try PATH
  const whichPath = tryExecFile('/usr/bin/which', ['cliclick']);
  if (whichPath) candidates.add(whichPath);

  const found = [...candidates].filter(exists);

  if (found.length === 0) {
    const msg =
      '\n[prepare:gui-tools] ERROR: `cliclick` was not found on this build machine.\n' +
      'Install it once and rebuild:\n' +
      '  brew install cliclick\n\n' +
      'Or place binaries manually:\n' +
      `  ${outputArm}\n` +
      `  ${outputX64}\n`;
    console.error(msg);
    process.exitCode = 1;
    return;
  }

  // Copy whatever we can find to the right arch folder(s)
  let bundledArm = haveArm;
  let bundledX64 = haveX64;

  for (const src of found) {
    const arch = detectBinaryArch(src);
    if (!arch) continue;

    if (arch === 'universal') {
      if (!bundledArm) copyExecutable(src, outputArm);
      if (!bundledX64) copyExecutable(src, outputX64);
      bundledArm = true;
      bundledX64 = true;
      break;
    }

    if (arch === 'arm64' && !bundledArm) {
      copyExecutable(src, outputArm);
      bundledArm = true;
    }

    if (arch === 'x64' && !bundledX64) {
      copyExecutable(src, outputX64);
      bundledX64 = true;
    }
  }

  // Ensure current arch is bundled (so local build/run works)
  const currentArch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const currentOk = currentArch === 'arm64' ? bundledArm : bundledX64;

  if (!currentOk) {
    const msg =
      `\n[prepare:gui-tools] ERROR: Found cliclick, but none matched current arch (${process.arch}).\n` +
      'Please install the correct Homebrew (arm64 under /opt/homebrew, x64 under /usr/local) or provide the binary manually.\n';
    console.error(msg);
    process.exitCode = 1;
    return;
  }

  if (!bundledArm || !bundledX64) {
    console.warn(
      `[prepare:gui-tools] Warning: cliclick bundled for ${bundledArm ? 'arm64' : ''}${bundledArm && bundledX64 ? ' & ' : ''}${bundledX64 ? 'x64' : ''}. ` +
      'If you build DMGs for both arch, make sure both binaries are available.'
    );
  }
}

main();

