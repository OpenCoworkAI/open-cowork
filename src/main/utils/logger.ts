/**
 * Shared logging utility with timestamps and file logging
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Log file configuration
let logFilePath: string | null = null;
let logStream: fs.WriteStream | null = null;
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_LOG_FILES = 5; // Keep last 5 log files
let logFileSequence = 0;
const MAX_LOG_STRING_LENGTH = 4000;
const MAX_LOG_OBJECT_DEPTH = 4;
const MAX_LOG_OBJECT_KEYS = 40;
const MAX_LOG_ARRAY_ITEMS = 20;

// Developer logs enabled flag (can be toggled by user)
let devLogsEnabled = true;

function resolveUserDataPath(): string {
  try {
    if (app && typeof app.getPath === 'function') {
      const userDataPath = app.getPath('userData');
      if (userDataPath?.trim()) {
        return userDataPath;
      }
    }
  } catch {
    // Fallback to local path when Electron app context is unavailable
  }

  return path.join(process.cwd(), '.cowork-user-data');
}

function resolveAppVersion(): string {
  try {
    if (app && typeof app.getVersion === 'function') {
      return app.getVersion();
    }
  } catch {
    // ignore and return fallback
  }
  return 'unknown';
}

/**
 * Initialize log file
 */
function initLogFile(): void {
  if (logFilePath && logStream) return; // Already initialized and writable

  try {
    // Create logs directory in userData
    const userDataPath = resolveUserDataPath();
    const logsDir = path.join(userDataPath, 'logs');

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Create log file with timestamp
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .split('Z')[0];
    logFileSequence += 1;
    logFilePath = path.join(logsDir, `app-${timestamp}-${logFileSequence}.log`);

    // Create write stream
    logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

    // Write header
    const header = `
================================================================================
Open Cowork Application Log
Started: ${new Date().toISOString()}
Platform: ${process.platform}
Arch: ${process.arch}
Node: ${process.version}
Electron: ${process.versions.electron}
App Version: ${resolveAppVersion()}
================================================================================

`;
    logStream.write(header);

    safeConsoleLog(`[Logger] Log file initialized: ${logFilePath}`);

    // Cleanup old log files
    cleanupOldLogs(logsDir);
  } catch (error) {
    safeConsoleError('[Logger] Failed to initialize log file:', error);
  }
}

/**
 * Cleanup old log files, keep only MAX_LOG_FILES
 */
function cleanupOldLogs(logsDir: string): void {
  try {
    const files = fs
      .readdirSync(logsDir)
      .filter((f) => f.startsWith('app-') && f.endsWith('.log'))
      .flatMap((f) => {
        const filePath = path.join(logsDir, f);
        try {
          return [
            {
              name: f,
              path: filePath,
              mtime: fs.statSync(filePath).mtime.getTime(),
            },
          ];
        } catch (err) {
          const errno = err as NodeJS.ErrnoException;
          if (errno.code === 'ENOENT') {
            // File disappeared between readdir and stat; ignore.
            return [];
          }
          throw err;
        }
      })
      .sort((a, b) => b.mtime - a.mtime); // Sort by modification time, newest first

    // Delete old files
    if (files.length > MAX_LOG_FILES) {
      const activeLogFilePath = logFilePath;
      const filesToDelete = files
        .slice(MAX_LOG_FILES)
        .filter((file) => !activeLogFilePath || file.path !== activeLogFilePath);
      for (const file of filesToDelete) {
        try {
          fs.unlinkSync(file.path);
          safeConsoleLog(`[Logger] Deleted old log file: ${file.name}`);
        } catch (err) {
          const errno = err as NodeJS.ErrnoException;
          if (errno.code === 'ENOENT') {
            // File already removed by another process/test; ignore.
            continue;
          }
          safeConsoleError(`[Logger] Failed to delete log file ${file.name}:`, err);
        }
      }
    }
  } catch (error) {
    safeConsoleError('[Logger] Failed to cleanup old logs:', error);
  }
}

/**
 * Rotate log file if it exceeds MAX_LOG_SIZE
 */
function rotateLogIfNeeded(): void {
  if (!logFilePath || !logStream) return;

  try {
    const stats = fs.statSync(logFilePath);
    if (stats.size > MAX_LOG_SIZE) {
      safeConsoleLog(`[Logger] Log file size (${stats.size}) exceeds limit, rotating...`);

      // Close current stream
      logStream.end();

      // Reset and reinitialize
      logFilePath = null;
      logStream = null;
      initLogFile();
    }
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === 'ENOENT') {
      // Current log file was removed unexpectedly; recreate a fresh file.
      logFilePath = null;
      logStream = null;
      initLogFile();
      return;
    }
    safeConsoleError('[Logger] Failed to rotate log file:', error);
  }
}

function truncateLogText(value: string, maxLength = MAX_LOG_STRING_LENGTH): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}… [truncated ${value.length - maxLength} chars]`;
}

function normalizeLogValue(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value instanceof Error) {
    if (seen.has(value)) {
      return '[Circular Error]';
    }
    seen.add(value);
    const err = value as Error & { cause?: unknown };
    const extraEntries = Object.entries(err as unknown as Record<string, unknown>).filter(
      ([key]) => !['name', 'message', 'stack', 'cause'].includes(key)
    );
    return {
      name: err.name,
      message: truncateLogText(err.message || ''),
      stack: err.stack ? truncateLogText(err.stack, MAX_LOG_STRING_LENGTH * 2) : undefined,
      cause: err.cause !== undefined ? normalizeLogValue(err.cause, seen, depth + 1) : undefined,
      meta:
        extraEntries.length > 0
          ? normalizeLogValue(Object.fromEntries(extraEntries), seen, depth + 1)
          : undefined,
    };
  }

  if (typeof value === 'string') {
    return truncateLogText(value);
  }

  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return `${value}n`;
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`;
  }

  if (depth >= MAX_LOG_OBJECT_DEPTH) {
    return '[Max Depth Reached]';
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_LOG_ARRAY_ITEMS)
      .map((item) => normalizeLogValue(item, seen, depth + 1))
      .concat(
        value.length > MAX_LOG_ARRAY_ITEMS
          ? [`[+${value.length - MAX_LOG_ARRAY_ITEMS} more items]`]
          : []
      );
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular Object]';
    }
    seen.add(value);

    const entries = Object.entries(value as Record<string, unknown>);
    const limitedEntries = entries
      .slice(0, MAX_LOG_OBJECT_KEYS)
      .map(([key, item]) => [key, normalizeLogValue(item, seen, depth + 1)]);

    if (entries.length > MAX_LOG_OBJECT_KEYS) {
      limitedEntries.push([
        '__truncated__',
        `[+${entries.length - MAX_LOG_OBJECT_KEYS} more keys]`,
      ]);
    }

    return Object.fromEntries(limitedEntries);
  }

  return String(value);
}

function serializeLogArg(arg: unknown): string {
  const normalized = normalizeLogValue(arg);
  if (typeof normalized === 'string') {
    return normalized;
  }
  try {
    return JSON.stringify(normalized, null, 2);
  } catch {
    return String(normalized);
  }
}

/**
 * Write to log file
 */
function writeToFile(level: string, ...args: unknown[]): void {
  // Skip if dev logs are disabled
  if (!devLogsEnabled) {
    return;
  }

  if (!logStream) {
    initLogFile();
  }

  if (logStream) {
    try {
      const timestamp = getTimestamp();
      const message = args.map((arg) => serializeLogArg(arg)).join(' ');

      logStream.write(`[${timestamp}] [${level}] ${message}\n`);

      // Check if rotation is needed (every 100 log entries)
      if (Math.random() < 0.01) {
        // 1% chance to check
        rotateLogIfNeeded();
      }
    } catch (error) {
      safeConsoleError('[Logger] Failed to write to log file:', error);
    }
  }
}

function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace('T', ' ').replace('Z', '');
}

export function log(...args: unknown[]): void {
  safeConsoleLog(`[${getTimestamp()}]`, ...args);
  writeToFile('INFO', ...args);
}

export function logWarn(...args: unknown[]): void {
  safeConsoleWarn(`[${getTimestamp()}]`, ...args);
  writeToFile('WARN', ...args);
}

export function logError(...args: unknown[]): void {
  safeConsoleError(`[${getTimestamp()}]`, ...args);
  writeToFile('ERROR', ...args);
}

/**
 * Get current log file path
 */
export function getLogFilePath(): string | null {
  if (!logFilePath) {
    initLogFile();
  }
  return logFilePath;
}

/**
 * Get logs directory path
 */
export function getLogsDirectory(): string {
  const userDataPath = resolveUserDataPath();
  return path.join(userDataPath, 'logs');
}

/**
 * Get all log files
 */
export function getAllLogFiles(): Array<{ name: string; path: string; size: number; mtime: Date }> {
  try {
    const logsDir = getLogsDirectory();
    if (!fs.existsSync(logsDir)) {
      return [];
    }

    return fs
      .readdirSync(logsDir)
      .filter((f) => f.startsWith('app-') && f.endsWith('.log'))
      .map((f) => {
        const filePath = path.join(logsDir, f);
        const stats = fs.statSync(filePath);
        return {
          name: f,
          path: filePath,
          size: stats.size,
          mtime: stats.mtime,
        };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  } catch (error) {
    safeConsoleError('[Logger] Failed to get log files:', error);
    return [];
  }
}

/**
 * Set whether developer logs are enabled
 */
export function setDevLogsEnabled(enabled: boolean): void {
  devLogsEnabled = enabled;
  safeConsoleLog(`[Logger] Developer logs ${enabled ? 'enabled' : 'disabled'}`);

  // If disabling, close the log file
  if (!enabled && logStream) {
    try {
      logStream.end();
      logStream = null;
      logFilePath = null;
      safeConsoleLog('[Logger] Log file closed (dev logs disabled)');
    } catch (error) {
      safeConsoleError('[Logger] Failed to close log file:', error);
    }
  }
}

/**
 * Get whether developer logs are enabled
 */
export function isDevLogsEnabled(): boolean {
  return devLogsEnabled;
}

/**
 * Close log file (call on app shutdown)
 */
export function closeLogFile(): void {
  if (logStream) {
    try {
      logStream.end();
      logStream = null;
      safeConsoleLog('[Logger] Log file closed');
    } catch (error) {
      safeConsoleError('[Logger] Failed to close log file:', error);
    }
  }
  logFilePath = null;
}

function isBrokenPipeError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EPIPE'
  );
}

function safeConsoleCall(method: (...args: unknown[]) => void, ...args: unknown[]): void {
  try {
    method(...args);
  } catch (error) {
    if (!isBrokenPipeError(error)) {
      throw error;
    }
  }
}

function safeConsoleLog(...args: unknown[]): void {
  safeConsoleCall(console.log, ...args);
}

function safeConsoleWarn(...args: unknown[]): void {
  safeConsoleCall(console.warn, ...args);
}

function safeConsoleError(...args: unknown[]): void {
  safeConsoleCall(console.error, ...args);
}
