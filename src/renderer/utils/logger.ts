/**
 * Frontend logging utility with timestamps
 * In Electron, logs are also captured by the main process logger
 * In browser, logs go to console only
 */

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

/**
 * Get formatted timestamp
 */
function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Format log arguments for consistent output
 */
function formatArgs(prefix: string, ...args: any[]): any[] {
  return [`[${getTimestamp()}] ${prefix}`, ...args];
}

/**
 * Log info message
 */
export function log(...args: any[]): void {
  if (isElectron) {
    // In Electron, console.log is captured by main process logger
    console.log(...formatArgs('[Renderer]', ...args));
  } else {
    // In browser, just use console
    console.log(...formatArgs('[Renderer]', ...args));
  }
}

/**
 * Log warning message
 */
export function logWarn(...args: any[]): void {
  if (isElectron) {
    console.warn(...formatArgs('[Renderer] WARN', ...args));
  } else {
    console.warn(...formatArgs('[Renderer] WARN', ...args));
  }
}

/**
 * Log error message
 */
export function logError(...args: any[]): void {
  if (isElectron) {
    console.error(...formatArgs('[Renderer] ERROR', ...args));
  } else {
    console.error(...formatArgs('[Renderer] ERROR', ...args));
  }
}

/**
 * Log debug message (only in development)
 */
export function logDebug(...args: any[]): void {
  if (process.env.NODE_ENV === 'development' || !isElectron) {
    if (isElectron) {
      console.log(...formatArgs('[Renderer] DEBUG', ...args));
    } else {
      console.log(...formatArgs('[Renderer] DEBUG', ...args));
    }
  }
}
