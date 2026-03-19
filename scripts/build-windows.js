#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const CACHE_ROOT = path.resolve(
  process.env.OPEN_COWORK_BUILD_ROOT || path.join(PROJECT_ROOT, '.build-cache')
);

const DIRS = {
  root: CACHE_ROOT,
  temp: path.join(CACHE_ROOT, 'temp'),
  appDataRoaming: path.join(CACHE_ROOT, 'appdata', 'Roaming'),
  appDataLocal: path.join(CACHE_ROOT, 'appdata', 'Local'),
  electronCache: path.join(CACHE_ROOT, 'electron'),
  electronBuilderCache: path.join(CACHE_ROOT, 'electron-builder'),
  npmCache: path.join(CACHE_ROOT, 'npm-cache'),
};
const LOCAL_ELECTRON_DIST = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveNpmCommand() {
  if (process.platform === 'win32') {
    return 'npm.cmd';
  }
  return 'npm';
}

function toPowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function isValidZipArchive(zipPath, requiredEntry) {
  const inspectScript = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$zip = ${toPowerShellLiteral(zipPath)}`,
    `$requiredEntry = ${toPowerShellLiteral(requiredEntry)}`,
    '$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)',
    'try {',
    '  if ($archive.Entries.Count -le 0) { exit 2 }',
    '  $match = $archive.Entries | Where-Object { $_.FullName -eq $requiredEntry } | Select-Object -First 1',
    '  if (-not $match) { exit 3 }',
    '} finally {',
    '  $archive.Dispose()',
    '}',
  ].join('; ');

  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', inspectScript], {
    stdio: 'pipe',
    encoding: 'utf8',
  });

  return result.status === 0;
}

function cleanInvalidElectronCache(electronCacheDir) {
  if (process.platform !== 'win32' || !fs.existsSync(electronCacheDir)) {
    return;
  }

  const zipFiles = fs.readdirSync(electronCacheDir)
    .filter((name) => /^electron-v.+-win32-.+\.zip$/i.test(name))
    .map((name) => path.join(electronCacheDir, name));

  for (const zipPath of zipFiles) {
    if (isValidZipArchive(zipPath, 'electron.exe')) {
      console.log('[build:win] Electron cache OK:', zipPath);
      continue;
    }

    console.warn('[build:win] Removing invalid Electron cache:', zipPath);
    fs.rmSync(zipPath, { force: true });
  }
}

function main() {
  if (process.platform !== 'win32') {
    console.warn('[build:win] This helper is intended for Windows hosts. Skipping build.');
    process.exit(0);
  }

  Object.values(DIRS).forEach(ensureDir);

  const forwardedArgs = process.argv.slice(2);
  const builderArgs = forwardedArgs.length > 0 ? [...forwardedArgs] : ['--win', 'nsis'];
  const env = {
    ...process.env,
    APPDATA: DIRS.appDataRoaming,
    LOCALAPPDATA: DIRS.appDataLocal,
    TEMP: DIRS.temp,
    TMP: DIRS.temp,
    ELECTRON_CACHE: DIRS.electronCache,
    ELECTRON_BUILDER_CACHE: DIRS.electronBuilderCache,
    NPM_CONFIG_CACHE: DIRS.npmCache,
    npm_config_cache: DIRS.npmCache,
  };

  delete env.ELECTRON_RUN_AS_NODE;
  cleanInvalidElectronCache(DIRS.electronCache);

  const hasElectronDistOverride = builderArgs.some((arg) => arg.includes('electronDist'));
  if (!hasElectronDistOverride && fs.existsSync(LOCAL_ELECTRON_DIST)) {
    builderArgs.push(`--config.electronDist=${LOCAL_ELECTRON_DIST}`);
  }

  console.log('[build:win] Using cache root:', DIRS.root);
  console.log('[build:win] TEMP:', DIRS.temp);
  console.log('[build:win] APPDATA:', DIRS.appDataRoaming);
  console.log('[build:win] LOCALAPPDATA:', DIRS.appDataLocal);
  console.log('[build:win] ELECTRON_CACHE:', DIRS.electronCache);
  console.log('[build:win] ELECTRON_BUILDER_CACHE:', DIRS.electronBuilderCache);
  console.log('[build:win] NPM_CONFIG_CACHE:', DIRS.npmCache);
  if (builderArgs.some((arg) => arg.includes('electronDist'))) {
    console.log('[build:win] electronDist:', LOCAL_ELECTRON_DIST);
  }
  console.log('[build:win] Running build with args:', builderArgs.join(' '));

  const child = spawn(resolveNpmCommand(), ['run', 'build', '--', ...builderArgs], {
    cwd: PROJECT_ROOT,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`[build:win] Build terminated by signal: ${signal}`);
      process.exit(1);
    }
    process.exit(code ?? 1);
  });

  child.on('error', (error) => {
    console.error('[build:win] Failed to start build:', error.message);
    process.exit(1);
  });
}

main();
