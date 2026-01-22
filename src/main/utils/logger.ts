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

// Developer logs enabled flag (can be toggled by user)
let devLogsEnabled = true;

/**
 * Initialize log file
 */
function initLogFile(): void {
  if (logFilePath) return; // Already initialized

  try {
    // Create logs directory in userData
    const userDataPath = app.getPath('userData');
    const logsDir = path.join(userDataPath, 'logs');
    
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Create log file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
    logFilePath = path.join(logsDir, `app-${timestamp}.log`);

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
App Version: ${app.getVersion()}
================================================================================

`;
    logStream.write(header);

    console.log(`[Logger] Log file initialized: ${logFilePath}`);

    // Cleanup old log files
    cleanupOldLogs(logsDir);
  } catch (error) {
    console.error('[Logger] Failed to initialize log file:', error);
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
      const filesToDelete = files.slice(MAX_LOG_FILES);
      for (const file of filesToDelete) {
        try {
          fs.unlinkSync(file.path);
          console.log(`[Logger] Deleted old log file: ${file.name}`);
        } catch (err) {
          console.error(`[Logger] Failed to delete log file ${file.name}:`, err);
        }
      }
    }
  } catch (error) {
    console.error('[Logger] Failed to cleanup old logs:', error);
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
      console.log(`[Logger] Log file size (${stats.size}) exceeds limit, rotating...`);
      
      // Close current stream
      logStream.end();
      
      // Reset and reinitialize
      logFilePath = null;
      logStream = null;
      initLogFile();
    }
  } catch (error) {
    console.error('[Logger] Failed to rotate log file:', error);
  }
}

/**
 * Write to log file
 */
function writeToFile(level: string, ...args: any[]): void {
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
      const message = args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');

      logStream.write(`[${timestamp}] [${level}] ${message}\n`);

      // Check if rotation is needed (every 100 log entries)
      if (Math.random() < 0.01) { // 1% chance to check
        rotateLogIfNeeded();
      }
    } catch (error) {
      console.error('[Logger] Failed to write to log file:', error);
    }
  }
}

function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace('T', ' ').replace('Z', '');
}

export function log(...args: any[]): void {
  console.log(`[${getTimestamp()}]`, ...args);
  writeToFile('INFO', ...args);
}

export function logWarn(...args: any[]): void {
  console.warn(`[${getTimestamp()}]`, ...args);
  writeToFile('WARN', ...args);
}

export function logError(...args: any[]): void {
  console.error(`[${getTimestamp()}]`, ...args);
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
  const userDataPath = app.getPath('userData');
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
    console.error('[Logger] Failed to get log files:', error);
    return [];
  }
}

/**
 * Set whether developer logs are enabled
 */
export function setDevLogsEnabled(enabled: boolean): void {
  devLogsEnabled = enabled;
  console.log(`[Logger] Developer logs ${enabled ? 'enabled' : 'disabled'}`);
  
  // If disabling, close the log file
  if (!enabled && logStream) {
    try {
      logStream.end();
      logStream = null;
      logFilePath = null;
      console.log('[Logger] Log file closed (dev logs disabled)');
    } catch (error) {
      console.error('[Logger] Failed to close log file:', error);
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
      console.log('[Logger] Log file closed');
    } catch (error) {
      console.error('[Logger] Failed to close log file:', error);
    }
  }
}
