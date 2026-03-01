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

// Use a session-level timestamp for the log filename
let mcpLogFilename: string | null = null;
let logsDir: string | null = null;
let logInitialized = false;

/**
 * Get the application's log directory
 * This matches the path used by the main application logger
 */
function getLogsDirectory(): string {
  if (logsDir) return logsDir;
  
  // Determine the app data directory based on platform
  // This should match app.getPath('userData') in Electron
  const platform = os.platform();
  let appDataDir: string;
  
  if (platform === 'darwin') {
    // macOS: ~/Library/Application Support/open-cowork
    appDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'open-cowork');
  } else if (platform === 'win32') {
    // Windows: %APPDATA%/open-cowork
    appDataDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'open-cowork');
  } else {
    // Linux: ~/.config/open-cowork
    appDataDir = path.join(os.homedir(), '.config', 'open-cowork');
  }
  
  logsDir = path.join(appDataDir, 'logs');
  
  // Ensure logs directory exists (sync for initialization)
  try {
    if (!fsSync.existsSync(logsDir)) {
      fsSync.mkdirSync(logsDir, { recursive: true });
    }
  } catch (error) {
    console.error('[MCP Logger] Failed to create logs directory:', error);
    // Fallback to current directory
    logsDir = process.cwd();
  }
  
  return logsDir;
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
Arguments: ${JSON.stringify(process.argv)}
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
export function writeMCPLog(content: string, label?: string): void {
  // Initialize log file on first call
  if (!logInitialized) {
    initializeLogFile();
  }
  
  const timestamp = new Date().toISOString();
  const formattedLabel = label ? ` [${label}]` : '';
  
  // Print to stderr (with simpler format for console)
  console.error(`[${timestamp}]${formattedLabel} ${content}`);
  
  // If log not initialized, can't write to file
  if (!mcpLogFilename || !logInitialized) {
    return;
  }
  
  // Get log path
  const logDir = getLogsDirectory();
  const logPath = path.join(logDir, mcpLogFilename);
  
  // Format log entry for file (with more detail)
  const labelText = label ? `${label}:\n${'='.repeat(80)}\n` : '';
  const logEntry = `\n${'='.repeat(80)}\n[${timestamp}]${formattedLabel}\n${labelText}${content}\n${'='.repeat(80)}\n`;
  
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
  process.exit(1);
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
  writeMCPLog(`Process: ${process.argv.join(' ')}`, 'Module Init');
  writeMCPLog(`CWD: ${process.cwd()}`, 'Module Init');
} catch (error) {
  console.error('[MCP Logger] Failed to initialize at module load:', error);
}
