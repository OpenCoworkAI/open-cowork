/**
 * MCP Logger Utility
 * 
 * Provides logging functionality for MCP servers with both console output
 * and file logging capabilities. Logs are written to the main application's log directory.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

import { redactSensitiveText } from './mcp-log-redaction.js';
import { resolveOpenCoworkLogsDirectory } from './mcp-log-paths.js';

// Use a session-level timestamp for the log filename
let mcpLogFilename: string | null = null;
let logInitialized = false;

/**
 * Get the application's log directory
 * This matches the path used by the main application logger
 */
function getLogsDirectory(): string {
  return resolveOpenCoworkLogsDirectory();
}

/**
 * Initialize log file with header (call once at startup)
 */
function initializeLogFile(): void {
  if (logInitialized) return;
  
  try {
    const timestamp = new Date().toISOString();
    const fileTimestamp = timestamp.replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
    mcpLogFilename = `mcp-server-${fileTimestamp}.log`;
    
    const logDir = getLogsDirectory();
    const logPath = path.join(logDir, mcpLogFilename);
    
    // Write header synchronously to ensure it's captured
    const header = `
================================================================================
MCP Server Log - Started at ${timestamp}
Platform: ${os.platform()}
Node: ${process.version}
Working Directory: ${process.cwd()}
Process ID: ${process.pid}
Arguments: ${JSON.stringify(process.argv.map(arg => /^(sk-|key-|token-|secret-)/i.test(arg) || (arg.length > 40 && /^[A-Za-z0-9+/=_-]+$/.test(arg)) ? '[REDACTED]' : arg))}
================================================================================
`;
    
    fsSync.writeFileSync(logPath, header);
    logInitialized = true;
    
    console.error(`[MCP Logger] Log initialized: ${logPath}`);
  } catch (error) {
    console.error(`[MCP Logger] Failed to initialize log: ${error}`);
  }
}

/**
 * Write log message to both stderr and a log file in the application's log directory
 * 
 * @param content - The log content to write
 * @param label - Optional label for the log entry
 */
const MAX_LOG_SIZE = 50 * 1024 * 1024; // 50MB

export function writeMCPLog(content: string, label?: string): void {
  // Defense-in-depth: every log line passes through sensitive-value redaction
  // (mirrors agent-desktop trace sanitization) so ad-hoc template logging
  // across the MCP servers can never persist raw text, tokens, URLs,
  // clipboard content or base64 screenshots to disk.
  const safeContent = redactSensitiveText(content);

  // Initialize log file on first call
  if (!logInitialized) {
    initializeLogFile();
  }

  const timestamp = new Date().toISOString();
  const formattedLabel = label ? ` [${label}]` : '';

  // Print to stderr (with simpler format for console)
  console.error(`[${timestamp}]${formattedLabel} ${safeContent}`);

  // If log not initialized, can't write to file
  if (!mcpLogFilename || !logInitialized) {
    return;
  }

  // Get log path
  const logDir = getLogsDirectory();
  const logPath = path.join(logDir, mcpLogFilename);

  // Log rotation: if file exceeds MAX_LOG_SIZE, rotate it
  try {
    const stat = fsSync.statSync(logPath);
    if (stat.size > MAX_LOG_SIZE) {
      fsSync.renameSync(logPath, logPath + '.old');
    }
  } catch {
    // File may not exist yet, ignore
  }

  // Format log entry for file (with more detail)
  const labelText = label ? `${label}:\n${'='.repeat(80)}\n` : '';
  const logEntry = `\n${'='.repeat(80)}\n[${timestamp}]${formattedLabel}\n${labelText}${safeContent}\n${'='.repeat(80)}\n`;

  try {
    // Use sync write for critical logs (Bootstrap, Error, Fatal, Initialization)
    if (label && (label.includes('Bootstrap') || label.includes('Error') || label.includes('Fatal') || label.includes('Initialization'))) {
      fsSync.appendFileSync(logPath, logEntry);
    } else {
      // Async write for normal logs
      fs.appendFile(logPath, logEntry).catch((error) => {
        console.error(`[MCP Logger] Failed to write to log file: ${error}`);
      });
    }
  } catch (error) {
    console.error(`[MCP Logger] Failed to write log: ${error}`);
  }
}

// Add process error handlers at module load time
process.on('uncaughtException', (error) => {
  console.error('[MCP] UNCAUGHT EXCEPTION:', error);
  if (logInitialized && mcpLogFilename) {
    try {
      const logDir = getLogsDirectory();
      const logPath = path.join(logDir, mcpLogFilename);
      const errorLog = `\n${'='.repeat(80)}\nUNCAUGHT EXCEPTION at ${new Date().toISOString()}\n${error.stack || error.message}\n${'='.repeat(80)}\n`;
      fsSync.appendFileSync(logPath, errorLog);
    } catch (e) {
      // ignore
    }
  }
  // Don't call process.exit(1) — let the MCP SDK handle recovery
});

process.on('unhandledRejection', (reason) => {
  console.error('[MCP] UNHANDLED REJECTION:', reason);
  if (logInitialized && mcpLogFilename) {
    try {
      const logDir = getLogsDirectory();
      const logPath = path.join(logDir, mcpLogFilename);
      const errorLog = `\n${'='.repeat(80)}\nUNHANDLED REJECTION at ${new Date().toISOString()}\n${String(reason)}\n${'='.repeat(80)}\n`;
      fsSync.appendFileSync(logPath, errorLog);
    } catch (e) {
      // ignore
    }
  }
});

// Initialize log immediately when module loads
try {
  initializeLogFile();
  writeMCPLog(`mcp-logger.ts module loaded`, 'Module Init');
  writeMCPLog(`Process: ${process.argv.map(arg => /^(sk-|key-|token-|secret-)/i.test(arg) || (arg.length > 40 && /^[A-Za-z0-9+/=_-]+$/.test(arg)) ? '[REDACTED]' : arg).join(' ')}`, 'Module Init');
  writeMCPLog(`CWD: ${process.cwd()}`, 'Module Init');
} catch (error) {
  console.error('[MCP Logger] Failed to initialize at module load:', error);
}
