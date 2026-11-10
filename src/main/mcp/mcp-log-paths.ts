/**
 * Shared resolution of the Open Cowork logs directory.
 *
 * Extracted from `mcp-logger.ts` so that other main-process modules
 * (notably `mcp-metrics.ts`) can persist artifacts in the exact same place
 * without duplicating platform-specific path logic.
 *
 * This module is intentionally side-effect free (no process handlers, no file
 * writes on import): it is imported both by the Electron main process and by
 * the spawned MCP server processes.
 */
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';

let cachedLogsDir: string | null = null;

/**
 * Get (and create) the application logs directory.
 *
 * Mirrors the Electron `app.getPath('userData')` layout:
 *   - macOS:   ~/Library/Application Support/open-cowork/logs
 *   - Windows: %APPDATA%/open-cowork/logs
 *   - Linux:   ~/.config/open-cowork/logs
 *
 * Falls back to the current working directory when the directory cannot be
 * created (same fallback as the previous inline implementation).
 */
export function resolveOpenCoworkLogsDirectory(): string {
  if (cachedLogsDir) return cachedLogsDir;

  const platform = os.platform();
  let appDataDir: string;

  if (platform === 'darwin') {
    appDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'open-cowork');
  } else if (platform === 'win32') {
    appDataDir = path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'open-cowork'
    );
  } else {
    appDataDir = path.join(os.homedir(), '.config', 'open-cowork');
  }

  const dir = path.join(appDataDir, 'logs');

  try {
    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }
  } catch {
    // Fallback to current directory (matches legacy behaviour)
    cachedLogsDir = process.cwd();
    return cachedLogsDir;
  }

  cachedLogsDir = dir;
  return dir;
}

/** Test-only helper: clears the memoized directory. */
export function resetOpenCoworkLogsDirectoryCache(): void {
  cachedLogsDir = null;
}
