/**
 * PathGuard - Security module to prevent unauthorized path access
 *
 * This module ensures that all file operations stay within the sandbox:
 * - Blocks access to /mnt/ (Windows filesystem)
 * - Blocks access to system directories
 * - Only allows access to /sandbox/workspace/{sessionId}/
 */

import { log, logError } from '../utils/logger';
import { SandboxSync } from './sandbox-sync';

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  sanitizedCommand?: string;
  sanitizedPath?: string;
}

// Forbidden path patterns for Linux/WSL - these should never be accessed
const FORBIDDEN_PATTERNS_LINUX = [
  /^\/mnt\//,              // Windows filesystem mounts
  /^\/home\/(?!.*\/\.claude\/sandbox)/,  // User home (except ~/.claude/sandbox)
  /^\/root\/(?!\.claude\/sandbox|\.nvm)/,  // Root directory (except .claude/sandbox and .nvm)
  /^\/etc\//,              // System configuration
  /^\/var\//,              // Variable data
  /^\/usr\//,              // System binaries
  /^\/bin\//,              // Essential binaries
  /^\/sbin\//,             // System binaries
  /^\/lib/,                // Libraries
  /^\/opt\//,              // Optional software
  /^\/tmp\//,              // Temp directory
  /^\/proc\//,             // Process info
  /^\/sys\//,              // System info
  /^\/dev\//,              // Device files
];

// Forbidden path patterns for macOS/Lima - these should never be accessed
const FORBIDDEN_PATTERNS_MAC = [
  /^\/System\//,           // macOS system
  /^\/Library\//,          // System library
  /^\/private\//,          // Private system files
  /^\/var\/(?!folders)/,   // System variable (allow /var/folders for temp)
  /^\/usr\//,              // System binaries
  /^\/bin\//,              // Essential binaries
  /^\/sbin\//,             // System binaries
  /^\/etc\//,              // System configuration
  /^\/opt\//,              // Optional software
  /^\/tmp\//,              // Temp directory (use /var/folders instead)
  /^\/dev\//,              // Device files
  /^\/Volumes\/(?!Macintosh HD\/Users)/,  // External volumes
  /^\/Applications\//,     // Applications folder
  /^\/cores\//,            // Core dumps
];

// Use platform-appropriate patterns
const FORBIDDEN_PATTERNS = process.platform === 'darwin'
  ? FORBIDDEN_PATTERNS_MAC
  : FORBIDDEN_PATTERNS_LINUX;

// Dangerous command patterns
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+(-rf?|--recursive)\s+\/(?!sandbox)/,  // rm -rf / (except /sandbox)
  /\bchmod\s+777\s+\//,                          // chmod 777 /
  /\bchown\s+.*\s+\//,                           // chown on root paths
  /\bdd\s+.*of=\/dev/,                           // dd to devices
  /\bmkfs/,                                       // format filesystems
  /\bsudo\s+.*\brm\b/,                           // sudo rm
  /\bcurl\s+.*\|\s*(ba)?sh/,                     // curl | bash
  /\bwget\s+.*\|\s*(ba)?sh/,                     // wget | bash
  />\s*\/etc\//,                                 // redirect to /etc
  />\s*\/dev\/(?!null)/,                         // redirect to devices (except /dev/null which is safe)
];

export class PathGuard {
  /**
   * Check if a path is allowed for the given session
   */
  static isPathAllowed(path: string, sessionId: string): ValidationResult {
    const session = SandboxSync.getSession(sessionId);

    if (!session) {
      return {
        allowed: false,
        reason: 'Session not found',
      };
    }

    // Normalize path
    const normalizedPath = path.replace(/\\/g, '/');

    // Check if path is within sandbox
    if (normalizedPath.startsWith(session.sandboxPath)) {
      return { allowed: true };
    }

    // Allow /root/.nvm for npm/node
    if (normalizedPath.startsWith('/root/.nvm')) {
      return { allowed: true };
    }

    // Allow global npm modules
    if (normalizedPath.includes('/node_modules/')) {
      return { allowed: true };
    }

    // Check forbidden patterns
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(normalizedPath)) {
        return {
          allowed: false,
          reason: `Access denied: ${normalizedPath} matches forbidden pattern ${pattern}`,
        };
      }
    }

    // Path doesn't start with sandbox and isn't explicitly allowed
    return {
      allowed: false,
      reason: `Access denied: ${normalizedPath} is outside sandbox ${session.sandboxPath}`,
    };
  }

  /**
   * Validate a Bash command for security issues
   */
  static validateCommand(command: string, sessionId: string): ValidationResult {
    const session = SandboxSync.getSession(sessionId);

    if (!session) {
      return {
        allowed: false,
        reason: 'Session not found',
      };
    }

    // Check for dangerous patterns
    for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
      if (pattern.test(command)) {
        logError(`[PathGuard] Blocked dangerous command: ${command.substring(0, 100)}`);
        return {
          allowed: false,
          reason: `Dangerous command pattern detected: ${pattern}`,
        };
      }
    }

    // Check for /mnt/ access
    if (/\/mnt\/[a-z]/i.test(command)) {
      logError(`[PathGuard] Blocked /mnt/ access in command: ${command.substring(0, 100)}`);
      return {
        allowed: false,
        reason: 'Direct /mnt/ access is not allowed in sandbox mode',
      };
    }

    // Check for Windows-style paths that weren't converted
    if (/[A-Za-z]:[\\\/]/.test(command)) {
      // This shouldn't happen if paths are properly converted, but log it
      log(`[PathGuard] Windows path detected in command, needs conversion`);
    }

    // Wrap the command to ensure it runs in the sandbox directory
    const sanitizedCommand = `cd "${session.sandboxPath}" && ${command}`;

    return {
      allowed: true,
      sanitizedCommand,
    };
  }

  /**
   * Convert a path reference in a command to sandbox path
   * This handles Windows paths like D:\project\file.txt
   */
  static convertPathInCommand(
    command: string,
    sessionId: string,
    windowsWorkspacePath: string
  ): string {
    const session = SandboxSync.getSession(sessionId);
    if (!session) return command;

    // Normalize Windows workspace path for comparison
    const normalizedWorkspace = windowsWorkspacePath.replace(/\\/g, '/').toLowerCase();

    // Replace Windows paths with sandbox paths
    let convertedCommand = command;

    // Pattern to match Windows paths: D:\something or D:/something
    const windowsPathPattern = /([A-Za-z]):[\\\/]([^\s;|&"'<>]*)/g;

    convertedCommand = convertedCommand.replace(windowsPathPattern, (match, drive, rest) => {
      const fullPath = `${drive}:/${rest.replace(/\\/g, '/')}`.toLowerCase();

      // Check if this path is within the workspace
      if (fullPath.startsWith(normalizedWorkspace.toLowerCase())) {
        // Convert to sandbox path
        const relativePath = fullPath.substring(normalizedWorkspace.length);
        return session.sandboxPath + relativePath;
      }

      // Path is outside workspace - this will be blocked by validateCommand
      log(`[PathGuard] Path outside workspace: ${match}`);
      return match; // Return as-is, will be blocked later
    });

    return convertedCommand;
  }

  /**
   * Get the sandbox working directory for a session
   */
  static getSandboxCwd(sessionId: string): string | null {
    const session = SandboxSync.getSession(sessionId);
    return session?.sandboxPath || null;
  }

  /**
   * Check if sandbox mode is active for a session
   */
  static isSandboxActive(sessionId: string): boolean {
    const session = SandboxSync.getSession(sessionId);
    return session?.initialized === true;
  }
}

export default PathGuard;

