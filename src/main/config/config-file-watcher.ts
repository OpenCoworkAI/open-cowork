/**
 * @module main/config/config-file-watcher
 *
 * Bidirectional sync between the encrypted config store and a plaintext
 * config.public.json file in the user data directory.
 *
 * - On external file change: debounce 500ms, then import safe fields.
 * - On config update from GUI: export safe fields to the file.
 * - Race condition handling: skip import if the change was triggered by our own export.
 */
import * as fs from 'fs';
import * as path from 'path';
import { configStore, ConfigStore } from './config-store';
import { log, logWarn } from '../utils/logger';

const DEBOUNCE_MS = 500;
const SKIP_IMPORT_WINDOW_MS = 1000;

let watcher: fs.FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastExportTimestamp = 0;
let started = false;

/**
 * Record that we just performed an export, so the next file-change event
 * within the skip window will be ignored (it's our own write).
 */
function markOwnExport(): void {
  lastExportTimestamp = Date.now();
}

/**
 * Check whether a file change event should be skipped because it was
 * triggered by our own export.
 */
function isOwnExport(): boolean {
  return Date.now() - lastExportTimestamp < SKIP_IMPORT_WINDOW_MS;
}

/**
 * Handle an external change to config.public.json.
 * Debounced to avoid rapid-fire imports during multi-write saves.
 */
function handleFileChange(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;

    if (isOwnExport()) {
      log('[ConfigFileWatcher] Skipping import — change was triggered by own export');
      return;
    }

    try {
      const imported = configStore.importSafeConfig();
      if (imported) {
        log('[ConfigFileWatcher] Imported external changes from config.public.json');
      }
    } catch (err) {
      logWarn('[ConfigFileWatcher] Error importing config file:', err);
    }
  }, DEBOUNCE_MS);
}

/**
 * Export the safe config to the plaintext file.
 * Called when the GUI updates config.
 */
export function exportOnConfigChange(): void {
  if (!started) return;
  try {
    markOwnExport();
    configStore.exportSafeConfig();
  } catch (err) {
    logWarn('[ConfigFileWatcher] Error exporting config:', err);
  }
}

/**
 * Import config from the public file on startup, retrying on failure.
 *
 * The initial read happens during app startup. If another process (e.g. an
 * editor doing an atomic save) is mid-write, the read can hit a
 * partially-written file. Retry with a short async delay to give the
 * concurrent writer time to finish, rather than silently corrupting config
 * from a torn read.
 */
async function tryImportWithRetry(store: ConfigStore, retries = 2, delayMs = 200): Promise<void> {
  for (let i = 0; i <= retries; i++) {
    try {
      const imported = store.importSafeConfig();
      if (imported) {
        log('[ConfigFileWatcher] Imported existing config.public.json on startup');
      }
      return;
    } catch (err) {
      if (i === retries) {
        logWarn('[ConfigFileWatcher] Error importing config on startup after retries:', err);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Start the bidirectional file watcher.
 * - If config.public.json does not exist, creates it (initial export).
 * - If it exists, imports it (file takes precedence for safe fields).
 * - Sets up fs.watch() on the parent directory for ongoing external changes.
 */
export async function startConfigFileWatcher(): Promise<void> {
  if (started) return;
  started = true;

  const filePath = configStore.getPublicConfigPath();
  log('[ConfigFileWatcher] Starting watcher for:', filePath);

  // Initial sync: if file exists, import; otherwise, export to create it.
  if (fs.existsSync(filePath)) {
    await tryImportWithRetry(configStore);
  } else {
    try {
      markOwnExport();
      configStore.exportSafeConfig();
      log('[ConfigFileWatcher] Created initial config.public.json');
    } catch (err) {
      logWarn('[ConfigFileWatcher] Error creating initial config file:', err);
    }
  }

  // Start watching the parent directory rather than the file itself.
  // fs.watch() on Linux (inotify) tracks the file by inode: if an editor
  // replaces the file atomically (write to temp file, rename over the
  // original), the watch on the old inode goes silently dead. Watching the
  // directory and filtering by basename survives atomic replacement.
  const parentDir = path.dirname(filePath);
  const basename = path.basename(filePath);
  try {
    watcher = fs.watch(parentDir, (_eventType, filename) => {
      if (filename !== basename) return;
      handleFileChange();
    });

    watcher.on('error', (err) => {
      logWarn('[ConfigFileWatcher] Watcher error:', err);
    });
  } catch (err) {
    logWarn('[ConfigFileWatcher] Failed to start file watcher:', err);
  }
}

/**
 * Stop the file watcher and clean up resources.
 */
export function stopConfigFileWatcher(): void {
  if (!started) return;
  started = false;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (watcher) {
    watcher.close();
    watcher = null;
  }

  log('[ConfigFileWatcher] Stopped');
}
