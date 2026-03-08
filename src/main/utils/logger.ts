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
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
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
    const files = fs.readdirSync(logsDir)
      .filter(f => f.startsWith('app-') && f.endsWith('.log'))
      .map(f => ({
        name: f,
        path: path.join(logsDir, f),
        mtime: fs.statSync(path.join(logsDir, f)).mtime.getTime(),
      }))
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

function serializeLogArg(arg: unknown, seen = new Set<unknown>()): string {
  if (arg instanceof Error) {
    if (seen.has(arg)) {
      return '[Circular Error]';
    }
    seen.add(arg);
    const err = arg as Error & { cause?: unknown };
    const lines: string[] = [];
    lines.push(`${err.name}: ${err.message}`);
    if (err.stack) {
      lines.push(err.stack);
    }
    if (err.cause !== undefined) {
      lines.push(`Cause: ${serializeLogArg(err.cause, seen)}`);
    }

    const extraEntries = Object.entries(err as unknown as Record<string, unknown>).filter(
      ([key]) => !['name', 'message', 'stack', 'cause'].includes(key)
    );
    if (extraEntries.length > 0) {
      const extras = Object.fromEntries(extraEntries);
      lines.push(`Meta: ${serializeLogArg(extras, seen)}`);
    }
    return lines.join('\n');
  }

  if (typeof arg === 'object' && arg !== null) {
    if (seen.has(arg)) {
      return '[Circular Object]';
    }
    seen.add(arg);
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      return String(arg);
    }
  }

  return String(arg);
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
      if (Math.random() < 0.01) { // 1% chance to check
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

    return fs.readdirSync(logsDir)
      .filter(f => f.startsWith('app-') && f.endsWith('.log'))
      .map(f => {
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
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'EPIPE'
  );
}

function safeConsoleCall(
  method: (...args: unknown[]) => void,
  ...args: unknown[]
): void {
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
