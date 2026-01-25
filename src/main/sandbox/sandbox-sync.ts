/**
 * SandboxSync - Manages file synchronization between Windows and WSL sandbox
 *
 * This module provides complete isolation by:
 * 1. Copying files from Windows to an isolated WSL directory (~/.claude/sandbox/{sessionId})
 * 2. Running all operations within the isolated directory
 * 3. Syncing changes back to Windows when requested
 * 
 * Lifecycle:
 * - Sandbox is created when a conversation starts (first message)
 * - Sandbox persists across multiple messages in the same conversation
 * - Sandbox is deleted when:
 *   - User deletes the conversation
 *   - App is closed/shutdown
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { log, logError } from '../utils/logger';
import { pathConverter } from './wsl-bridge';

const execAsync = promisify(exec);

export interface SyncSession {
  sessionId: string;
  windowsPath: string;         // Original Windows path (e.g., D:\project)
  sandboxPath: string;         // WSL sandbox path (e.g., ~/.claude/sandbox/{sessionId})
  distro: string;              // WSL distro name
  initialized: boolean;
  fileCount?: number;
  totalSize?: number;
  lastSyncTime?: number;       // Last sync timestamp
}

export interface SyncResult {
  success: boolean;
  sandboxPath: string;
  fileCount: number;
  totalSize: number;
  error?: string;
}

// Directories/files to exclude from sync (to improve performance)
const SYNC_EXCLUDES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '*.pyc',
  '.next',
  '.cache',
  'coverage',
  '.nyc_output',
  'venv',
  '.venv',
  'env',
  '.env.local',
  '*.log',
  '.DS_Store',
  'Thumbs.db',
];

// Active sync sessions
const sessions = new Map<string, SyncSession>();

export class SandboxSync {

  /**
   * Check if a sandbox session already exists for the given session ID
   */
  static hasSession(sessionId: string): boolean {
    return sessions.has(sessionId);
  }

  /**
   * Get all active session IDs
   */
  static getAllSessionIds(): string[] {
    return Array.from(sessions.keys());
  }

  /**
   * Initialize a new sync session or return existing one
   * Copies files from Windows to WSL sandbox (only on first init)
   */
  static async initSync(
    windowsPath: string,
    sessionId: string,
    distro: string
  ): Promise<SyncResult> {
    // Check if session already exists (sandbox persists across messages)
    const existingSession = sessions.get(sessionId);
    if (existingSession && existingSession.initialized) {
      log(`[SandboxSync] Reusing existing sandbox for session ${sessionId}`);
      log(`[SandboxSync]   Sandbox path: ${existingSession.sandboxPath}`);
      
      // Verify sandbox still exists in WSL
      try {
        await this.wslExec(distro, `test -d "${existingSession.sandboxPath}"`);
        return {
          success: true,
          sandboxPath: existingSession.sandboxPath,
          fileCount: existingSession.fileCount || 0,
          totalSize: existingSession.totalSize || 0,
        };
      } catch {
        // Sandbox was deleted externally, reinitialize
        log(`[SandboxSync] Sandbox directory no longer exists, reinitializing...`);
        sessions.delete(sessionId);
      }
    }

    log(`[SandboxSync] Initializing sync for session ${sessionId}`);
    log(`[SandboxSync]   Windows path: ${windowsPath}`);
    log(`[SandboxSync]   Distro: ${distro}`);

    // Get the actual home directory path from WSL (use cd ~ && pwd since $HOME won't expand in single quotes)
    const homeResult = await this.wslExec(distro, 'cd ~ && pwd');
    const homeDir = homeResult.stdout.trim() || '/root';
    const sandboxPath = `${homeDir}/.claude/sandbox/${sessionId}`;
    log(`[SandboxSync]   Sandbox path: ${sandboxPath}`);

    try {
      // Create sandbox directory
      await this.wslExec(distro, `mkdir -p "${sandboxPath}"`);

      // Convert Windows path to WSL /mnt/ path for rsync source
      const wslSourcePath = pathConverter.toWSL(windowsPath);
      log(`[SandboxSync]   WSL source path: ${wslSourcePath}`);

      // Build rsync exclude arguments
      const excludeArgs = SYNC_EXCLUDES.map(e => `--exclude="${e}"`).join(' ');

      // Sync files from Windows to sandbox
      const rsyncCmd = `rsync -av --delete ${excludeArgs} "${wslSourcePath}/" "${sandboxPath}/"`;
      log(`[SandboxSync] Running: ${rsyncCmd}`);

      await this.wslExec(distro, rsyncCmd, 300000); // 5 min timeout

      // Count files and get size
      const countResult = await this.wslExec(distro, `find "${sandboxPath}" -type f | wc -l`);
      const sizeResult = await this.wslExec(distro, `du -sb "${sandboxPath}" | cut -f1`);

      const fileCount = parseInt(countResult.stdout.trim()) || 0;
      const totalSize = parseInt(sizeResult.stdout.trim()) || 0;

      // Store session info
      const session: SyncSession = {
        sessionId,
        windowsPath,
        sandboxPath,
        distro,
        initialized: true,
        fileCount,
        totalSize,
        lastSyncTime: Date.now(),
      };
      sessions.set(sessionId, session);

      log(`[SandboxSync] Sync complete: ${fileCount} files, ${this.formatSize(totalSize)}`);

      return {
        success: true,
        sandboxPath,
        fileCount,
        totalSize,
      };
    } catch (error) {
      logError('[SandboxSync] Init sync failed:', error);
      return {
        success: false,
        sandboxPath,
        fileCount: 0,
        totalSize: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Sync changes from sandbox back to Windows (without cleanup)
   * Called after each message to persist changes while keeping sandbox alive
   */
  static async syncToWindows(sessionId: string): Promise<SyncResult> {
    const session = sessions.get(sessionId);
    if (!session) {
      logError(`[SandboxSync] Session not found: ${sessionId}`);
      return {
        success: false,
        sandboxPath: '',
        fileCount: 0,
        totalSize: 0,
        error: 'Session not found',
      };
    }

    log(`[SandboxSync] Syncing to Windows for session ${sessionId}`);
    log(`[SandboxSync]   Sandbox: ${session.sandboxPath}`);
    log(`[SandboxSync]   Windows: ${session.windowsPath}`);

    try {
      const wslDestPath = pathConverter.toWSL(session.windowsPath);

      // Build rsync exclude arguments
      const excludeArgs = SYNC_EXCLUDES.map(e => `--exclude="${e}"`).join(' ');

      // Sync back to Windows (via /mnt/)
      // NOTE: We use --delete to ensure files deleted/moved in sandbox are also deleted locally
      // This is important for file organization tasks where files are moved to new locations
      const rsyncCmd = `rsync -av --delete ${excludeArgs} "${session.sandboxPath}/" "${wslDestPath}/"`;
      log(`[SandboxSync] Running: ${rsyncCmd}`);

      await this.wslExec(session.distro, rsyncCmd, 300000); // 5 min timeout

      // Update last sync time
      session.lastSyncTime = Date.now();

      log(`[SandboxSync] Sync to Windows complete for session ${sessionId}`);

      return {
        success: true,
        sandboxPath: session.sandboxPath,
        fileCount: session.fileCount || 0,
        totalSize: session.totalSize || 0,
      };
    } catch (error) {
      logError('[SandboxSync] Sync to Windows failed:', error);
      return {
        success: false,
        sandboxPath: session.sandboxPath,
        fileCount: 0,
        totalSize: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Sync changes from sandbox back to Windows (legacy alias for syncToWindows)
   * @deprecated Use syncToWindows instead
   */
  static async finalSync(sessionId: string): Promise<SyncResult> {
    return this.syncToWindows(sessionId);
  }

  /**
   * Clean up sandbox directory for a specific session
   */
  static async cleanup(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }

    log(`[SandboxSync] Cleaning up session ${sessionId}`);

    try {
      await this.wslExec(session.distro, `rm -rf "${session.sandboxPath}"`);
      sessions.delete(sessionId);
      log(`[SandboxSync] Cleanup complete for session ${sessionId}`);
    } catch (error) {
      logError('[SandboxSync] Cleanup failed:', error);
    }
  }

  /**
   * Sync to Windows and then cleanup the sandbox
   * Called when a session/conversation is deleted
   */
  static async syncAndCleanup(sessionId: string): Promise<SyncResult> {
    log(`[SandboxSync] Sync and cleanup for session ${sessionId}`);
    
    // First sync changes back to Windows
    const syncResult = await this.syncToWindows(sessionId);
    
    // Then cleanup the sandbox
    await this.cleanup(sessionId);
    
    return syncResult;
  }

  /**
   * Sync a single file from Windows to sandbox
   * Used for file attachments after sandbox is already initialized
   */
  static async syncFileToSandbox(
    sessionId: string,
    windowsSourcePath: string,
    sandboxRelativePath: string
  ): Promise<{ success: boolean; sandboxPath: string; error?: string }> {
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        sandboxPath: '',
        error: 'Session not found',
      };
    }

    const sandboxDestPath = `${session.sandboxPath}/${sandboxRelativePath}`;
    log(`[SandboxSync] Syncing file to sandbox: ${windowsSourcePath} -> ${sandboxDestPath}`);

    try {
      // Convert Windows path to WSL /mnt/ path
      const wslSourcePath = pathConverter.toWSL(windowsSourcePath);

      // Ensure destination directory exists
      const destDir = sandboxDestPath.substring(0, sandboxDestPath.lastIndexOf('/'));
      await this.wslExec(session.distro, `mkdir -p "${destDir}"`);

      // Copy file
      const cpCmd = `cp "${wslSourcePath}" "${sandboxDestPath}"`;
      log(`[SandboxSync] Running: ${cpCmd}`);
      await this.wslExec(session.distro, cpCmd, 60000); // 1 min timeout

      log(`[SandboxSync] File synced to sandbox: ${sandboxDestPath}`);

      return {
        success: true,
        sandboxPath: sandboxDestPath,
      };
    } catch (error) {
      logError('[SandboxSync] File sync failed:', error);
      return {
        success: false,
        sandboxPath: sandboxDestPath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get the sandbox path for a session (if initialized)
   */
  static getSandboxPath(sessionId: string): string | null {
    const session = sessions.get(sessionId);
    return session?.sandboxPath || null;
  }

  /**
   * Get the distro for a session (if initialized)
   */
  static getDistro(sessionId: string): string | null {
    const session = sessions.get(sessionId);
    return session?.distro || null;
  }

  /**
   * Cleanup all active sandbox sessions
   * Called on app shutdown
   */
  static async cleanupAllSessions(): Promise<void> {
    const sessionIds = Array.from(sessions.keys());
    
    if (sessionIds.length === 0) {
      log('[SandboxSync] No active sessions to cleanup');
      return;
    }

    log(`[SandboxSync] Cleaning up ${sessionIds.length} active session(s)...`);

    // Sync and cleanup all sessions in parallel
    const results = await Promise.allSettled(
      sessionIds.map(async (sessionId) => {
        try {
          // First sync to preserve changes
          await this.syncToWindows(sessionId);
          // Then cleanup
          await this.cleanup(sessionId);
          return { sessionId, success: true };
        } catch (error) {
          logError(`[SandboxSync] Failed to cleanup session ${sessionId}:`, error);
          return { sessionId, success: false, error };
        }
      })
    );

    const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - succeeded;

    log(`[SandboxSync] Cleanup complete: ${succeeded} succeeded, ${failed} failed`);
  }

  /**
   * Clear all session mappings without syncing or cleanup
   * Used when workingDir changes - no need to preserve old sandbox data
   */
  static clearAllSessions(): void {
    const count = sessions.size;
    if (count === 0) {
      log('[SandboxSync] No sessions to clear');
      return;
    }
    sessions.clear();
    log(`[SandboxSync] Cleared ${count} session(s) from map`);
  }

  /**
   * Clear a specific session mapping without syncing or cleanup
   * Used when a session's workingDir changes
   */
  static clearSession(sessionId: string): void {
    if (sessions.has(sessionId)) {
      sessions.delete(sessionId);
      log(`[SandboxSync] Cleared session ${sessionId} from map`);
    }
  }

  /**
   * Get session info
   */
  static getSession(sessionId: string): SyncSession | undefined {
    return sessions.get(sessionId);
  }

  /**
   * Check if a path is within the sandbox
   */
  static isPathInSandbox(path: string, sessionId: string): boolean {
    const session = sessions.get(sessionId);
    if (!session) return false;
    return path.startsWith(session.sandboxPath);
  }

  /**
   * Convert a Windows path to its sandbox equivalent
   */
  static windowsToSandboxPath(windowsPath: string, sessionId: string): string | null {
    const session = sessions.get(sessionId);
    if (!session) return null;

    // Normalize paths
    const normalizedWindows = session.windowsPath.replace(/\\/g, '/').toLowerCase();
    const normalizedInput = windowsPath.replace(/\\/g, '/').toLowerCase();

    if (normalizedInput.startsWith(normalizedWindows)) {
      const relativePath = windowsPath.substring(session.windowsPath.length);
      return session.sandboxPath + relativePath.replace(/\\/g, '/');
    }

    return null;
  }

  /**
   * Convert a sandbox path to its Windows equivalent
   */
  static sandboxToWindowsPath(sandboxPath: string, sessionId: string): string | null {
    const session = sessions.get(sessionId);
    if (!session) return null;

    if (sandboxPath.startsWith(session.sandboxPath)) {
      const relativePath = sandboxPath.substring(session.sandboxPath.length);
      return session.windowsPath + relativePath.replace(/\//g, '\\');
    }

    return null;
  }

  /**
   * Execute a command in WSL
   */
  private static async wslExec(
    distro: string,
    command: string,
    timeout = 60000
  ): Promise<{ stdout: string; stderr: string }> {
    // Windows CMD requires double quotes, escape inner double quotes
    const escapedCommand = command.replace(/"/g, '\\"');
    const fullCommand = `wsl -d ${distro} -e bash -c "source ~/.nvm/nvm.sh 2>/dev/null; ${escapedCommand}"`;

    return execAsync(fullCommand, { timeout, encoding: 'utf-8' });
  }

  /**
   * Format bytes to human readable string
   */
  private static formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
}

export default SandboxSync;
