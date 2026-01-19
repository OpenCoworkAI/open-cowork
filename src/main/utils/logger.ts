/**
 * Shared logging utility with timestamps
 */

function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace('T', ' ').replace('Z', '');
}

export function log(...args: any[]): void {
  console.log(`[${getTimestamp()}]`, ...args);
}

export function logWarn(...args: any[]): void {
  console.warn(`[${getTimestamp()}]`, ...args);
}

export function logError(...args: any[]): void {
  console.error(`[${getTimestamp()}]`, ...args);
}
